import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("GET /internal/auth/me", () => {
  it("403 bez secret", async () => {
    const res = await SELF.fetch("https://test.local/internal/auth/me");
    expect(res.status).toBe(403);
  });

  it("401 s secret ale bez cookie", async () => {
    const res = await SELF.fetch("https://test.local/internal/auth/me", {
      headers: { "X-Internal-Secret": env.AUTH_INTERNAL_SECRET },
    });
    expect(res.status).toBe(401);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("unauthenticated");
  });
});
