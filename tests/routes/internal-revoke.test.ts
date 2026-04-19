import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("POST /internal/auth/revoke", () => {
  it("403 bez secret", async () => {
    const res = await SELF.fetch("https://test.local/internal/auth/revoke", {
      method: "POST",
    });
    expect(res.status).toBe(403);
  });

  it("200 idempotent bez cookie", async () => {
    const res = await SELF.fetch("https://test.local/internal/auth/revoke", {
      method: "POST",
      headers: { "X-Internal-Secret": env.AUTH_INTERNAL_SECRET },
    });
    expect(res.status).toBe(200);
    const body = await res.json<{ ok: boolean; setCookie: string | null }>();
    expect(body.ok).toBe(true);
  });
});
