import { describe, expect, it } from "vitest";
import { hostOnlyCookieCleanup } from "../../src/lib/host-only-cookie-cleanup";

describe("hostOnlyCookieCleanup", () => {
  it("k doménové auth cookie přidá smazání varianty bez Domain", () => {
    const out = hostOnlyCookieCleanup([
      "__Secure-better-auth.session_token=abc; Max-Age=604800; Domain=.vibecoding.cz; Path=/; HttpOnly; Secure; SameSite=Lax",
      "__Secure-better-auth.session_data.0=xyz; Domain=.vibecoding.cz; Path=/; Secure",
    ]);
    expect(out).toEqual([
      "__Secure-better-auth.session_token=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax",
      "__Secure-better-auth.session_data.0=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax",
    ]);
  });

  it("cookie bez Domain ani cizí cookie nemaže", () => {
    expect(hostOnlyCookieCleanup([
      "__Secure-better-auth.session_token=abc; Path=/; HttpOnly; Secure",
      "cc_consent=1; Domain=.vibecoding.cz; Path=/",
    ])).toEqual([]);
  });

  it("smazání doménové cookie (odhlášení) smaže i variantu bez Domain, každé jméno jednou", () => {
    const out = hostOnlyCookieCleanup([
      "__Secure-better-auth.session_token=; Max-Age=0; Domain=.vibecoding.cz; Path=/",
      "__Secure-better-auth.session_token=; Max-Age=0; Domain=.vibecoding.cz; Path=/",
    ]);
    expect(out).toHaveLength(1);
  });
});

describe("aplikace s COOKIE_DOMAIN", () => {
  it("odhlášení smaže doménovou i starou cookie jen pro kurzy", async () => {
    const { env, createExecutionContext } = await import("cloudflare:test");
    const { default: worker } = await import("../../src/index");
    const app = (worker as { fetch: (r: Request, e: unknown, c: unknown) => Promise<Response> });
    const res = await app.fetch(
      new Request("http://localhost:8787/api/auth/sign-out", {
        method: "POST",
        headers: { Origin: "http://localhost:8787", "Content-Type": "application/json", Cookie: "better-auth.session_token=stary" },
        body: "{}",
      }),
      { ...env, COOKIE_DOMAIN: ".vibecoding.cz" },
      createExecutionContext(),
    );
    const cookies = res.headers.getAll("Set-Cookie");
    const session = cookies.filter((h) => /better-auth\.session_token=/.test(h));
    expect(session.some((h) => /domain=\.vibecoding\.cz/i.test(h))).toBe(true);
    expect(session.some((h) => !/domain=/i.test(h) && /Max-Age=0/.test(h))).toBe(true);
  });
});
