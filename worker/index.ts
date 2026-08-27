/**
 * Cloudflare Worker API entrypoint for My Life Chart.
 */

import { generateDeleteToken, generateShareId, isValidShareId, sha256Hex, constantTimeEqual } from "./crypto";
import { Env } from "./types";
import { verifyTurnstileToken } from "./turnstile";
import { validateTimelineDocument } from "./validation";

const MAX_REQUEST_SIZE = 256 * 1024; // 256KB

const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
};

function jsonResponse(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...SECURITY_HEADERS,
      ...extraHeaders,
    },
  });
}

function errorResponse(message: string, status = 400, extraHeaders: Record<string, string> = {}): Response {
  return jsonResponse({ error: message }, status, extraHeaders);
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // Only process /api/ requests with Worker logic to preserve free tier CPU/requests.
    // All other paths (static assets, /s/:id, SPA routes) are served by Cloudflare Static Assets.
    if (!pathname.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }

    try {
      // Route: POST /api/shares - Create a new shortened share
      if (request.method === "POST" && pathname === "/api/shares") {
        const contentType = request.headers.get("content-type") || "";
        if (!contentType.toLowerCase().includes("application/json")) {
          return errorResponse("Content-Type must be application/json", 415);
        }

        const contentLength = parseInt(request.headers.get("content-length") || "0", 10);
        if (contentLength > MAX_REQUEST_SIZE) {
          return errorResponse("Request payload exceeds size limit (256KB)", 413);
        }

        // Apply rate limiter if configured (5 requests / min / IP)
        if (env.SHARE_RATE_LIMITER) {
          const clientIp = request.headers.get("CF-Connecting-IP") || "unknown-client";
          try {
            const { success } = await env.SHARE_RATE_LIMITER.limit({ key: clientIp });
            if (!success) {
              return errorResponse("Rate limit exceeded. Please wait a moment before trying again.", 429, {
                "Retry-After": "60",
              });
            }
          } catch {
            // Fail open on rate limiter error to prevent blocking legitimate traffic if limiter fails
          }
        }

        // Read request body safely
        let body: any;
        try {
          const text = await request.text();
          if (text.length > MAX_REQUEST_SIZE) {
            return errorResponse("Request payload exceeds size limit (256KB)", 413);
          }
          body = JSON.parse(text);
        } catch {
          return errorResponse("Invalid JSON payload", 400);
        }

        if (!body || typeof body !== "object") {
          return errorResponse("Invalid request body", 400);
        }

        // Turnstile Token verification
        const turnstileToken = body.turnstileToken;
        const clientIp = request.headers.get("CF-Connecting-IP") || undefined;
        const turnstileResult = await verifyTurnstileToken(
          turnstileToken,
          env.TURNSTILE_SECRET_KEY,
          clientIp
        );

        if (!turnstileResult.success) {
          return errorResponse(turnstileResult.error || "Turnstile verification failed", 403);
        }

        // Validate TimelineDocument
        const validationResult = validateTimelineDocument(body.document);
        if (!validationResult.success) {
          return errorResponse(validationResult.error, 400);
        }

        const cleanDoc = validationResult.document;
        const shareId = generateShareId();
        const deleteToken = generateDeleteToken();
        const deleteTokenHash = await sha256Hex(deleteToken);
        const createdAt = new Date().toISOString();

        // Save to D1
        await env.DB.prepare(
          "INSERT INTO shares (id, document_json, delete_token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, NULL)"
        )
          .bind(shareId, JSON.stringify(cleanDoc), deleteTokenHash, createdAt)
          .run();

        const shareUrl = `${url.origin}/s/${shareId}`;

        return jsonResponse(
          {
            id: shareId,
            url: shareUrl,
            deleteToken,
          },
          201,
          {
            "Cache-Control": "no-store",
          }
        );
      }

      // Route: GET /api/shares/:shareId - Retrieve shared document
      if (request.method === "GET" && pathname.startsWith("/api/shares/")) {
        const shareId = pathname.slice("/api/shares/".length);

        if (!isValidShareId(shareId)) {
          return errorResponse("Invalid share ID format", 404);
        }

        const row = await env.DB.prepare(
          "SELECT document_json, created_at, expires_at FROM shares WHERE id = ?"
        )
          .bind(shareId)
          .first<{ document_json: string; created_at: string; expires_at: string | null }>();

        if (!row || !row.document_json) {
          return errorResponse("Share not found", 404);
        }

        if (row.expires_at) {
          const expiresAt = new Date(row.expires_at).getTime();
          if (!isNaN(expiresAt) && expiresAt < Date.now()) {
            return errorResponse("Share has expired", 404);
          }
        }

        let parsedDoc: unknown;
        try {
          parsedDoc = JSON.parse(row.document_json);
        } catch {
          return errorResponse("Corrupted share data", 500);
        }

        return jsonResponse(
          {
            document: parsedDoc,
            createdAt: row.created_at,
          },
          200,
          {
            "Cache-Control": "public, max-age=60, s-maxage=300",
          }
        );
      }

      // Route: DELETE /api/shares/:shareId - Delete a share
      if (request.method === "DELETE" && pathname.startsWith("/api/shares/")) {
        const shareId = pathname.slice("/api/shares/".length);

        if (!isValidShareId(shareId)) {
          return errorResponse("Invalid share ID format", 404);
        }

        const authHeader = request.headers.get("Authorization") || "";
        if (!authHeader.startsWith("Bearer ")) {
          return errorResponse("Missing or invalid Authorization header", 401);
        }

        const deleteToken = authHeader.slice(7).trim();
        if (!deleteToken) {
          return errorResponse("Delete token required", 401);
        }

        const row = await env.DB.prepare("SELECT delete_token_hash FROM shares WHERE id = ?")
          .bind(shareId)
          .first<{ delete_token_hash: string }>();

        if (!row) {
          return errorResponse("Share not found", 404);
        }

        const providedHash = await sha256Hex(deleteToken);
        if (!constantTimeEqual(providedHash, row.delete_token_hash)) {
          return errorResponse("Unauthorized", 403);
        }

        await env.DB.prepare("DELETE FROM shares WHERE id = ?").bind(shareId).run();

        return jsonResponse({ success: true }, 200, {
          "Cache-Control": "no-store",
        });
      }

      // Any other /api/ route
      return errorResponse("Not Found", 404);
    } catch {
      // Do not leak stack traces or internal details
      return errorResponse("An internal server error occurred", 500);
    }
  },
};
