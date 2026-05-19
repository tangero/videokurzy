import { describe, expect, it } from "vitest";
import { applyDiscount } from "../../src/lib/discount";

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
