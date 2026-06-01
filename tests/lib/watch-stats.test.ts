import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { WATCH_SEGMENTS, shouldResume, recordWatch } from "../../src/lib/watch-stats";

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

describe("shouldResume", () => {
  it("resumuje uprostřed nedokončené lekce", () => {
    expect(shouldResume(323, 600, false)).toBe(true);
  });

  it("neresumuje dokončenou lekci", () => {
    expect(shouldResume(323, 600, true)).toBe(false);
  });

  it("neresumuje, když je pozice příliš na začátku (<=15 s)", () => {
    expect(shouldResume(15, 600, false)).toBe(false);
    expect(shouldResume(5, 600, false)).toBe(false);
  });

  it("neresumuje, když je pozice blízko konce (<=15 s do konce)", () => {
    expect(shouldResume(590, 600, false)).toBe(false);
    expect(shouldResume(600, 600, false)).toBe(false);
  });

  it("hraniční hodnoty prahů (16 s start, 585/584 s konec) a neplatné vstupy", () => {
    expect(shouldResume(16, 600, false)).toBe(true);   // první resumovatelná pozice
    expect(shouldResume(585, 600, false)).toBe(false);  // přesně 15 s do konce → blok
    expect(shouldResume(584, 600, false)).toBe(true);   // těsně pod horní hranou
    expect(shouldResume(-5, 600, false)).toBe(false);   // záporná pozice
    expect(shouldResume(NaN, 600, false)).toBe(false);  // NaN pozice
  });

  it("neresumuje při nulové/neznámé pozici nebo délce", () => {
    expect(shouldResume(0, 600, false)).toBe(false);
    expect(shouldResume(323, 0, false)).toBe(false);
  });
});

describe("recordWatch — pozice", () => {
  it("ukládá lastPositionSeconds přepisem, segment/watched jen nahoru", async () => {
    const db = drizzle(env.DB);
    await env.DB.prepare(
      "INSERT INTO course (id, title, slug, description, published) VALUES (810, 'c', 'c-810', '', 1)"
    ).run();
    await env.DB.prepare(
      "INSERT INTO module (id, courseId, title, slug, sortOrder) VALUES (820, 810, 'm', 'm-820', 1)"
    ).run();
    await env.DB.prepare(
      "INSERT INTO lesson (id, moduleId, publicId, title, slug, durationSeconds, isFree, sortOrder) VALUES (830, 820, 'p-830', 'l', 'l-830', 600, 1, 1)"
    ).run();
    await env.DB.prepare(
      "INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES ('u-rw', 'U', 'u-rw@test.cz', 1, 0, 0)"
    ).run();

    const t = new Date(1_000_000);
    await recordWatch(db, { userId: "u-rw", lessonId: 830, maxSegment: 5, watchedSeconds: 120, positionSeconds: 150 }, t);
    // posun zpět (přetočení): pozice klesne, ale segment/watched zůstanou nahoře
    await recordWatch(db, { userId: "u-rw", lessonId: 830, maxSegment: 2, watchedSeconds: 60, positionSeconds: 40 }, t);

    const { results } = await env.DB.prepare(
      "SELECT maxSegment, watchedSeconds, lastPositionSeconds FROM lesson_watch WHERE userId='u-rw' AND lessonId=830"
    ).all<{ maxSegment: number; watchedSeconds: number; lastPositionSeconds: number }>();
    const row = results[0];

    expect(row.maxSegment).toBe(5); // jen nahoru
    expect(row.watchedSeconds).toBe(120); // jen nahoru
    expect(row.lastPositionSeconds).toBe(40); // přepis poslední hodnotou
  });
});
