import { describe, it, expect, beforeAll } from "vitest";
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import {
  LESSON_SEARCH_LIMIT,
  normalizeSearchQuery,
  searchLessons,
} from "../../src/lib/lesson-search";

async function insertLesson(
  id: number,
  moduleId: number,
  title: string,
  body: string | null,
  sortOrder: number
) {
  await env.DB.prepare(
    "INSERT INTO lesson (id, moduleId, publicId, title, slug, durationSeconds, isFree, sortOrder, bodyMarkdown) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(id, moduleId, `ls-${id}`, title, `ls-${id}`, 60, 0, sortOrder, body)
    .run();
}

beforeAll(async () => {
  await env.DB.prepare(
    "INSERT INTO course (id, title, slug, description, published) VALUES (?, ?, ?, ?, ?)"
  )
    .bind(901, "Kurz", "kurz-search", "", 1)
    .run();
  await env.DB.prepare(
    "INSERT INTO module (id, courseId, title, slug, sortOrder) VALUES (?, ?, ?, ?, ?)"
  )
    .bind(911, 901, "První modul", "m1-search", 1)
    .run();
  await env.DB.prepare(
    "INSERT INTO module (id, courseId, title, slug, sortOrder) VALUES (?, ?, ?, ?, ?)"
  )
    .bind(912, 901, "Druhý modul", "m2-search", 2)
    .run();

  // Shoda jen v popisu, ale dřív v osnově — musí skončit ZA shodami v názvu.
  await insertLesson(9101, 911, "Úvod do práce", "Jak napsat dobrý Prompt pro agenta.", 1);
  await insertLesson(9102, 912, "Prompt engineering", null, 1);
  await insertLesson(9103, 911, "Druhý prompt", "Bez shody v textu.", 2);
  await insertLesson(9104, 911, "Nesouvisející", "Nic tu není.", 3);
  await insertLesson(9105, 912, "Sleva 100% na kurz", null, 2);
  await insertLesson(9106, 912, "Sleva 100 procent", null, 3);

  // Nezveřejněný kurz — jeho lekce se nesmí ve veřejném hledání objevit.
  await env.DB.prepare(
    "INSERT INTO course (id, title, slug, description, published) VALUES (?, ?, ?, ?, ?)"
  )
    .bind(902, "Rozpracovaný", "kurz-draft-search", "", 0)
    .run();
  await env.DB.prepare(
    "INSERT INTO module (id, courseId, title, slug, sortOrder) VALUES (?, ?, ?, ?, ?)"
  )
    .bind(921, 902, "Tajný modul", "m-draft-search", 3)
    .run();
  await insertLesson(9301, 921, "Tajná lekce", "Rozpracovaný prompt.", 1);
});

describe("normalizeSearchQuery", () => {
  it("prázdný / jen mezery → null", () => {
    expect(normalizeSearchQuery(undefined)).toBeNull();
    expect(normalizeSearchQuery("   ")).toBeNull();
  });

  it("ořízne okraje, sloučí mezery a omezí délku", () => {
    expect(normalizeSearchQuery("  claude   code ")).toBe("claude code");
    expect(normalizeSearchQuery("x".repeat(500))!.length).toBe(100);
  });
});

describe("searchLessons", () => {
  const db = () => drizzle(env.DB);

  it("vynechá lekce z nezveřejněných kurzů", async () => {
    expect(await searchLessons(db(), "Tajná")).toEqual([]);
    const ids = (await searchLessons(db(), "prompt")).map((h) => h.id);
    expect(ids).not.toContain(9301);
  });

  it("shoda v názvu má přednost před shodou v popisu, jinak pořadí osnovy", async () => {
    const hits = await searchLessons(db(), "prompt");
    expect(hits.map((h) => h.id)).toEqual([9103, 9102, 9101]);
    expect(hits.map((h) => h.matchedIn)).toEqual(["title", "title", "body"]);
    expect(hits[0].moduleTitle).toBe("První modul");
  });

  it("je case-insensitive (ASCII)", async () => {
    const hits = await searchLessons(db(), "PROMPT ENGINEERING");
    expect(hits.map((h) => h.id)).toEqual([9102]);
  });

  it("% a _ v dotazu se berou doslova, ne jako wildcard", async () => {
    expect((await searchLessons(db(), "100%")).map((h) => h.id)).toEqual([9105]);
    expect(await searchLessons(db(), "_")).toEqual([]);
  });

  it("bez shody → prázdné pole", async () => {
    expect(await searchLessons(db(), "kubernetes")).toEqual([]);
  });

  it(`vrací nejvýš ${LESSON_SEARCH_LIMIT} výsledků`, async () => {
    for (let i = 0; i < LESSON_SEARCH_LIMIT + 5; i++) {
      await insertLesson(9200 + i, 912, `Hromadná lekce ${i}`, null, 100 + i);
    }
    const hits = await searchLessons(db(), "Hromadná");
    expect(hits).toHaveLength(LESSON_SEARCH_LIMIT);
  });
});
