import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

// We verify the route's guards (internal-secret auth, input validation, invalid
// token handling). The success path (200) is not tested here because it would
// require a real magic-link token generation, which in turn requires Resend.
// End-to-end verification is done manually in Task 15.
describe("POST /internal/auth/verify-token", () => {
  it("400 without token", async () => {
    const res = await SELF.fetch(
      "https://test.local/internal/auth/verify-token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Secret": env.AUTH_INTERNAL_SECRET,
        },
        body: JSON.stringify({}),
      },
    );
    expect(res.status).toBe(400);
  });

  it("401 with invalid token", async () => {
    const res = await SELF.fetch(
      "https://test.local/internal/auth/verify-token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Secret": env.AUTH_INTERNAL_SECRET,
        },
        body: JSON.stringify({ token: "invalid-token-xyz" }),
      },
    );
    expect(res.status).toBe(401);
    const body = await res.json<{ error: string; correlationId?: string }>();
    expect(body.error).toBe("invalid_token");
  });

  it("403 without internal secret", async () => {
    const res = await SELF.fetch(
      "https://test.local/internal/auth/verify-token",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: "anything" }),
      },
    );
    expect(res.status).toBe(403);
  });
});
