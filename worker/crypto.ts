/**
 * Cryptographic helper functions using Web Crypto API.
 */

/**
 * Generates a cryptographically secure random shareId (18 bytes = 24 chars in base64url).
 * Ensures unpredictable, 128-bit+ entropy.
 */
export function generateShareId(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

/**
 * Generates a cryptographically secure delete token (32 bytes = 256 bits).
 */
export function generateDeleteToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

/**
 * Converts a Uint8Array to base64url string without padding.
 */
export function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Computes SHA-256 hash of a string and returns as a hex string.
 */
export async function sha256Hex(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Constant-time string comparison to prevent timing attacks.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Validates whether a share ID is a valid base64url string with acceptable length.
 */
export function isValidShareId(id: string): boolean {
  return /^[A-Za-z0-9_-]{16,64}$/.test(id);
}
