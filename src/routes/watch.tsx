import { Hono } from "hono";
import { eq, and, asc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Env, Variables } from "../types";
import { authMiddleware, requireAuth } from "../middleware/auth";
import { lesson, module, progress } from "../db/schema";
import { hasAccess } from "../lib/access";
import { generateSignedEmbedUrl } from "../lib/bunny";
import { WatchPage } from "../views/watch";

const watch = new Hono<{ Bindings: Env; Variables: Variables }>();

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
    })
    .from(lesson)
    .where(eq(lesson.slug, slug))
    .limit(1);

  if (!found) {
    return c.text("Epizoda nenalezena", 404);
  }

  // Free lessons are accessible to everyone
  if (!found.isFree) {
    if (!user) {
      return c.redirect("/login");
    }

    // Check purchase / org access
    // We need the courseId — get it via module
    const [mod] = await db
      .select({ courseId: module.courseId })
      .from(module)
      .where(eq(module.id, found.moduleId))
      .limit(1);

    if (!mod) return c.text("Modul nenalezen", 404);

    const canAccess = await hasAccess(user.id, user.email, mod.courseId, db);
    if (!canAccess) {
      return c.redirect("/#cenik");
    }
  }

  // Generate signed Bunny embed URL
  const embedUrl = found.bunnyVideoId
    ? generateSignedEmbedUrl(
        c.env.BUNNY_LIBRARY_ID,
        found.bunnyVideoId,
        c.env.BUNNY_TOKEN_KEY
      )
    : "";

  // Get completion status
  let completed = false;
  if (user) {
    const [prog] = await db
      .select({ completed: progress.completed })
      .from(progress)
      .where(
        and(eq(progress.userId, user.id), eq(progress.lessonId, found.id))
      )
      .limit(1);
    completed = prog?.completed ?? false;
  }

  // Get prev/next lessons (all lessons in the same module, ordered)
  const moduleLessons = await db
    .select({ slug: lesson.slug, sortOrder: lesson.sortOrder })
    .from(lesson)
    .where(eq(lesson.moduleId, found.moduleId))
    .orderBy(asc(lesson.sortOrder));

  const currentIdx = moduleLessons.findIndex((l) => l.slug === found.slug);
  const prevSlug = currentIdx > 0 ? moduleLessons[currentIdx - 1].slug : null;
  const nextSlug =
    currentIdx < moduleLessons.length - 1
      ? moduleLessons[currentIdx + 1].slug
      : null;

  return c.html(
    <WatchPage
      user={user ?? { name: null, email: "" }}
      lesson={found}
      embedUrl={embedUrl}
      completed={completed}
      prevSlug={prevSlug}
      nextSlug={nextSlug}
    />
  );
});

export { watch as watchRoutes };
