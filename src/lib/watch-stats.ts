import { eq, and, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { lessonWatch } from "../db/schema";

/** Počet segmentů, na které dělíme každé video (křivka po 5 % délky). */
export const WATCH_SEGMENTS = 20;

export interface RecordWatchInput {
  userId: string;
  lessonId: number;
  maxSegment: number;
  watchedSeconds: number;
  positionSeconds: number;
}

/**
 * Zaznamená postup sledování. Upsert: maxSegment i watchedSeconds se posouvají
 * jen nahoru (max ze starého a nového) — klient posílá kumulativ za session,
 * max brání regresi při více otevřených tabech.
 *
 * Vrací `started: true`, pokud tohle byl PRVNÍ záznam pro daného uživatele+lekci
 * (volající pak může emitovat lesson.started event).
 */
export async function recordWatch(
  db: DrizzleD1Database,
  input: RecordWatchInput,
  now: Date
): Promise<{ started: boolean }> {
  const maxSegment = clampSegment(input.maxSegment);
  const watchedSeconds = Math.max(0, Math.floor(input.watchedSeconds));
  const lastPositionSeconds = Math.max(0, Math.floor(input.positionSeconds));

  const existing = await db
    .select({ userId: lessonWatch.userId })
    .from(lessonWatch)
    .where(
      and(eq(lessonWatch.userId, input.userId), eq(lessonWatch.lessonId, input.lessonId))
    )
    .limit(1);

  const started = existing.length === 0;

  await db
    .insert(lessonWatch)
    .values({
      userId: input.userId,
      lessonId: input.lessonId,
      maxSegment,
      watchedSeconds,
      lastPositionSeconds,
      startedAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [lessonWatch.userId, lessonWatch.lessonId],
      set: {
        maxSegment: sql`max(${lessonWatch.maxSegment}, ${maxSegment})`,
        watchedSeconds: sql`max(${lessonWatch.watchedSeconds}, ${watchedSeconds})`,
        lastPositionSeconds: lastPositionSeconds,
        updatedAt: now,
      },
    });

  return { started };
}

/**
 * Retenční křivka lekce: pole délky WATCH_SEGMENTS, kde index s = počet diváků,
 * kteří dosáhli segment s (tj. maxSegment >= s). Segment 0 = kolik vůbec spustilo.
 */
export async function getRetentionCurve(
  db: DrizzleD1Database,
  lessonId: number
): Promise<number[]> {
  const rows = await db
    .select({ maxSegment: lessonWatch.maxSegment })
    .from(lessonWatch)
    .where(eq(lessonWatch.lessonId, lessonId));

  const curve = new Array<number>(WATCH_SEGMENTS).fill(0);
  for (const r of rows) {
    const reached = clampSegment(r.maxSegment);
    for (let s = 0; s <= reached; s++) curve[s]++;
  }
  return curve;
}

function clampSegment(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(WATCH_SEGMENTS - 1, Math.max(0, Math.floor(value)));
}

/** Práh (v s) od začátku a před koncem, kdy ještě má smysl resumovat. */
const RESUME_EDGE_SECONDS = 15;

/**
 * Rozhodne, jestli při otevření lekce naskočit na uloženou pozici.
 * Resume jen pro nedokončenou lekci, pozici aspoň RESUME_EDGE_SECONDS do videa
 * a aspoň RESUME_EDGE_SECONDS před koncem (jinak start od 0).
 */
export function shouldResume(
  positionSeconds: number,
  durationSeconds: number,
  completed: boolean
): boolean {
  if (completed) return false;
  if (!Number.isFinite(positionSeconds) || !Number.isFinite(durationSeconds)) return false;
  if (durationSeconds <= 0) return false;
  if (positionSeconds <= RESUME_EDGE_SECONDS) return false;
  if (positionSeconds >= durationSeconds - RESUME_EDGE_SECONDS) return false;
  return true;
}
