import { Hono } from "hono";
import { eq, asc, and } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Env, Variables } from "../types";
import { lesson, module, progress, lessonWatch } from "../db/schema";
import { shouldResume } from "../lib/watch-stats";
import { hasAccess } from "../lib/access";
import { generateSignedEmbedUrl } from "../lib/bunny";
import { WatchChyba2Page } from "../views/watch-chyba2";

// DEMO ROUTA #2 pro výuku (Claude Code) — SERVEROVÁ chyba.
// Padá při serverovém renderu, takže TypeError je vidět ve výstupu dev serveru
// (terminál) a stránka vrací 500. Funkční verze: watch.tsx (/watch/:slug).

const watchChyba2 = new Hono<{ Bindings: Env; Variables: Variables }>();

watchChyba2.get("/watch-chyba2/:slug", async (c) => {
  const slug = c.req.param("slug");
  const user = c.get("user");
  const db = drizzle(c.env.DB);

  const [found] = await db
    .select({
      id: lesson.id,
      title: lesson.title,
      slug: lesson.slug,
      bunnyVideoId: lesson.bunnyVideoId,
      durationSeconds: lesson.durationSeconds,
      isFree: lesson.isFree,
      moduleId: lesson.moduleId,
      sortOrder: lesson.sortOrder,
      chapters: lesson.chapters,
      bodyMarkdown: lesson.bodyMarkdown,
    })
    .from(lesson)
    .where(eq(lesson.slug, slug))
    .limit(1);

  if (!found) {
    return c.text("Epizoda nenalezena", 404);
  }

  // DEMO CHYBA: `moduleRow` je prázdné (dotaz na neexistující modul id=-1),
  // takže `moduleRow[0]` je undefined a `.title` níže padá. Oprava: `?.`
  const moduleRow = await db
    .select({ title: module.title })
    .from(module)
    .where(eq(module.id, -1))
    .limit(1);
  const moduleTitle = moduleRow[0].title;

  // Free lessons are accessible to everyone
  let hasPaidAccess = false;
  if (!found.isFree) {
    if (!user) {
      return c.redirect("/login");
    }
    hasPaidAccess = await hasAccess(user, db);
    if (!hasPaidAccess) {
      return c.redirect("/#cenik");
    }
  } else if (user) {
    hasPaidAccess = await hasAccess(user, db);
  }

  const [allLessons, allProgressRaw, watchRow] = await Promise.all([
    db
      .select({
        id: lesson.id,
        slug: lesson.slug,
        title: lesson.title,
        durationSeconds: lesson.durationSeconds,
        isFree: lesson.isFree,
        moduleId: lesson.moduleId,
        sortOrder: lesson.sortOrder,
      })
      .from(lesson)
      .innerJoin(module, eq(lesson.moduleId, module.id))
      .orderBy(asc(module.sortOrder), asc(lesson.sortOrder)),
    user
      ? db
          .select({ lessonId: progress.lessonId, completed: progress.completed })
          .from(progress)
          .where(eq(progress.userId, user.id))
      : Promise.resolve([] as { lessonId: number; completed: boolean }[]),
    user
      ? db
          .select({ lastPositionSeconds: lessonWatch.lastPositionSeconds })
          .from(lessonWatch)
          .where(
            and(eq(lessonWatch.userId, user.id), eq(lessonWatch.lessonId, found.id))
          )
          .limit(1)
      : Promise.resolve([] as { lastPositionSeconds: number }[]),
  ]);

  const allProgressIds = new Set(
    allProgressRaw.filter((p) => p.completed).map((p) => p.lessonId)
  );
  const completed = allProgressIds.has(found.id);

  const lastPosition = watchRow[0]?.lastPositionSeconds ?? 0;
  const resumePosition = shouldResume(lastPosition, found.durationSeconds, completed)
    ? lastPosition
    : null;

  const embedUrl = found.bunnyVideoId
    ? generateSignedEmbedUrl(
        c.env.BUNNY_LIBRARY_ID,
        found.bunnyVideoId,
        c.env.BUNNY_TOKEN_KEY,
        4,
        resumePosition ?? 0
      )
    : "";

  const globalIdx = allLessons.findIndex((l) => l.id === found.id);
  const prevSlug = globalIdx > 0 ? allLessons[globalIdx - 1].slug : null;
  const nextSlug = globalIdx < allLessons.length - 1 ? allLessons[globalIdx + 1].slug : null;

  const nearbyRaw = allLessons.slice(Math.max(0, globalIdx - 1), globalIdx + 6);
  const nearbyLessons = nearbyRaw.map((l) => ({
    ...l,
    completed: allProgressIds.has(l.id),
    globalIndex: allLessons.findIndex((al) => al.id === l.id),
  }));

  const nextLesson = globalIdx < allLessons.length - 1 ? allLessons[globalIdx + 1] : null;
  const isLastFreeLesson = found.isFree && (!nextLesson || !nextLesson.isFree);

  return c.html(
    <WatchChyba2Page
      user={user ?? { name: null, email: "" }}
      lesson={{ ...found, moduleTitle }}
      chapters={[]}
      bodyMarkdown={found.bodyMarkdown}
      embedUrl={embedUrl}
      completed={completed}
      prevSlug={prevSlug}
      nextSlug={nextSlug}
      hasPaidAccess={hasPaidAccess}
      loggedIn={Boolean(user)}
      resumePosition={resumePosition}
      isLastFreeLesson={isLastFreeLesson}
      nearbyLessons={nearbyLessons}
      lessonGlobalIndex={globalIdx}
    />
  );
});

export { watchChyba2 as watchChyba2Routes };
