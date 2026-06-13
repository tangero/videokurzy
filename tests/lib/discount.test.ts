import { describe, expect, it } from "vitest";
import { applyDiscount, expectedPaymentAmount } from "../../src/lib/discount";

describe("applyDiscount", () => {
  it("returns original price when percent is 0", () => {
    expect(applyDiscount(2000, 0)).toBe(2000);
  });

  it("applies 50% discount", () => {
    expect(applyDiscount(2000, 50)).toBe(1000);
  });

  it("applies 30% discount and floors result", () => {
    expect(applyDiscount(2000, 30)).toBe(1400);
    expect(applyDiscount(1999, 30)).toBe(1399); // 1399.3 → floor 1399
  });

  it("clamps percent to 100", () => {
    expect(applyDiscount(2000, 150)).toBe(0);
  });

  it("treats negative percent as no discount", () => {
    expect(applyDiscount(2000, -10)).toBe(2000);
  });

  it("rounds down to whole CZK", () => {
    expect(applyDiscount(1999, 50)).toBe(999); // 999.5 → floor 999
  });
});

describe("expectedPaymentAmount", () => {
  it("prefers the fixed amountPaid from order time", () => {
    // Objednávka vystavená za starou cenu 15000; ceník mezitím zdražil na 30000.
    // Párovat se musí proti 15000 (suma na faktuře), ne proti novému ceníku.
    expect(expectedPaymentAmount(15000, 30000, 0)).toBe(15000);
  });

  it("ignores current price list when amountPaid is set, even with a discount", () => {
    expect(expectedPaymentAmount(1500, 3000, 50)).toBe(1500);
  });

  it("falls back to discounted full price when amountPaid is zero (legacy orders)", () => {
    expect(expectedPaymentAmount(0, 3000, 50)).toBe(1500);
  });

  it("falls back to full price with no discount when amountPaid is zero", () => {
    expect(expectedPaymentAmount(0, 30000, 0)).toBe(30000);
  });
});
