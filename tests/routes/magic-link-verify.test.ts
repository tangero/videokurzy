import { describe, it, expect, vi } from "vitest";
import { env, SELF, createExecutionContext } from "cloudflare:test";
import { createAuth } from "../../src/lib/auth";

// Zachytáváme token z odchozího Resend volání — sendMagicLink v createAuth
// volá api.resend.com přímo přes globální fetch.
let capturedUrl: string | null = null;
const realFetch = globalThis.fetch;
vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input.toString();
  if (url.includes("api.resend.com")) {
    const body = JSON.parse(String(init?.body ?? "{}"));
    const match = /href="([^"]+)"/.exec(body.html ?? "");
    capturedUrl = match ? match[1] : null;
    return new Response(JSON.stringify({ id: "test" }), { status: 200 });
  }
  return realFetch(input as never, init);
});

const uniqueEmail = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;

/** Odešle magic link přes /login/send a vrátí token z odkazu v mailu. */
async function requestMagicLinkToken(email: string): Promise<string> {
  capturedUrl = null;
  const res = await SELF.fetch("https://example.com/login/send", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ email, callbackURL: "/dashboard" }).toString(),
  });
  expect(res.status).toBeLessThan(400);
  const url = capturedUrl;
  if (!url) throw new Error("sendMagicLink neposlal odkaz");
  const token = new URL(url).searchParams.get("token");
  if (!token) throw new Error("odkaz neobsahuje token");
  return token;
}

/**
 * Jedno uplatnění tokenu = jeden GET na verify URL.
 *
 * Voláme `auth.api.magicLinkVerify` bez `callbackURL` záměrně. S callbackURL
 * plugin signalizuje výsledek přes `throw ctx.redirect(...)` — a to i při
 * ÚSPĚCHU (magic-link/index.mjs:162-163), ne jen na chybové větvi. Better Auth
 * tu výjimku sám zachytí a převede na Response, ale Vitest ji stihne zahlédnout
 * jako unhandled rejection a shodí běh exit kódem 1 i při zelených asercích.
 * Bez callbackURL vrací handler `ctx.json(...)` (řádek 157) → žádná výjimka.
 * Stejný důvod, proč tudy chodí i /internal/auth/verify-token; viz docs/gotchas.md.
 *
 * Testovaná logika (`allowedAttempts` counter nad verification tabulkou) je
 * v obou případech identická — liší se jen způsob doručení výsledku.
 */
async function redeemToken(token: string): Promise<Response> {
  const ctx = createExecutionContext();
  const auth = createAuth(env as never, ctx);
  return auth.api.magicLinkVerify({
    query: { token },
    headers: new Headers(),
    asResponse: true,
  });
}

describe("POST /login/send — parametry v odeslaném odkazu", () => {
  it("propíše errorCallbackURL=/login do verify URL v mailu", async () => {
    capturedUrl = null;
    const res = await SELF.fetch("https://example.com/login/send", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        email: uniqueEmail("params"),
        callbackURL: "/dashboard",
      }).toString(),
    });
    expect(res.status).toBeLessThan(400);
    const url = capturedUrl;
    if (!url) throw new Error("sendMagicLink neposlal odkaz");

    // Bez errorCallbackURL by Better Auth při chybě redirectoval na
    // callbackURL (/dashboard), tam requireAuth uvidí prázdnou session
    // a mlčky přesměruje na /login — a ?error= se cestou zahodí. Překlad
    // kódů níž by pak byl mrtvý kód. Ověřujeme tedy i tohle propojení,
    // ne jen že /login umí hlášku zobrazit.
    const params = new URL(url).searchParams;
    expect(params.get("errorCallbackURL")).toBe("/login");
    expect(params.get("callbackURL")).toBe("/dashboard");
    expect(params.get("token")).toBeTruthy();
  });
});

describe("magic link — odolnost proti prefetch skenerům", () => {
  it("přihlásí uživatele, i když odkaz předtím otevřel link scanner", async () => {
    const token = await requestMagicLinkToken(uniqueEmail("scanner"));

    // 1. uplatnění = Microsoft Safe Links / antivirus / prefetch mailového klienta.
    const scanner = await redeemToken(token);
    expect(scanner.status).toBe(200);

    // 2. uplatnění = skutečný klik uživatele. Musí projít a vydat session,
    // jinak končí na /login bez přihlášení (bug: allowedAttempts default 1).
    const human = await redeemToken(token);
    expect(human.status).toBe(200);
    expect(human.headers.get("set-cookie")).toContain("better-auth.session_token=");
  });

  it("povolí právě tři uplatnění, čtvrté už counter nepustí", async () => {
    const token = await requestMagicLinkToken(uniqueEmail("exhausted"));

    // allowedAttempts: 3 — tři uplatnění musí projít a vydat session.
    for (let i = 0; i < 3; i++) {
      const ok = await redeemToken(token);
      expect(ok.status).toBe(200);
    }

    // Čtvrté uplatnění ověřujeme nad DB, ne dalším voláním Better Auth:
    // vyčerpaný token jde přes `redirectWithError` (magic-link/index.mjs:118),
    // které vyhazuje VŽDY — errorCallbackURL fallbackuje na callbackURL a ten
    // na "/", takže se výjimce nedá vyhnout ani vynecháním callbackURL, a
    // Vitest by ji nahlásil jako unhandled rejection. Counter v verification
    // tabulce je přesně ta hodnota, kterou plugin na řádku 129 porovnává
    // s allowedAttempts, takže test kontroluje tutéž podmínku o krok dřív.
    const row = await env.DB.prepare(
      "SELECT value FROM verification WHERE identifier = ?",
    )
      .bind(token)
      .first<{ value: string }>();

    expect(row).not.toBeNull();
    expect(JSON.parse(row!.value).attempt).toBe(3);
  });
});

describe("GET /login — překlad chybových kódů magic linku", () => {
  const cases: [string, string][] = [
    ["EXPIRED_TOKEN", "Platnost odkazu vypršela"],
    ["ATTEMPTS_EXCEEDED", "Tento odkaz už byl použit"],
    ["INVALID_TOKEN", "Odkaz je neplatný"],
  ];

  for (const [code, expected] of cases) {
    it(`zobrazí českou hlášku pro ${code}`, async () => {
      const res = await SELF.fetch(`https://example.com/login?error=${code}`);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain(expected);
    });
  }

  it("neznámý kód shodí na obecnou hlášku, nikdy nevypíše syrový kód", async () => {
    const res = await SELF.fetch("https://example.com/login?error=SOMETHING_NEW");
    const html = await res.text();
    expect(html).toContain("Přihlášení odkazem se nezdařilo");
    expect(html).not.toContain("SOMETHING_NEW");
  });

  it("bez parametru error nezobrazí žádnou chybu", async () => {
    const res = await SELF.fetch("https://example.com/login");
    const html = await res.text();
    expect(html).not.toContain("Nechte si prosím poslat nový");
  });
});
