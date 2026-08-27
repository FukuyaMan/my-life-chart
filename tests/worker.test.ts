import test from "node:test";
import assert from "node:assert/strict";
import worker from "../worker/index";
import { generateShareId, generateDeleteToken, sha256Hex, constantTimeEqual, isValidShareId } from "../worker/crypto";
import { validateTimelineDocument, TimelineDocument } from "../worker/validation";
import { Env } from "../worker/types";

const sampleValidDoc: TimelineDocument = {
  schemaVersion: 6,
  id: "test-doc-id-1234",
  title: "わたしの人生グラフ",
  mode: "lifetime",
  birth: "1990-01-01",
  range: { start: "1990-01-01", end: "2026-08-27" },
  endAge: 36,
  displayYear: 2026,
  yearStartMonth: 1,
  showCalendarYear: true,
  inputPrecision: "year",
  lineStyle: "curve",
  events: [
    {
      id: "birth",
      occurredAt: "1990-01-01",
      datePrecision: "day",
      score: 0,
      title: "誕生",
      description: "生まれました",
    },
    {
      id: "event-1",
      occurredAt: "2010-04-01",
      datePrecision: "month",
      score: 60,
      title: "大学入学",
      description: "新しい生活の始まり",
    },
  ],
  updatedAt: new Date().toISOString(),
};

function createMockEnv(overrides?: Partial<Env>): Env {
  const store = new Map<string, { id: string; document_json: string; delete_token_hash: string; created_at: string; expires_at: string | null }>();

  const mockDb = {
    prepare(query: string) {
      let boundArgs: any[] = [];
      return {
        bind(...args: any[]) {
          boundArgs = args;
          return this;
        },
        async run() {
          if (query.startsWith("INSERT INTO shares")) {
            const [id, document_json, delete_token_hash, created_at, expires_at] = boundArgs;
            store.set(id, { id, document_json, delete_token_hash, created_at, expires_at: expires_at ?? null });
            return { success: true };
          }
          if (query.startsWith("DELETE FROM shares")) {
            const [id] = boundArgs;
            store.delete(id);
            return { success: true };
          }
          return { success: true };
        },
        async first<T = any>() {
          if (query.startsWith("SELECT document_json, created_at, expires_at FROM shares")) {
            const [id] = boundArgs;
            const item = store.get(id);
            if (!item) return null;
            return { document_json: item.document_json, created_at: item.created_at, expires_at: item.expires_at } as unknown as T;
          }
          if (query.startsWith("SELECT delete_token_hash FROM shares")) {
            const [id] = boundArgs;
            const item = store.get(id);
            if (!item) return null;
            return { delete_token_hash: item.delete_token_hash } as unknown as T;
          }
          return null;
        },
      };
    },
  } as unknown as D1Database;

  const mockAssets = {
    async fetch(req: Request) {
      return new Response("mock static asset", { status: 200 });
    },
  };

  return {
    DB: mockDb,
    ASSETS: mockAssets,
    TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA", // Cloudflare test secret key (always passes)
    ...overrides,
  };
}

test("Crypto: generateShareId generates base64url string with 128bit+ entropy", () => {
  const id1 = generateShareId();
  const id2 = generateShareId();
  assert.notEqual(id1, id2);
  assert.equal(isValidShareId(id1), true);
  assert.equal(isValidShareId(id2), true);
  assert.equal(id1.length >= 20, true);
});

test("Crypto: sha256Hex and constantTimeEqual", async () => {
  const token = "secret-delete-token-12345";
  const hash1 = await sha256Hex(token);
  const hash2 = await sha256Hex(token);
  assert.equal(hash1, hash2);
  assert.equal(constantTimeEqual(hash1, hash2), true);
  assert.equal(constantTimeEqual(hash1, "wrong-hash"), false);
});

test("Validation: valid TimelineDocument", () => {
  const result = validateTimelineDocument(sampleValidDoc);
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.document.title, "わたしの人生グラフ");
    assert.equal(result.document.events.length, 2);
  }
});

test("Validation: rejects invalid schemaVersion and extra large content", () => {
  const invalidVersion = { ...sampleValidDoc, schemaVersion: 5 };
  const r1 = validateTimelineDocument(invalidVersion);
  assert.equal(r1.success, false);

  const longTitle = { ...sampleValidDoc, title: "a".repeat(61) };
  const r2 = validateTimelineDocument(longTitle);
  assert.equal(r2.success, false);

  const tooManyEvents = {
    ...sampleValidDoc,
    events: Array.from({ length: 501 }, (_, i) => ({
      id: `e-${i}`,
      occurredAt: "2020-01-01",
      datePrecision: "day" as const,
      score: 10,
      title: "e",
      description: "",
    })),
  };
  const r3 = validateTimelineDocument(tooManyEvents);
  assert.equal(r3.success, false);
});

test("Worker API: POST /api/shares - Success", async () => {
  const env = createMockEnv();
  const req = new Request("https://example.com/api/shares", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "CF-Connecting-IP": "127.0.0.1",
    },
    body: JSON.stringify({
      document: sampleValidDoc,
      turnstileToken: "XXXX.DUMMY.TOKEN.XXXX", // Passes with test secret
    }),
  });

  const res = await worker.fetch(req, env, {} as any);
  assert.equal(res.status, 201);
  assert.equal(res.headers.get("Cache-Control"), "no-store");
  assert.equal(res.headers.get("X-Content-Type-Options"), "nosniff");

  const data = (await res.json()) as { id: string; url: string; deleteToken: string };
  assert.ok(data.id);
  assert.ok(data.url.includes(`/s/${data.id}`));
  assert.ok(data.deleteToken);

  // Now GET the shared link
  const getReq = new Request(`https://example.com/api/shares/${data.id}`, { method: "GET" });
  const getRes = await worker.fetch(getReq, env, {} as any);
  assert.equal(getRes.status, 200);
  assert.ok(getRes.headers.get("Cache-Control")?.includes("public"));
  const getData = (await getRes.json()) as { document: TimelineDocument };
  assert.equal(getData.document.title, sampleValidDoc.title);

  // Unauthorized delete (wrong token)
  const unauthDeleteReq = new Request(`https://example.com/api/shares/${data.id}`, {
    method: "DELETE",
    headers: { Authorization: "Bearer wrong-token" },
  });
  const unauthDeleteRes = await worker.fetch(unauthDeleteReq, env, {} as any);
  assert.equal(unauthDeleteRes.status, 403);

  // Authorized delete
  const deleteReq = new Request(`https://example.com/api/shares/${data.id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${data.deleteToken}` },
  });
  const deleteRes = await worker.fetch(deleteReq, env, {} as any);
  assert.equal(deleteRes.status, 200);

  // Subsequent GET returns 404
  const getAfterDeleteRes = await worker.fetch(getReq, env, {} as any);
  assert.equal(getAfterDeleteRes.status, 404);
});

test("Worker API: POST /api/shares - Fails on invalid turnstile / missing secret", async () => {
  const env = createMockEnv({ TURNSTILE_SECRET_KEY: undefined });
  const req = new Request("https://example.com/api/shares", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      document: sampleValidDoc,
      turnstileToken: "XXXX",
    }),
  });

  const res = await worker.fetch(req, env, {} as any);
  assert.equal(res.status, 403);
});

test("Worker API: Rate limiting applies 429", async () => {
  let allow = true;
  const env = createMockEnv({
    SHARE_RATE_LIMITER: {
      async limit() {
        return { success: allow };
      },
    },
  });

  const req = new Request("https://example.com/api/shares", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      document: sampleValidDoc,
      turnstileToken: "XXXX.DUMMY.TOKEN.XXXX",
    }),
  });

  // First request ok
  const res1 = await worker.fetch(req.clone(), env, {} as any);
  assert.equal(res1.status, 201);

  // Rate limiter triggers
  allow = false;
  const res2 = await worker.fetch(req.clone(), env, {} as any);
  assert.equal(res2.status, 429);
});

test("Worker API: GET non-existent share returns 404", async () => {
  const env = createMockEnv();
  const req = new Request("https://example.com/api/shares/non-existent-share-id", { method: "GET" });
  const res = await worker.fetch(req, env, {} as any);
  assert.equal(res.status, 404);
});

test("Worker API: Rejects invalid Content-Type and non-JSON payloads", async () => {
  const env = createMockEnv();
  const req1 = new Request("https://example.com/api/shares", {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: "hello",
  });
  const res1 = await worker.fetch(req1, env, {} as any);
  assert.equal(res1.status, 415);

  const req2 = new Request("https://example.com/api/shares", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "invalid-json-body",
  });
  const res2 = await worker.fetch(req2, env, {} as any);
  assert.equal(res2.status, 400);
});

test("Worker API: Rejects invalid share ID format", async () => {
  const env = createMockEnv();
  const req = new Request("https://example.com/api/shares/!@#$%^&*", { method: "GET" });
  const res = await worker.fetch(req, env, {} as any);
  assert.equal(res.status, 404);
});

test("Worker API: Static route falls back to ASSETS", async () => {
  const env = createMockEnv();
  const req = new Request("https://example.com/s/some-share-id", { method: "GET" });
  const res = await worker.fetch(req, env, {} as any);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "mock static asset");
});
