import { Hono } from "hono";
import { eq, asc, and } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Env, Variables } from "../types";
import { authMiddleware, requireAuth } from "../middleware/auth";
import { lesson, module, progress, lessonWatch } from "../db/schema";
import { shouldResume } from "../lib/watch-stats";
import { hasAccess } from "../lib/access";
import { generateSignedEmbedUrl } from "../lib/bunny";
import { WatchPage } from "../views/watch";
import { NotFoundError } from "../lib/errors";

const watch = new Hono<{ Bindings: Env; Variables: Variables }>();

type LessonChapter = {
  title: string;
  start: number;
  end: number;
};

function parseLessonChapters(value: string | null): LessonChapter[] {
  if (!value) return [];

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((item): LessonChapter | null => {
        if (!item || typeof item !== "object") return null;
        const chapter = item as Record<string, unknown>;
        const title = typeof chapter.title === "string" ? chapter.title.trim() : "";
        const start = Number(chapter.start);
        const end = Number(chapter.end);
        if (!title || !Number.isFinite(start) || start < 0) return null;

        return {
          title,
          start: Math.floor(start),
          end: Number.isFinite(end) && end > start ? Math.floor(end) : Math.floor(start),
        };
      })
      .filter((chapter): chapter is LessonChapter => chapter !== null)
      .sort((a, b) => a.start - b.start);
  } catch {
    return [];
  }
}

watch.get("/watch/:slug", async (c) => {
  const slug = c.req.param("slug");
  const user = c.get("user");
  const db = drizzle(c.env.DB);

  // Find lesson by slug
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
    throw new NotFoundError("Epizoda nenalezena");
  }

  // Free lessons are accessible to everyone
  let hasPaidAccess = false;
  if (!found.isFree) {
    if (!user) {
      return c.redirect("/login");
    }

    // Platform-wide access check (no courseId needed). Admins bypass paywall.
    hasPaidAccess = await hasAccess(user, db, c.env.KV);
    if (!hasPaidAccess) {
      return c.redirect("/#cenik");
    }
  } else if (user) {
    hasPaidAccess = await hasAccess(user, db, c.env.KV);
  }

  const [allLessons, allProgressRaw, moduleRow, watchRow] = await Promise.all([
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
    db
      .select({ title: module.title })
      .from(module)
      .where(eq(module.id, found.moduleId))
      .limit(1),
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
    <WatchPage
      user={user ?? { name: null, email: "" }}
      lesson={{ ...found, moduleTitle: moduleRow[0]?.title }}
      chapters={parseLessonChapters(found.chapters)}
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

export { watch as watchRoutes };
