import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import {
  checkAdminCooldown,
  ADMIN_INVOICE_COOLDOWN_MS,
} from "../../src/routes/admin";

// Finanční admin operace (link-orphan-invoices, mark-invoices-paid,
// issue-missing-invoices) mají KV cooldown (finding 13): druhé rychlé spuštění
// musí být zamítnuto. Cooldown řeší helper `checkAdminCooldown`, který je
// společným jádrem všech tří handlerů — testujeme ho přímo nad reálným KV
// (cloudflare:test), čímž se vyhneme křehkému skládání better-auth session
// cookie v testu. Vazba helperu na jednotlivé endpointy (3 oddělené KV klíče,
// návrat 429) je triviální pass-through a je pokrytá typy.

const KEYS = [
  "admin_cooldown:link-orphan-invoices",
  "admin_cooldown:mark-invoices-paid",
  "admin_cooldown:issue-missing-invoices",
];

describe("checkAdminCooldown (admin financial-operation cooldowns)", () => {
  beforeEach(async () => {
    await Promise.all(KEYS.map((k) => env.KV.delete(k)));
  });

  for (const key of KEYS) {
    it(`povolí první spuštění a zablokuje druhé okamžité (${key})`, async () => {
      // První spuštění: cooldown není aktivní → false (operace smí pokračovat).
      const first = await checkAdminCooldown(
        env.KV,
        key,
        ADMIN_INVOICE_COOLDOWN_MS,
      );
      expect(first).toBe(false);

      // Druhé okamžité spuštění ve stejném okně → true (zamítnout 429).
      const second = await checkAdminCooldown(
        env.KV,
        key,
        ADMIN_INVOICE_COOLDOWN_MS,
      );
      expect(second).toBe(true);
    });
  }

  it("cooldowny operací se vzájemně neblokují (oddělené KV klíče)", async () => {
    const link = await checkAdminCooldown(
      env.KV,
      "admin_cooldown:link-orphan-invoices",
      ADMIN_INVOICE_COOLDOWN_MS,
    );
    expect(link).toBe(false);

    // Jiná operace má vlastní KV klíč → nesmí být zablokovaná.
    const mark = await checkAdminCooldown(
      env.KV,
      "admin_cooldown:mark-invoices-paid",
      ADMIN_INVOICE_COOLDOWN_MS,
    );
    expect(mark).toBe(false);
  });

  it("uplynulé okno cooldown uvolní", async () => {
    const key = "admin_cooldown:mark-invoices-paid";
    // Nasimuluj staré spuštění před více než cooldown oknem.
    await env.KV.put(key, String(Date.now() - ADMIN_INVOICE_COOLDOWN_MS - 1000));
    const allowed = await checkAdminCooldown(
      env.KV,
      key,
      ADMIN_INVOICE_COOLDOWN_MS,
    );
    expect(allowed).toBe(false);
  });
});
