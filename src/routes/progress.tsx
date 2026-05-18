import { Hono } from "hono";
import { eq, and, gt, asc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Env, Variables } from "../types";
import { requireAuth } from "../middleware/auth";
import { progress, lesson } from "../db/schema";
import { hasAccess } from "../lib/access";
import { sendResendEvent } from "../lib/resend";
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

        const canAccess = user.role === "admin" || await hasAccess(user.id, user.email, db);
        if (canAccess) return; // already has access (purchase or admin)

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

export { progressRoutes };
