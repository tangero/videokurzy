import { env, SELF } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { describe, it, expect, beforeEach } from "vitest";
import { purchase } from "../../src/db/schema";

// Částka na zálohovém dokladu se formátuje stejně jako v src/lib/proforma.ts
// (toLocaleString("cs-CZ")). Oddělovač tisíců je nedělitelná mezera, jejíž
// přesný kódový bod závisí na ICU runtime — proto očekávané řetězce počítáme
// stejným voláním, aby test nebyl křehký vůči verzi ICU.
function fmtCzk(n: number): string {
  return n.toLocaleString("cs-CZ");
}

async function clearPurchases() {
  await env.DB.prepare("DELETE FROM purchase").run();
}

async function clearSiteConfig() {
  await env.DB.prepare(
    "DELETE FROM site_config WHERE key IN ('price_individual', 'price_organization')",
  ).run();
}

async function setIndividualPrice(price: number) {
  await env.DB.prepare(
    "INSERT OR REPLACE INTO site_config (key, value) VALUES ('price_individual', ?)",
  ).bind(String(price)).run();
}

async function seedPendingFio(
  vs: string,
  opts: { amountPaid: number; discountPercent?: number; accessToken?: string },
) {
  const db = drizzle(env.DB);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 14 * 86400 * 1000);
  await db.insert(purchase).values({
    email: "buyer@example.com",
    userId: null,
    type: "individual",
    paymentMethod: "fio",
    variableSymbol: vs,
    status: "pending",
    expiresAt,
    createdAt: now,
    discountPercent: opts.discountPercent ?? 0,
    amountPaid: opts.amountPaid,
    proformaNumber: "ZD-2025-001",
    proformaIssuedAt: now,
    accessToken: opts.accessToken ?? null,
  });
}

describe("GET /checkout/proforma/:vs", () => {
  beforeEach(async () => {
    await clearPurchases();
    await clearSiteConfig();
  });

  it("renders the stored order-time amount, not the current price list", async () => {
    // Objednávka vznikla za 1800 Kč; ceník se mezitím změnil na 2500 Kč.
    await seedPendingFio("9876543210", { amountPaid: 1800 });
    await setIndividualPrice(2500);

    // Legacy VS lookup vyžaduje důvěryhodnou CF-Connecting-IP (jinak rate_limited).
    const res = await SELF.fetch("https://test.local/checkout/proforma/9876543210", {
      headers: { "CF-Connecting-IP": "9.9.9.9" },
    });

    expect(res.status).toBe(200);
    const html = await res.text();
    // Uložená částka z doby objednávky.
    expect(html).toContain(fmtCzk(1800));
    // NESMÍ použít aktuální ceník.
    expect(html).not.toContain(fmtCzk(2500));
  });

  it("najde objednávku přes nehádatelný accessToken (oprava IDOR)", async () => {
    await seedPendingFio("9876543211", { amountPaid: 1800, accessToken: "paytest-abc123def456ghi" });
    await setIndividualPrice(2500);

    const res = await SELF.fetch(
      "https://test.local/checkout/proforma/paytest-abc123def456ghi",
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain(fmtCzk(1800));
  });
});

describe("IDOR ochrana legacy VS lookupu", () => {
  beforeEach(async () => {
    await clearPurchases();
    // Vyčisti rate-limit kbelík z předchozích testů.
    await env.KV.delete("pay_lookup_rate:1.2.3.4");
  });

  it("rate-limituje enumeraci VS na pay stránce (11. request → 429)", async () => {
    await seedPendingFio("3312345", { amountPaid: 2000 });
    const headers = { "CF-Connecting-IP": "1.2.3.4" };

    // 10 requestů projde (vrátí 200 nebo redirect/404 podle stavu), 11. je 429.
    let got429 = false;
    for (let i = 0; i < 12; i++) {
      const res = await SELF.fetch("https://test.local/checkout/pay/3312345", {
        headers,
        redirect: "manual",
      });
      if (res.status === 429) {
        got429 = true;
        break;
      }
    }
    expect(got429).toBe(true);
  });

  it("legacy VS bez důvěryhodné CF-Connecting-IP → rate_limited (anti-spoof)", async () => {
    await seedPendingFio("3355555", { amountPaid: 2000 });
    // Bez CF-Connecting-IP (jen spoofovatelný x-forwarded-for) → 429.
    const res = await SELF.fetch("https://test.local/checkout/pay/3355555", {
      headers: { "x-forwarded-for": "1.1.1.1" },
      redirect: "manual",
    });
    expect(res.status).toBe(429);
  });

  it("token lookup rate-limitu NEpodléhá (nehádatelný)", async () => {
    await seedPendingFio("3399999", { amountPaid: 2000, accessToken: "paytest-unlimited-access9" });
    const headers = { "CF-Connecting-IP": "5.6.7.8" };

    // 15 requestů přes token — žádný 429.
    for (let i = 0; i < 15; i++) {
      const res = await SELF.fetch(
        "https://test.local/checkout/pay/paytest-unlimited-access9",
        { headers, redirect: "manual" },
      );
      expect(res.status).not.toBe(429);
    }
  });
});
