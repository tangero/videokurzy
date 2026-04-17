import { Hono } from "hono";
import { eq, asc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Env, Variables } from "../types";
import { requireAuth } from "../middleware/auth";
import { course, module, lesson, progress } from "../db/schema";
import { hasAccess } from "../lib/access";
import { DashboardPage } from "../views/dashboard";

const dashboard = new Hono<{ Bindings: Env; Variables: Variables }>();

dashboard.get("/dashboard", requireAuth, async (c) => {
  const user = c.get("user")!;
  const db = drizzle(c.env.DB);

  // Get all modules with lessons, ordered
  const modules = await db
    .select({
      moduleId: module.id,
      moduleTitle: module.title,
      moduleSortOrder: module.sortOrder,
      lessonId: lesson.id,
      lessonPublicId: lesson.publicId,
      lessonTitle: lesson.title,
      lessonSlug: lesson.slug,
      lessonDuration: lesson.durationSeconds,
      lessonIsFree: lesson.isFree,
    })
    .from(module)
    .innerJoin(lesson, eq(lesson.moduleId, module.id))
    .orderBy(asc(module.sortOrder), asc(lesson.sortOrder));

  // Get user progress
  const userProgress = await db
    .select({
      lessonId: progress.lessonId,
      completed: progress.completed,
    })
    .from(progress)
    .where(eq(progress.userId, user.id));

  const completedSet = new Set(
    userProgress.filter((p) => p.completed).map((p) => p.lessonId)
  );

  // Group by module
  const moduleMap = new Map<
    number,
    { title: string; lessons: Array<{
      id: number;
      publicId: string;
      title: string;
      slug: string;
      durationSeconds: number;
      isFree: boolean;
      completed: boolean;
    }> }
  >();

  for (const row of modules) {
    if (!moduleMap.has(row.moduleId)) {
      moduleMap.set(row.moduleId, { title: row.moduleTitle, lessons: [] });
    }
    moduleMap.get(row.moduleId)!.lessons.push({
      id: row.lessonId,
      publicId: row.lessonPublicId,
      title: row.lessonTitle,
      slug: row.lessonSlug,
      durationSeconds: row.lessonDuration,
      isFree: row.lessonIsFree,
      completed: completedSet.has(row.lessonId),
    });
  }

  const moduleList = Array.from(moduleMap.entries()).map(([id, data]) => ({
    id,
    ...data,
  }));

  const totalCount = modules.length;
  const completedCount = completedSet.size;
  const hasPaidAccess = await hasAccess(user.id, user.email, db);

  return c.html(
    <DashboardPage
      user={user}
      modules={moduleList}
      completedCount={completedCount}
      totalCount={totalCount}
      hasPaidAccess={hasPaidAccess}
    />
  );
});

export { dashboard as dashboardRoutes };
