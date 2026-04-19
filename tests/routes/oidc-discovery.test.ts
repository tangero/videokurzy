import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("OIDC discovery", () => {
  it("returns metadata", async () => {
    const res = await SELF.fetch(
      "https://test.local/api/auth/.well-known/openid-configuration",
    );
    expect(res.status).toBe(200);
    const body = await res.json<{
      issuer: string;
      authorization_endpoint?: string;
    }>();
    expect(body.issuer).toBeTruthy();
    expect(body.authorization_endpoint).toBeTruthy();
  });
});
