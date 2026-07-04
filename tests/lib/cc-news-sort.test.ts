import { describe, expect, it } from "vitest";
import {
  versionSortKey,
  weekSortKey,
  sortNewsItems,
  type SortableNewsItem,
} from "../../src/lib/cc-news/sort";

describe("versionSortKey", () => {
  it("bere horní mez rozsahu", () => {
    expect(versionSortKey("v2.1.178–v2.1.183")).toBe(2_001_183);
  });

  it("řadí číselně, ne lexikograficky (v2.1.9 < v2.1.185)", () => {
    expect(versionSortKey("v2.1.9")! < versionSortKey("v2.1.185")!).toBe(true);
  });

  it("vrací null bez verze", () => {
    expect(versionSortKey(null)).toBeNull();
    expect(versionSortKey("žádná verze")).toBeNull();
  });
});

describe("weekSortKey", () => {
  it("vytáhne číslo týdne", () => {
    expect(weekSortKey("Week 26")).toBe(26);
  });
  it("null bez štítku", () => {
    expect(weekSortKey(null)).toBeNull();
  });
});

const item = (
  versionRange: string | null,
  weekLabel: string | null,
  createdAtMs: number,
): SortableNewsItem => ({
  versionRange,
  weekLabel,
  createdAt: new Date(createdAtMs),
});

describe("sortNewsItems", () => {
  it("řadí podle verze sestupně, i když je Week 25 vytvořený PO Week 26", () => {
    // Reprodukce reportovaného bugu: Week 25 dodělaný později (větší createdAt).
    const w25 = item("v2.1.178–v2.1.183", "Week 25", 2000);
    const w26 = item("v2.1.185–v2.1.193", "Week 26", 1000);
    const out = sortNewsItems([w25, w26]);
    expect(out[0]).toBe(w26); // novější verze nahoře
    expect(out[1]).toBe(w25);
  });

  it("fallback na číslo týdne, když chybí verze", () => {
    const a = item(null, "Week 21", 1000);
    const b = item(null, "Week 23", 1000);
    const out = sortNewsItems([a, b]);
    expect(out[0]).toBe(b);
  });

  it("prvky bez verze i týdne padají naspod", () => {
    const versioned = item("v2.1.100", "Week 10", 5000);
    const orphan = item(null, null, 9999);
    const out = sortNewsItems([orphan, versioned]);
    expect(out[0]).toBe(versioned);
    expect(out[1]).toBe(orphan);
  });

  it("je stabilní při úplné shodě", () => {
    const a = item("v2.1.100", "Week 10", 1000);
    const b = item("v2.1.100", "Week 10", 1000);
    const out = sortNewsItems([a, b]);
    expect(out[0]).toBe(a);
    expect(out[1]).toBe(b);
  });
});
