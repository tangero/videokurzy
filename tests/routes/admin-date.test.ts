import { describe, expect, it } from "vitest";
import { normalizeSqlTimestampDate } from "../../src/routes/admin";

describe("normalizeSqlTimestampDate", () => {
  it("converts D1 aggregate integer seconds to Date", () => {
    const date = normalizeSqlTimestampDate(1780210383);

    expect(date).toBeInstanceOf(Date);
    expect(date?.toISOString()).toBe("2026-05-31T06:53:03.000Z");
  });

  it("keeps Date values from drizzle timestamp columns", () => {
    const original = new Date("2026-05-31T06:53:03.000Z");

    expect(normalizeSqlTimestampDate(original)).toEqual(original);
  });

  it("returns null for empty aggregate results", () => {
    expect(normalizeSqlTimestampDate(null)).toBeNull();
    expect(normalizeSqlTimestampDate(undefined)).toBeNull();
  });
});
