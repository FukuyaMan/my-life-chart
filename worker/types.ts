/**
 * Environment bindings for Cloudflare Workers.
 */

export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface AssetsBinding {
  fetch(request: Request | string, init?: RequestInit): Promise<Response>;
}

export interface Env {
  DB: D1Database;
  SHARE_RATE_LIMITER?: RateLimiter;
  ASSETS: AssetsBinding;
  TURNSTILE_SECRET_KEY?: string;
  ENVIRONMENT?: string;
}
