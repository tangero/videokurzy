import { Hono } from "hono";
import { eq, and, gt, asc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Env, Variables } from "../types";
import { requireAuth } from "../middleware/auth";
import { progress, lesson, module } from "../db/schema";
import { hasAccess } from "../lib/access";
import { sendResendEvent } from "../lib/resend";
import { recordWatch } from "../lib/watch-stats";
import { ProgressComplete } from "../views/watch";

const progressRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

progressRoutes.post("/api/progress/:lessonId", requireAuth, async (c) => {
  const user = c.get("user")!;
  const lessonId = parseInt(c.req.param("lessonId"), 10);
  const db = drizzle(c.env.DB);

  await db
    .insert(progress)
    .values({
      userId: user.id,
      lessonId,
      completed: true,
      completedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [progress.userId, progress.lessonId],
      set: { completed: true, completedAt: new Date() },
    });

  // Emit lesson.completed event — onboarding / re-engagement automations.
  // Payload nese deep-link na další lekci a postup v kurzu pro personalizaci e-mailu.
  c.executionCtx.waitUntil(
    (async () => {
      try {
        const [thisLesson] = await db
          .select({ title: lesson.title })
          .from(lesson)
          .where(eq(lesson.id, lessonId))
          .limit(1);
        if (!thisLesson) return;

        // Globální pořadí všech lekcí (napříč moduly) → další lekce pro CTA odkaz.
        const allLessons = await db
          .select({ id: lesson.id, slug: lesson.slug })
          .from(lesson)
          .innerJoin(module, eq(lesson.moduleId, module.id))
          .orderBy(asc(module.sortOrder), asc(lesson.sortOrder));

        const totalCount = allLessons.length;
        const idx = allLessons.findIndex((l) => l.id === lessonId);
        const nextLessonSlug =
          idx >= 0 && idx < allLessons.length - 1 ? allLessons[idx + 1].slug : null;

        const completedRows = await db
          .select({ lessonId: progress.lessonId })
          .from(progress)
          .where(and(eq(progress.userId, user.id), eq(progress.completed, true)));

        await sendResendEvent(c.env.RESEND_API_KEY, "lesson.completed", user.email, {
          lessonId,
          lessonTitle: thisLesson.title,
          nextLessonSlug,
          completedCount: completedRows.length,
          totalCount,
        });
      } catch (err) {
        console.error("Resend lesson.completed event failed:", err);
      }
    })()
  );

  // Fire Resend event if this is the last free lesson and user has no purchase
  c.executionCtx.waitUntil(
    (async () => {
      try {
        const [info] = await db
          .select({
            isFree: lesson.isFree,
            moduleId: lesson.moduleId,
            sortOrder: lesson.sortOrder,
          })
          .from(lesson)
          .where(eq(lesson.id, lessonId))
          .limit(1);

        if (!info?.isFree) return;

        // Check if there's a next lesson in the same module
        const [nextInModule] = await db
          .select({ id: lesson.id })
          .from(lesson)
          .where(
            and(
              eq(lesson.moduleId, info.moduleId),
              gt(lesson.sortOrder, info.sortOrder)
            )
          )
          .orderBy(asc(lesson.sortOrder))
          .limit(1);

        if (nextInModule) return; // not the last free lesson

        const canAccess = await hasAccess(user, db);
        if (canAccess) return; // already has access (purchase, org, or admin)

        await sendResendEvent(
          c.env.RESEND_API_KEY,
          "free_preview.completed",
          user.email,
          { source: "progress_tracking" }
        );
      } catch (err) {
        console.error("Resend event in progress failed:", err);
      }
    })()
  );

  // Return partial HTML for htmx swap
  return c.html(<ProgressComplete lessonId={lessonId} />);
});

// Watch-time / retenční tracking — volá player.js heartbeat (fetch / sendBeacon).
// Tělo: { maxSegment, watchedSeconds }. Idempotentní upsert (posun jen nahoru).
progressRoutes.post("/api/watch/:lessonId", requireAuth, async (c) => {
  const user = c.get("user")!;
  const lessonId = parseInt(c.req.param("lessonId"), 10);
  if (!Number.isFinite(lessonId)) return c.body(null, 400);

  let maxSegment = 0;
  let watchedSeconds = 0;
  let positionSeconds = 0;
  try {
    const body = (await c.req.json()) as { maxSegment?: unknown; watchedSeconds?: unknown; positionSeconds?: unknown };
    maxSegment = Number(body.maxSegment) || 0;
    watchedSeconds = Number(body.watchedSeconds) || 0;
    positionSeconds = Number(body.positionSeconds) || 0;
  } catch {
    return c.body(null, 400);
  }

  const db = drizzle(c.env.DB);
  const { started } = await recordWatch(db, { userId: user.id, lessonId, maxSegment, watchedSeconds, positionSeconds }, new Date());

  // První spuštění lekce → lesson.started pro re-engagement automation
  // (chytá i diváky, co video pustili, ale nedokončili).
  if (started) {
    c.executionCtx.waitUntil(
      sendResendEvent(c.env.RESEND_API_KEY, "lesson.started", user.email, { lessonId }).catch(
        (err) => console.error("Resend lesson.started event failed:", err)
      )
    );
  }

  return c.body(null, 204);
});

export { progressRoutes };
