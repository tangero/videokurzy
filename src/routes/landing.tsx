import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { eq, asc } from "drizzle-orm";
import type { Env, Variables } from "../types";
import { LandingPage } from "../views/landing";
import { course, module, lesson } from "../db/schema";

const landing = new Hono<{ Bindings: Env; Variables: Variables }>();

landing.get("/", async (c) => {
  const user = c.get("user");
  const db = drizzle(c.env.DB);

  const [firstCourse] = await db
    .select()
    .from(course)
    .where(eq(course.published, true))
    .limit(1);

  let modules: Array<{
    id: number;
    title: string;
    lessons: Array<{
      id: number;
      title: string;
      durationSeconds: number;
      isFree: boolean;
      sortOrder: number;
    }>;
  }> = [];

  if (firstCourse) {
    const courseModules = await db
      .select()
      .from(module)
      .where(eq(module.courseId, firstCourse.id))
      .orderBy(asc(module.sortOrder));

    modules = await Promise.all(
      courseModules.map(async (m) => {
        const lessons = await db
          .select()
          .from(lesson)
          .where(eq(lesson.moduleId, m.id))
          .orderBy(asc(lesson.sortOrder));
        return { ...m, lessons };
      })
    );
  }

  return c.html(<LandingPage user={user} modules={modules} />);
});

export { landing as landingRoutes };
