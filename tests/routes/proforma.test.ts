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
  opts: { amountPaid: number; discountPercent?: number },
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

    const res = await SELF.fetch("https://test.local/checkout/proforma/9876543210");

    expect(res.status).toBe(200);
    const html = await res.text();
    // Uložená částka z doby objednávky.
    expect(html).toContain(fmtCzk(1800));
    // NESMÍ použít aktuální ceník.
    expect(html).not.toContain(fmtCzk(2500));
  });
});
