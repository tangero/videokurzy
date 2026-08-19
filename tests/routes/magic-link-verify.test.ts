import { describe, it, expect, vi } from "vitest";
import { SELF } from "cloudflare:test";

// Zachytáváme URL magic linku z odchozího Resend volání — sendMagicLink
// v createAuth volá api.resend.com přímo přes globální fetch.
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

/** Odešle magic link a vrátí URL, na kterou by uživatel v mailu klikl. */
async function requestMagicLink(email: string): Promise<string> {
  capturedUrl = null;
  const res = await SELF.fetch("https://example.com/login/send", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ email, callbackURL: "/dashboard" }).toString(),
  });
  expect(res.status).toBeLessThan(400);
  const url = capturedUrl;
  if (!url) throw new Error("sendMagicLink neposlal odkaz");
  return url;
}

describe("magic link — odolnost proti prefetch skenerům", () => {
  it("přihlásí uživatele, i když odkaz předtím otevřel link scanner", async () => {
    const url = await requestMagicLink(uniqueEmail("scanner"));

    // 1. GET = Microsoft Safe Links / antivirus / prefetch mailového klienta.
    const scanner = await SELF.fetch(url, { redirect: "manual" });
    expect(scanner.status).toBe(302);

    // 2. GET = skutečný klik uživatele. Musí projít, jinak končí na /login
    // bez session (původní bug: allowedAttempts default 1).
    const human = await SELF.fetch(url, { redirect: "manual" });
    expect(human.status).toBe(302);
    expect(human.headers.get("location")).not.toContain("error");
    expect(human.headers.get("set-cookie")).toContain("better-auth.session_token=");
  });

  it("po vyčerpání povolených pokusů pošle uživatele na /login s chybou", async () => {
    const url = await requestMagicLink(uniqueEmail("exhausted"));

    // allowedAttempts: 3 — čtvrtý pokus už musí být odmítnutý.
    for (let i = 0; i < 3; i++) {
      await SELF.fetch(url, { redirect: "manual" });
    }
    const rejected = await SELF.fetch(url, { redirect: "manual" });

    const location = rejected.headers.get("location") ?? "";
    // errorCallbackURL míří na /login (ne /dashboard), aby se chyba dala zobrazit.
    expect(location).toContain("/login");
    expect(location).toContain("error=ATTEMPTS_EXCEEDED");
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
