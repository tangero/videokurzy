import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

// We verify the route's guards (internal-secret auth, allowlist, validation).
// The success path (200) is not tested here because it would call the real
// Resend API; end-to-end delivery is verified manually in Task 15.
// Note: On Better Auth errors, handler relays upstream 4xx status (rate limit,
// validation) and logs a correlationId. Unknown errors remain 502. Happy path
// and correlation-ID propagation are verified manually in Task 15 QA.
describe("POST /internal/auth/magic-link", () => {
  it("403 without secret", async () => {
    const res = await SELF.fetch("https://test.local/internal/auth/magic-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "a@b.cz",
        callbackUrl: "https://vibecoding.cz/auth/verify",
      }),
    });
    expect(res.status).toBe(403);
  });

  it("400 when callback not allowed", async () => {
    const res = await SELF.fetch("https://test.local/internal/auth/magic-link", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Secret": env.AUTH_INTERNAL_SECRET,
      },
      body: JSON.stringify({
        email: "a@b.cz",
        callbackUrl: "https://evil.com/x",
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json<{ error: string }>();
    expect(body.error).toMatch(/callbackUrl/i);
  });

  it("400 when email missing", async () => {
    const res = await SELF.fetch("https://test.local/internal/auth/magic-link", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Secret": env.AUTH_INTERNAL_SECRET,
      },
      body: JSON.stringify({
        callbackUrl: "https://vibecoding.cz/auth/verify",
      }),
    });
    expect(res.status).toBe(400);
  });

  it("400 when callbackUrl missing", async () => {
    const res = await SELF.fetch("https://test.local/internal/auth/magic-link", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Secret": env.AUTH_INTERNAL_SECRET,
      },
      body: JSON.stringify({ email: "a@b.cz" }),
    });
    expect(res.status).toBe(400);
  });
});
