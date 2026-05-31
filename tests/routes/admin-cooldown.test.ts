import { env, SELF } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { describe, it, expect, beforeEach } from "vitest";
import { createHMAC } from "@better-auth/utils/hmac";
import { user, session } from "../../src/db/auth-schema";

// Finanční admin operace mají KV cooldown (finding 13): druhý rychlý POST
// musí dostat 429. Cooldown se vyhodnocuje hned na začátku handleru (před DB i
// Fakturoid/Stripe prací), takže i nad prázdnou DB platí: první volání projde
// (není 429), druhé okamžité je 429.
//
// Autentizace: admin guard běží přes Better Auth getSession, který čte
// podepsaný cookie `better-auth.session_token`. Vyrobíme proto reálnou session
// v DB + podepsaný cookie (HMAC-SHA256, stejně jako better-auth). E-mail je
// z config/admin.ts ADMIN_EMAILS, takže authMiddleware účet povýší na admina.

const SESSION_TOKEN = "test-admin-session-token";

describe("admin financial-operation cooldowns", () => {
  let cookie = "";

  beforeEach(async () => {
    // D1 i KV se mezi testy nečistí automaticky (setup-db jen aplikuje migrace),
    // proto resetujeme ručně, aby předchozí test cooldown ani session nezdědil.
    await env.DB.prepare("DELETE FROM session").run();
    await env.DB.prepare("DELETE FROM user").run();
    await Promise.all([
      env.KV.delete("admin_cooldown:link-orphan-invoices"),
      env.KV.delete("admin_cooldown:mark-invoices-paid"),
      env.KV.delete("admin_cooldown:issue-missing-invoices"),
    ]);

    const db = drizzle(env.DB);
    const now = new Date();
    await db.insert(user).values({
      id: "admin-test-1",
      email: "zandl@marigold.cz",
      name: "Admin Test",
      emailVerified: true,
      role: "admin",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(session).values({
      id: "admin-test-session-1",
      userId: "admin-test-1",
      token: SESSION_TOKEN,
      expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      createdAt: now,
      updatedAt: now,
    });
    const sig = await createHMAC("SHA-256", "base64urlnopad").sign(
      env.BETTER_AUTH_SECRET,
      SESSION_TOKEN,
    );
    cookie = `better-auth.session_token=${SESSION_TOKEN}.${sig}`;
  });

  const postAs = (path: string): Promise<Response> =>
    SELF.fetch(`https://test.local${path}`, {
      method: "POST",
      headers: { Cookie: cookie },
    });

  const operations = [
    "/admin/api/purchases/link-orphan-invoices",
    "/admin/api/purchases/mark-invoices-paid",
    "/admin/api/purchases/issue-missing-invoices",
  ];

  for (const path of operations) {
    it(`blokuje druhý rychlý POST na ${path} (429)`, async () => {
      const first = await postAs(path);
      // První volání nesmí být zablokované cooldownem (a ani 403 — jsme admin).
      expect(first.status).not.toBe(429);
      expect(first.status).not.toBe(403);

      const second = await postAs(path);
      // Druhé okamžité volání musí narazit na cooldown.
      expect(second.status).toBe(429);
    });
  }

  it("cooldowny operací se vzájemně neblokují (oddělené KV klíče)", async () => {
    const link = await postAs("/admin/api/purchases/link-orphan-invoices");
    expect(link.status).not.toBe(429);

    // Jiná operace má vlastní KV klíč → nesmí být zablokovaná.
    const mark = await postAs("/admin/api/purchases/mark-invoices-paid");
    expect(mark.status).not.toBe(429);
  });
});
