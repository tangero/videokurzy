import { describe, it, expect } from "vitest";
import { WATCH_SEGMENTS } from "../../src/lib/watch-stats";

// Čistá jednotka pro výpočet retenční křivky z pole maxSegment hodnot
// (stejná logika jako getRetentionCurve, bez DB — ověřuje matematiku).
function curveFrom(maxSegments: number[]): number[] {
  const curve = new Array<number>(WATCH_SEGMENTS).fill(0);
  for (const m of maxSegments) {
    const reached = Math.min(WATCH_SEGMENTS - 1, Math.max(0, Math.floor(m)));
    for (let s = 0; s <= reached; s++) curve[s]++;
  }
  return curve;
}

describe("retenční křivka", () => {
  it("segment 0 = všichni diváci, monotónně neklesající směrem dolů křivky", () => {
    const curve = curveFrom([0, 5, 10, 19]);
    expect(curve[0]).toBe(4); // všichni dosáhli aspoň segment 0
    expect(curve[5]).toBe(3); // ti, co dosáhli >= 5
    expect(curve[10]).toBe(2);
    expect(curve[19]).toBe(1);
    // křivka je nerostoucí
    for (let s = 1; s < WATCH_SEGMENTS; s++) {
      expect(curve[s]).toBeLessThanOrEqual(curve[s - 1]);
    }
  });

  it("prázdná data → samé nuly", () => {
    expect(curveFrom([])).toEqual(new Array(WATCH_SEGMENTS).fill(0));
  });

  it("hodnoty mimo rozsah se ořežou (drop-off detekce)", () => {
    const curve = curveFrom([100, -5]); // 100→19, -5→0
    expect(curve[19]).toBe(1);
    expect(curve[0]).toBe(2);
  });
});
