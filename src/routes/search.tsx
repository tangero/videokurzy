import { Hono } from "hono";
import { and, asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Env, Variables } from "../types";
import { lesson, module, progress } from "../db/schema";
import { hasAccess } from "../lib/access";
import { normalizeSearchQuery, searchLessons } from "../lib/lesson-search";
import { LessonSearchPage } from "../views/lesson-search";

const search = new Hono<{ Bindings: Env; Variables: Variables }>();

// Veřejné vyhledávání lekcí — funguje i pro nepřihlášené (ti vidí zamčené
// epizody s odkazem na ceník). Přihlášený navíc vidí dokončené lekce a přístup.
search.get("/hledat", async (c) => {
  const user = c.get("user");
  const layoutUser = user ? { name: user.name, email: user.email } : null;
  const query = normalizeSearchQuery(c.req.query("q"));

  if (!query) {
    return c.html(
      <LessonSearchPage user={layoutUser} search={null} hasPaidAccess={false} lessonNumbers={{}} />
    );
  }

  const db = drizzle(c.env.DB);
  const [hits, ordered, completedRows, hasPaidAccess] = await Promise.all([
    searchLessons(db, query),
    // Globální pořadí epizod (stejné číslování jako na dashboardu).
    db
      .select({ id: lesson.id })
      .from(lesson)
      .innerJoin(module, eq(lesson.moduleId, module.id))
      .orderBy(asc(module.sortOrder), asc(lesson.sortOrder)),
    user
      ? db
          .select({ lessonId: progress.lessonId })
          .from(progress)
          .where(and(eq(progress.userId, user.id), eq(progress.completed, true)))
      : Promise.resolve([] as { lessonId: number }[]),
    user ? hasAccess(user, db, c.env.KV) : Promise.resolve(false),
  ]);

  const completedSet = new Set(completedRows.map((r) => r.lessonId));
  const lessonNumbers = Object.fromEntries(ordered.map((l, i) => [l.id, i + 1]));

  return c.html(
    <LessonSearchPage
      user={layoutUser}
      search={{
        query,
        results: hits.map((h) => ({ ...h, completed: completedSet.has(h.id) })),
      }}
      hasPaidAccess={hasPaidAccess}
      lessonNumbers={lessonNumbers}
    />
  );
});

export { search as searchRoutes };
