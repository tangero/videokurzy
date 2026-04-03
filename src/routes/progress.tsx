import { Hono } from "hono";
import { eq, and } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Env, Variables } from "../types";
import { requireAuth } from "../middleware/auth";
import { progress } from "../db/schema";
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

  // Return partial HTML for htmx swap
  return c.html(<ProgressComplete lessonId={lessonId} />);
});

export { progressRoutes };
