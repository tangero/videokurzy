import { and, asc, eq, or, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { course, lesson, module } from "../db/schema";

// Vyhledávání lekcí na dashboardu. MVP přes SQLite LIKE (FTS5 zatím nepotřebujeme).
// Pozor: LIKE v SQLite ignoruje velikost písmen jen u ASCII — „č" ≠ „Č".

export const LESSON_SEARCH_LIMIT = 20;
export const LESSON_SEARCH_MAX_QUERY_LENGTH = 100;

export type LessonSearchHit = {
  id: number;
  title: string;
  slug: string;
  durationSeconds: number;
  isFree: boolean;
  moduleTitle: string;
  /** Kde dotaz sedí: v názvu (vyšší relevance), jinak jen v popisu (bodyMarkdown). */
  matchedIn: "title" | "body";
};

/** Oříznutí a normalizace dotazu z query stringu. Prázdný → null (bez vyhledávání). */
export function normalizeSearchQuery(raw: string | undefined): string | null {
  const q = (raw ?? "").trim().replace(/\s+/g, " ").slice(0, LESSON_SEARCH_MAX_QUERY_LENGTH);
  return q.length > 0 ? q : null;
}

// Uživatelský vstup nesmí fungovat jako LIKE wildcard — escapujeme \, % a _.
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

export async function searchLessons(
  db: DrizzleD1Database,
  query: string
): Promise<LessonSearchHit[]> {
  const pattern = `%${escapeLike(query)}%`;
  const titleMatch = sql`${lesson.title} LIKE ${pattern} ESCAPE '\\'`;
  const bodyMatch = sql`${lesson.bodyMarkdown} LIKE ${pattern} ESCAPE '\\'`;
  // Relevance: shoda v názvu (0) před shodou jen v popisu (1); v rámci skupiny pořadí osnovy.
  const rank = sql<number>`CASE WHEN ${titleMatch} THEN 0 ELSE 1 END`;

  const rows = await db
    .select({
      id: lesson.id,
      title: lesson.title,
      slug: lesson.slug,
      durationSeconds: lesson.durationSeconds,
      isFree: lesson.isFree,
      moduleTitle: module.title,
      rank,
    })
    .from(lesson)
    .innerJoin(module, eq(lesson.moduleId, module.id))
    // Jen zveřejněné kurzy — /hledat je veřejné a nesmí prozradit rozpracovaný obsah.
    .innerJoin(course, eq(module.courseId, course.id))
    .where(and(eq(course.published, true), or(titleMatch, bodyMatch)))
    .orderBy(rank, asc(module.sortOrder), asc(lesson.sortOrder))
    .limit(LESSON_SEARCH_LIMIT);

  return rows.map(({ rank: r, ...hit }) => ({
    ...hit,
    matchedIn: Number(r) === 0 ? "title" : "body",
  }));
}
