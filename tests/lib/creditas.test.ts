import { describe, expect, it } from "vitest";
import {
  generateCreditasVariableSymbol,
  matchCreditasPayment,
} from "../../src/lib/creditas";
import type { CreditasTransaction } from "../../src/lib/creditas";

// ─── helpers ─────────────────────────────────────────────────────

function makeTx(overrides: {
  vs?: string;
  amount?: string;
  currency?: string;
  id?: string;
  senderName?: string;
} = {}): CreditasTransaction {
  return {
    transactionId: overrides.id ?? "tx-1001",
    amount: {
      value: overrides.amount ?? "2000",
      currency: overrides.currency ?? "CZK",
    },
    variableSymbol: overrides.vs ?? "34100001",
    effectiveDate: "2026-04-19",
    partnerAccount: { partnerName: overrides.senderName ?? "Jan Novák" },
  };
}

// ─── generateCreditasVariableSymbol ───────────────────────────────

describe("generateCreditasVariableSymbol", () => {
  it("generates 8-character string starting with '34'", () => {
    const vs = generateCreditasVariableSymbol();
    expect(vs).toHaveLength(8);
    expect(vs.startsWith("34")).toBe(true);
  });

  it("tail is in range 100000–999999", () => {
    for (let i = 0; i < 5; i++) {
      const tail = parseInt(generateCreditasVariableSymbol().slice(2), 10);
      expect(tail).toBeGreaterThanOrEqual(100000);
      expect(tail).toBeLessThanOrEqual(999999);
    }
  });

  it("generates unique values", () => {
    const values = new Set(Array.from({ length: 20 }, () => generateCreditasVariableSymbol()));
    expect(values.size).toBe(20);
  });
});

// ─── matchCreditasPayment ─────────────────────────────────────────

describe("matchCreditasPayment", () => {
  it("matches when VS, amount, and CZK align", () => {
    const result = matchCreditasPayment([makeTx()], "34100001", 2000);
    expect(result.found).toBe(true);
    expect(result.transaction?.id).toBe("tx-1001");
    expect(result.transaction?.amount).toBe(2000);
    expect(result.transaction?.senderName).toBe("Jan Novák");
  });

  it("parses decimal amount.value string", () => {
    const result = matchCreditasPayment([makeTx({ amount: "2000.00" })], "34100001", 2000);
    expect(result.found).toBe(true);
  });

  it("strips leading zeros from transaction VS before comparison", () => {
    const result = matchCreditasPayment([makeTx({ vs: "0034100001" })], "34100001", 2000);
    expect(result.found).toBe(true);
  });

  it("strips leading zeros from expected VS before comparison", () => {
    const result = matchCreditasPayment([makeTx({ vs: "34100001" })], "0034100001", 2000);
    expect(result.found).toBe(true);
  });

  it("rejects wrong amount", () => {
    expect(matchCreditasPayment([makeTx({ amount: "1999" })], "34100001", 2000).found).toBe(false);
  });

  it("rejects wrong VS", () => {
    expect(matchCreditasPayment([makeTx({ vs: "34100002" })], "34100001", 2000).found).toBe(false);
  });

  it("rejects non-CZK currency", () => {
    expect(matchCreditasPayment([makeTx({ currency: "EUR" })], "34100001", 2000).found).toBe(false);
  });

  it("rejects negative amount (odchozí platba)", () => {
    expect(matchCreditasPayment([makeTx({ amount: "-2000" })], "34100001", 2000).found).toBe(false);
  });

  it("rejects zero amount", () => {
    expect(matchCreditasPayment([makeTx({ amount: "0" })], "34100001", 2000).found).toBe(false);
  });

  it("skips transaction id in excludeSet", () => {
    const result = matchCreditasPayment([makeTx({ id: "tx-999" })], "34100001", 2000, new Set(["tx-999"]));
    expect(result.found).toBe(false);
  });

  it("returns not-found for empty list", () => {
    expect(matchCreditasPayment([], "34100001", 2000).found).toBe(false);
  });

  it("returns first matching transaction from list", () => {
    const txs = [
      makeTx({ id: "tx-1", vs: "34200000", amount: "500" }),
      makeTx({ id: "tx-2", vs: "34100001", amount: "2000" }),
    ];
    const result = matchCreditasPayment(txs, "34100001", 2000);
    expect(result.found).toBe(true);
    expect(result.transaction?.id).toBe("tx-2");
  });

  it("handles missing variableSymbol as no-match", () => {
    const tx: CreditasTransaction = { ...makeTx(), variableSymbol: undefined };
    expect(matchCreditasPayment([tx], "34100001", 2000).found).toBe(false);
  });
});
