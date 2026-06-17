import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/d1";
import { purchase } from "../../src/db/schema";
import { scanBankPayments } from "../../src/scheduled";

// Pojistka proti tiché misconfiguraci banky: když je pending převodová objednávka,
// ale chybí produkční secret dané banky, fetch spadne do dev fallbacku a vrátí
// prázdno BEZ chyby. Scan by mlčel a platby by uvízly napořád (přesně to způsobil
// špatně pojmenovaný Creditas secret CREDITAS_API_KEY místo CREDITAS_API_TOKEN).
// scanBankPayments to musí ohlásit explicitním errorem.

function makeEnv(extra: Partial<Record<string, unknown>> = {}) {
  return {
    ...env,
    KV: { get: async () => null, put: async () => {} },
    ...extra,
  } as never;
}

async function insertCreditasPending() {
  const db = drizzle(env.DB);
  await db.insert(purchase).values({
    email: "firma@example.cz",
    type: "organization",
    paymentMethod: "creditas",
    variableSymbol: "34999001",
    status: "pending",
    kind: "paid",
    amountPaid: 15000,
    expiresAt: new Date("2027-01-01T00:00:00.000Z"),
    createdAt: new Date("2026-06-01T00:00:00.000Z"),
  });
}

describe("scanBankPayments — pojistka proti chybějícímu bankovnímu tokenu", () => {
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM purchase");
  });

  it("hlásí explicitní chybu, když je Creditas pending objednávka, ale token chybí", async () => {
    await insertCreditasPending();
    const result = await scanBankPayments(
      drizzle(env.DB),
      makeEnv({ CREDITAS_API_TOKEN: "dev", CREDITAS_IDENTIFIKATOR: "" }),
    );

    expect(result.matched).toBe(0);
    expect(result.errors.some((e) => e.includes("Creditas token/identifikátor nenastaven"))).toBe(true);
  });

  it("hlásí chybu i když je token nastaven, ale chybí identifikátor", async () => {
    await insertCreditasPending();
    const result = await scanBankPayments(
      drizzle(env.DB),
      makeEnv({ CREDITAS_API_TOKEN: "real-token", CREDITAS_IDENTIFIKATOR: "" }),
    );

    expect(result.errors.some((e) => e.includes("Creditas token/identifikátor nenastaven"))).toBe(true);
  });

  it("nehlásí Creditas chybu, když žádná Creditas objednávka pending není", async () => {
    // Žádná pending objednávka → scan vrací prázdno bez warningu.
    const result = await scanBankPayments(
      drizzle(env.DB),
      makeEnv({ CREDITAS_API_TOKEN: "dev", CREDITAS_IDENTIFIKATOR: "" }),
    );

    expect(result.errors.some((e) => e.includes("Creditas token/identifikátor nenastaven"))).toBe(false);
  });
});
