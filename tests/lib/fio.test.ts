import { describe, expect, it } from "vitest";
import { generateVariableSymbol, matchPayment } from "../../src/lib/fio";
import type { FioTransaction } from "../../src/lib/fio";

// ─── helpers ─────────────────────────────────────────────────────

function makeTx(overrides: {
  vs?: string;
  amount?: number;
  currency?: string;
  id?: number;
  senderName?: string;
} = {}): FioTransaction {
  return {
    column0: { value: "2026-04-19", name: "Datum", id: 0 },
    column1: { value: overrides.amount ?? 2000, name: "Objem", id: 1 },
    column2: { value: "1234567890/0800", name: "Protiucet", id: 2 },
    column5: { value: overrides.vs ?? "33100001", name: "VS", id: 5 },
    column10: { value: overrides.senderName ?? "Jan Novák", name: "Název", id: 10 },
    column14: { value: overrides.currency ?? "CZK", name: "Měna", id: 14 },
    column16: null,
    column22: { value: overrides.id ?? 1001, name: "ID pohybu", id: 22 },
  };
}

// ─── generateVariableSymbol ───────────────────────────────────────

describe("generateVariableSymbol", () => {
  it("generates 8-character string starting with '33'", () => {
    const vs = generateVariableSymbol();
    expect(vs).toHaveLength(8);
    expect(vs.startsWith("33")).toBe(true);
  });

  it("tail is in range 100000–999999", () => {
    for (let i = 0; i < 5; i++) {
      const tail = parseInt(generateVariableSymbol().slice(2), 10);
      expect(tail).toBeGreaterThanOrEqual(100000);
      expect(tail).toBeLessThanOrEqual(999999);
    }
  });

  it("generates unique values", () => {
    const values = new Set(Array.from({ length: 20 }, () => generateVariableSymbol()));
    expect(values.size).toBe(20);
  });
});

// ─── matchPayment ─────────────────────────────────────────────────

describe("matchPayment", () => {
  it("matches when VS, amount, and CZK align", () => {
    const result = matchPayment([makeTx()], "33100001", 2000);
    expect(result.found).toBe(true);
    expect(result.transaction?.id).toBe(1001);
    expect(result.transaction?.amount).toBe(2000);
    expect(result.transaction?.senderName).toBe("Jan Novák");
  });

  it("strips leading zeros from transaction VS before comparison", () => {
    const result = matchPayment([makeTx({ vs: "0033100001" })], "33100001", 2000);
    expect(result.found).toBe(true);
  });

  it("strips leading zeros from expected VS before comparison", () => {
    const result = matchPayment([makeTx({ vs: "33100001" })], "0033100001", 2000);
    expect(result.found).toBe(true);
  });

  it("rejects wrong amount", () => {
    expect(matchPayment([makeTx({ amount: 1999 })], "33100001", 2000).found).toBe(false);
  });

  it("rejects wrong VS", () => {
    expect(matchPayment([makeTx({ vs: "33100002" })], "33100001", 2000).found).toBe(false);
  });

  it("rejects non-CZK currency", () => {
    expect(matchPayment([makeTx({ currency: "EUR" })], "33100001", 2000).found).toBe(false);
  });

  it("rejects negative amount", () => {
    expect(matchPayment([makeTx({ amount: -2000 })], "33100001", 2000).found).toBe(false);
  });

  it("rejects zero amount", () => {
    expect(matchPayment([makeTx({ amount: 0 })], "33100001", 2000).found).toBe(false);
  });

  it("skips transaction id in excludeSet", () => {
    const result = matchPayment([makeTx({ id: 999 })], "33100001", 2000, new Set([999]));
    expect(result.found).toBe(false);
  });

  it("returns not-found for empty list", () => {
    expect(matchPayment([], "33100001", 2000).found).toBe(false);
  });

  it("returns first matching transaction from list", () => {
    const txs = [
      makeTx({ id: 1, vs: "33200000", amount: 500 }),
      makeTx({ id: 2, vs: "33100001", amount: 2000 }),
    ];
    const result = matchPayment(txs, "33100001", 2000);
    expect(result.found).toBe(true);
    expect(result.transaction?.id).toBe(2);
  });

  it("handles null column5 (no VS on transaction) as no-match", () => {
    const tx: FioTransaction = { ...makeTx(), column5: null };
    expect(matchPayment([tx], "33100001", 2000).found).toBe(false);
  });
});
