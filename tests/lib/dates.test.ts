import { describe, expect, it } from "vitest";
import { fmtDate, fmtDateTime } from "../../src/lib/dates";

const MS = Date.parse("2026-06-21T08:30:00.000Z");

describe("fmtDate", () => {
  it("default: numeric měsíc, fallback —", () => {
    expect(fmtDate(MS)).toBe("21. 6. 2026");
    expect(fmtDate(null)).toBe("—");
    expect(fmtDate(0)).toBe("—");
  });

  it("month:long + vlastní fallback", () => {
    expect(fmtDate(MS, { month: "long" })).toBe("21. června 2026");
    expect(fmtDate(null, { fallback: "" })).toBe("");
  });
});

describe("fmtDateTime", () => {
  it("datum + čas, fallback", () => {
    // čas závisí na lokální TZ runneru → ověř jen datovou část a tvar
    expect(fmtDateTime(MS)).toMatch(/21\. 6\. 2026/);
    expect(fmtDateTime(null)).toBe("—");
    expect(fmtDateTime(null, "nikdy")).toBe("nikdy");
  });
});
