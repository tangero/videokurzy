import { describe, it, expect, vi } from "vitest";
import { env, SELF, createExecutionContext } from "cloudflare:test";
import { createAuth } from "../../src/lib/auth";

// Přihlášení do diskuse pod články na www.vibecoding.cz: interní magic-link
// s purpose "comments" pošle e-mail s textem pro diskusi a odkaz po ověření
// vrátí čtenáře na článek (callbackURL mimo BETTER_AUTH_URL → trustedOrigins).
let captured: { subject?: string; html?: string; url?: string } = {};
const realFetch = globalThis.fetch;
vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input.toString();
  if (url.includes("api.resend.com/emails")) {
    const body = JSON.parse(String(init?.body ?? "{}"));
    const match = /href="([^"]+)"/.exec(body.html ?? "");
    captured = { subject: body.subject, html: body.html, url: match?.[1] };
    return new Response(JSON.stringify({ id: "test" }), { status: 200 });
  }
  if (url.includes("api.resend.com")) {
    return new Response(JSON.stringify({ id: "test" }), { status: 200 });
  }
  return realFetch(input as never, init);
});

const uniqueEmail = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;

async function requestCommentsLink(callbackUrl: string, purpose?: string) {
  captured = {};
  const res = await SELF.fetch("https://test.local/internal/auth/magic-link", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Secret": env.AUTH_INTERNAL_SECRET,
    },
    body: JSON.stringify({ email: uniqueEmail("comments"), callbackUrl, purpose, name: "Jana Testová" }),
  });
  return res;
}

describe("magic link pro diskuse na www.vibecoding.cz", () => {
  const article = "https://www.vibecoding.cz/articles/ostatni/clanek/#komentare";

  it("e-mail s purpose comments má text pro diskusi", async () => {
    const res = await requestCommentsLink(article, "comments");
    expect(res.status).toBe(200);
    expect(captured.subject).toBe("Přihlášení do diskuse na Vibecoding.cz");
    expect(captured.html).toContain("Přihlásit se do diskuse");
  });

  it("bez purpose zůstává e-mail pro kurzy", async () => {
    const res = await requestCommentsLink(article);
    expect(res.status).toBe(200);
    expect(captured.subject).toBe("Přihlášení do kurzu");
  });

  it("odkaz v e-mailu nese callbackURL článku", async () => {
    await requestCommentsLink(article, "comments");
    expect(captured.url).toBeTruthy();
    const verify = new URL(captured.url!);
    expect(verify.pathname).toBe("/api/auth/magic-link/verify");
    expect(verify.searchParams.get("callbackURL")).toBe(article);
  });

  // /magic-link/verify při úspěchu i chybě končí `throw ctx.redirect(...)`,
  // což Vitest hlásí jako unhandled rejection (viz docs/gotchas.md). Kontrolu
  // callbackURL proto ověřujeme na stejné funkci, kterou volá originCheck
  // middleware verify endpointu: context.isTrustedOrigin.
  it("Better Auth považuje článek na www.vibecoding.cz za důvěryhodný callback", async () => {
    const auth = createAuth(env as never, createExecutionContext());
    const ctx = await auth.$context;
    expect(ctx.isTrustedOrigin(article, { allowRelativePaths: true })).toBe(true);
    expect(ctx.isTrustedOrigin("https://vibecoding.cz/x", { allowRelativePaths: true })).toBe(true);
    expect(ctx.isTrustedOrigin("https://evil.example/x", { allowRelativePaths: true })).toBe(false);
    expect(ctx.isTrustedOrigin("https://www.vibecoding.cz.evil.example/x", { allowRelativePaths: true })).toBe(false);
  });

  it("callback na cizí doménu interní endpoint dál odmítne", async () => {
    const res = await requestCommentsLink("https://evil.example/x", "comments");
    expect(res.status).toBe(400);
  });
});
