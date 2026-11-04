import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

// oidcProvider byl 2026-11-04 odebrán (nevyužitý prototyp, bezpečnostní
// advisories v better-auth 1.6.x). Test hlídá, že se discovery endpoint
// nevrátí omylem zpět.
describe("OIDC discovery", () => {
  it("is not exposed", async () => {
    const res = await SELF.fetch(
      "https://test.local/api/auth/.well-known/openid-configuration",
    );
    expect(res.status).toBe(404);
  });
});
