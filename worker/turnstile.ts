/**
 * Turnstile verification helper for Cloudflare Workers.
 */

interface TurnstileVerifyResponse {
  success: boolean;
  "error-codes"?: string[];
  challenge_ts?: string;
  hostname?: string;
}

export async function verifyTurnstileToken(
  token: string | undefined,
  secretKey: string | undefined,
  remoteIp?: string
): Promise<{ success: boolean; error?: string }> {
  // If secret key is not configured in production, fail closed
  if (!secretKey) {
    return { success: false, error: "Turnstile is not configured on the server" };
  }

  if (!token || typeof token !== "string" || token.trim() === "") {
    return { success: false, error: "Turnstile token is required" };
  }

  try {
    const formData = new URLSearchParams();
    formData.append("secret", secretKey);
    formData.append("response", token);
    if (remoteIp) {
      formData.append("remoteip", remoteIp);
    }

    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: formData,
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
    });

    if (!response.ok) {
      return { success: false, error: "Failed to communicate with Turnstile verification service" };
    }

    const result = (await response.json()) as TurnstileVerifyResponse;
    if (!result.success) {
      return { success: false, error: "Turnstile verification failed" };
    }

    return { success: true };
  } catch {
    return { success: false, error: "Error during Turnstile verification" };
  }
}
