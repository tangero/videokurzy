import { Hono } from "hono";
import { and, desc, eq, asc, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { nanoid } from "nanoid";
import type { Env, Variables } from "../types";
import { requireAdmin } from "../middleware/auth";
import { course, module, lesson, organization, purchase, user } from "../db/schema";
import { Layout } from "../views/layout";
import { sendEmail, organizationApprovedHtml } from "../lib/email";
import {
  AdminCoursesList,
  AdminCourseForm,
  AdminCourseDetail,
  AdminModuleForm,
  AdminLessonForm,
} from "../views/admin-courses";

const admin = new Hono<{ Bindings: Env; Variables: Variables }>();

// All admin routes require admin role
admin.use("/admin/*", requireAdmin);

// Admin dashboard
admin.get("/admin", async (c) => {
  const currentUser = c.get("user")!;
  const db = drizzle(c.env.DB);

  const [userCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(user);
  const [purchaseCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(purchase);
  const orgs = await db.select().from(organization).orderBy(asc(organization.createdAt));

  // I3: načíst emaily kupujících pro detekci domain mismatch
  const orgPurchases = await db
    .select({ email: purchase.email, createdAt: purchase.createdAt })
    .from(purchase)
    .where(
      and(
        eq(purchase.type, "organization"),
        or(eq(purchase.status, "pending"), eq(purchase.status, "active"))
      )
    )
    .orderBy(desc(purchase.createdAt));

  const buyerFor = (orgDomain: string, orgCreatedAt: Date): string | null => {
    const hit = orgPurchases.find((p) =>
      p.email.toLowerCase().endsWith(`@${orgDomain.toLowerCase()}`)
    );
    if (hit) return hit.email;
    const t = orgCreatedAt.getTime();
    return (
      orgPurchases
        .filter((p) => Math.abs(p.createdAt.getTime() - t) < 5 * 60 * 1000)
        .sort((a, b) => Math.abs(a.createdAt.getTime() - t) - Math.abs(b.createdAt.getTime() - t))[0]
        ?.email ?? null
    );
  };

  return c.html(
    <Layout title="Admin" user={currentUser}>
      <div class="max-w-4xl mx-auto px-4 py-8">
        <h1 class="text-2xl font-bold mb-6">Admin</h1>

        {/* Stats */}
        <div class="grid grid-cols-3 gap-4 mb-8">
          <div class="bg-white p-4 rounded-lg border">
            <p class="text-sm text-gray-500">Uživatelé</p>
            <p class="text-2xl font-bold">{userCount.count}</p>
          </div>
          <div class="bg-white p-4 rounded-lg border">
            <p class="text-sm text-gray-500">Nákupy</p>
            <p class="text-2xl font-bold">{purchaseCount.count}</p>
          </div>
          <div class="bg-white p-4 rounded-lg border">
            <p class="text-sm text-gray-500">Organizace</p>
            <p class="text-2xl font-bold">{orgs.length}</p>
          </div>
        </div>

        {/* Organizations */}
        <h2 class="text-xl font-bold mb-4">Organizace</h2>
        <div class="bg-white rounded-lg border overflow-hidden mb-8">
          <table class="w-full text-sm">
            <thead class="bg-gray-50">
              <tr>
                <th class="px-4 py-2 text-left">Doména</th>
                <th class="px-4 py-2 text-left">Kupující</th>
                <th class="px-4 py-2 text-left">Status</th>
                <th class="px-4 py-2 text-left">Akce</th>
              </tr>
            </thead>
            <tbody>
              {orgs.map((org) => {
                const buyer = buyerFor(org.domain, org.createdAt);
                const buyerDomain = buyer?.split("@")[1]?.toLowerCase();
                const mismatch = !!buyer && buyerDomain !== org.domain.toLowerCase();
                return (
                  <tr class="border-t" id={`org-${org.id}`}>
                    <td class="px-4 py-2 font-medium">{org.domain}</td>
                    <td class="px-4 py-2">
                      {buyer ? (
                        <span class={mismatch ? "text-yellow-700" : "text-gray-600"}>
                          {mismatch && <span title="Email kupujícího neodpovídá doméně licence">⚠ </span>}
                          {buyer}
                        </span>
                      ) : (
                        <span class="text-gray-400 italic">neznámý</span>
                      )}
                    </td>
                    <td class="px-4 py-2">
                      <span
                        class={`px-2 py-1 rounded-full text-xs font-medium ${
                          org.status === "active"
                            ? "bg-green-100 text-green-700"
                            : org.status === "pending"
                              ? "bg-yellow-100 text-yellow-700"
                              : "bg-red-100 text-red-700"
                        }`}
                      >
                        {org.status}
                      </span>
                    </td>
                    <td class="px-4 py-2">
                      {org.status === "pending" && (
                        <button
                          hx-post={`/admin/api/organizations/${org.id}/approve`}
                          hx-target={`#org-${org.id}`}
                          hx-swap="outerHTML"
                          class="text-xs bg-green-600 text-white px-3 py-1 rounded hover:bg-green-700"
                        >
                          Schválit
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {orgs.length === 0 && (
                <tr>
                  <td colspan={4} class="px-4 py-4 text-gray-500 text-center">
                    Zatím žádné organizace
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Quick links */}
        <div class="flex gap-4">
          <a href="/admin/courses" class="text-blue-600 hover:underline">
            Správa kurzů
          </a>
        </div>
      </div>
    </Layout>
  );
});

// Approve organization (htmx)
admin.post("/admin/api/organizations/:id/approve", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const db = drizzle(c.env.DB);

  await db
    .update(organization)
    .set({ status: "active" })
    .where(eq(organization.id, id));

  const [org] = await db
    .select()
    .from(organization)
    .where(eq(organization.id, id))
    .limit(1);

  if (!org) return c.text("Not found", 404);

  // Notify the most recent buyer on this domain that the license is active.
  const recentPurchases = await db
    .select({ email: purchase.email })
    .from(purchase)
    .where(
      and(
        eq(purchase.type, "organization"),
        or(eq(purchase.status, "pending"), eq(purchase.status, "active"))
      )
    )
    .orderBy(desc(purchase.createdAt))
    .limit(20);

  const buyerEmail = recentPurchases.find((r) =>
    r.email.toLowerCase().endsWith(`@${org.domain.toLowerCase()}`)
  )?.email;

  if (buyerEmail) {
    c.executionCtx.waitUntil(
      sendEmail(c.env, {
        to: buyerEmail,
        subject: `Firemní licence pro ${org.domain} aktivována`,
        html: organizationApprovedHtml(
          org.domain,
          `${c.env.BETTER_AUTH_URL}/login?email=${encodeURIComponent(buyerEmail)}`
        ),
      })
    );
  }

  return c.html(
    <tr class="border-t" id={`org-${org.id}`}>
      <td class="px-4 py-2 font-medium">{org.domain}</td>
      <td class="px-4 py-2 text-gray-600">{buyerEmail ?? ""}</td>
      <td class="px-4 py-2">
        <span class="px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">
          active
        </span>
      </td>
      <td class="px-4 py-2"></td>
    </tr>
  );
});

// ─── Courses CRUD ─────────────────────────────────────────────────

admin.get("/admin/courses", async (c) => {
  const currentUser = c.get("user")!;
  const db = drizzle(c.env.DB);
  const courses = await db.select().from(course).orderBy(asc(course.id));
  return c.html(
    <Layout title="Správa kurzů" user={currentUser}>
      <AdminCoursesList courses={courses} />
    </Layout>
  );
});

admin.get("/admin/courses/new", async (c) => {
  const currentUser = c.get("user")!;
  return c.html(
    <Layout title="Nový kurz" user={currentUser}>
      <AdminCourseForm />
    </Layout>
  );
});

admin.post("/admin/courses/new", async (c) => {
  const db = drizzle(c.env.DB);
  const body = await c.req.parseBody();
  const title = String(body.title ?? "").trim();
  const slug = String(body.slug ?? "").trim();
  const description = String(body.description ?? "").trim();
  const published = body.published === "on";

  const [created] = await db
    .insert(course)
    .values({ title, slug, description, published })
    .returning({ id: course.id });

  await c.env.KV.delete("cache:catalog");
  return c.redirect(`/admin/courses/${created.id}`);
});

admin.get("/admin/courses/:id", async (c) => {
  const currentUser = c.get("user")!;
  const id = parseInt(c.req.param("id"), 10);
  const db = drizzle(c.env.DB);

  const [courseRow] = await db
    .select()
    .from(course)
    .where(eq(course.id, id))
    .limit(1);
  if (!courseRow) return c.text("Not found", 404);

  const courseModules = await db
    .select()
    .from(module)
    .where(eq(module.courseId, id))
    .orderBy(asc(module.sortOrder));

  const modulesWithLessons = await Promise.all(
    courseModules.map(async (m) => {
      const lessons = await db
        .select()
        .from(lesson)
        .where(eq(lesson.moduleId, m.id))
        .orderBy(asc(lesson.sortOrder));
      return { ...m, lessons };
    })
  );

  return c.html(
    <Layout title={courseRow.title} user={currentUser}>
      <AdminCourseDetail course={courseRow} modules={modulesWithLessons} />
    </Layout>
  );
});

admin.get("/admin/courses/:id/edit", async (c) => {
  const currentUser = c.get("user")!;
  const id = parseInt(c.req.param("id"), 10);
  const db = drizzle(c.env.DB);
  const [courseRow] = await db
    .select()
    .from(course)
    .where(eq(course.id, id))
    .limit(1);
  if (!courseRow) return c.text("Not found", 404);
  return c.html(
    <Layout title="Upravit kurz" user={currentUser}>
      <AdminCourseForm course={courseRow} />
    </Layout>
  );
});

admin.post("/admin/courses/:id/edit", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const db = drizzle(c.env.DB);
  const body = await c.req.parseBody();
  const title = String(body.title ?? "").trim();
  const slug = String(body.slug ?? "").trim();
  const description = String(body.description ?? "").trim();
  const published = body.published === "on";

  await db
    .update(course)
    .set({ title, slug, description, published })
    .where(eq(course.id, id));

  await c.env.KV.delete("cache:catalog");
  return c.redirect(`/admin/courses/${id}`);
});

admin.post("/admin/courses/:id/delete", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const db = drizzle(c.env.DB);
  await db.delete(course).where(eq(course.id, id));
  await c.env.KV.delete("cache:catalog");
  return c.redirect("/admin/courses");
});

// ─── Modules CRUD ─────────────────────────────────────────────────

admin.get("/admin/courses/:courseId/modules/new", async (c) => {
  const currentUser = c.get("user")!;
  const courseId = parseInt(c.req.param("courseId"), 10);
  return c.html(
    <Layout title="Nový modul" user={currentUser}>
      <AdminModuleForm courseId={courseId} />
    </Layout>
  );
});

admin.post("/admin/courses/:courseId/modules/new", async (c) => {
  const courseId = parseInt(c.req.param("courseId"), 10);
  const db = drizzle(c.env.DB);
  const body = await c.req.parseBody();
  const title = String(body.title ?? "").trim();
  const slug = String(body.slug ?? "").trim();
  const sortOrder = parseInt(String(body.sortOrder ?? "0"), 10);

  await db.insert(module).values({ courseId, title, slug, sortOrder });
  await c.env.KV.delete("cache:catalog");
  return c.redirect(`/admin/courses/${courseId}`);
});

admin.get("/admin/courses/:courseId/modules/:moduleId/edit", async (c) => {
  const currentUser = c.get("user")!;
  const courseId = parseInt(c.req.param("courseId"), 10);
  const moduleId = parseInt(c.req.param("moduleId"), 10);
  const db = drizzle(c.env.DB);
  const [mod] = await db
    .select()
    .from(module)
    .where(eq(module.id, moduleId))
    .limit(1);
  if (!mod) return c.text("Not found", 404);
  return c.html(
    <Layout title="Upravit modul" user={currentUser}>
      <AdminModuleForm courseId={courseId} mod={mod} />
    </Layout>
  );
});

admin.post("/admin/courses/:courseId/modules/:moduleId/edit", async (c) => {
  const courseId = parseInt(c.req.param("courseId"), 10);
  const moduleId = parseInt(c.req.param("moduleId"), 10);
  const db = drizzle(c.env.DB);
  const body = await c.req.parseBody();
  const title = String(body.title ?? "").trim();
  const slug = String(body.slug ?? "").trim();
  const sortOrder = parseInt(String(body.sortOrder ?? "0"), 10);

  await db
    .update(module)
    .set({ title, slug, sortOrder })
    .where(eq(module.id, moduleId));

  await c.env.KV.delete("cache:catalog");
  return c.redirect(`/admin/courses/${courseId}`);
});

admin.post(
  "/admin/courses/:courseId/modules/:moduleId/delete",
  async (c) => {
    const courseId = parseInt(c.req.param("courseId"), 10);
    const moduleId = parseInt(c.req.param("moduleId"), 10);
    const db = drizzle(c.env.DB);
    await db.delete(module).where(eq(module.id, moduleId));
    await c.env.KV.delete("cache:catalog");
    return c.redirect(`/admin/courses/${courseId}`);
  }
);

// ─── Lessons CRUD ─────────────────────────────────────────────────

admin.get(
  "/admin/courses/:courseId/modules/:moduleId/lessons/new",
  async (c) => {
    const currentUser = c.get("user")!;
    const courseId = parseInt(c.req.param("courseId"), 10);
    const moduleId = parseInt(c.req.param("moduleId"), 10);
    return c.html(
      <Layout title="Nová epizoda" user={currentUser}>
        <AdminLessonForm courseId={courseId} moduleId={moduleId} />
      </Layout>
    );
  }
);

admin.post(
  "/admin/courses/:courseId/modules/:moduleId/lessons/new",
  async (c) => {
    const courseId = parseInt(c.req.param("courseId"), 10);
    const moduleId = parseInt(c.req.param("moduleId"), 10);
    const db = drizzle(c.env.DB);
    const body = await c.req.parseBody();
    const title = String(body.title ?? "").trim();
    const slug = String(body.slug ?? "").trim();
    const bunnyVideoId = String(body.bunnyVideoId ?? "").trim() || null;
    const durationSeconds = parseInt(String(body.durationSeconds ?? "0"), 10);
    const sortOrder = parseInt(String(body.sortOrder ?? "0"), 10);
    const isFree = body.isFree === "on";

    await db.insert(lesson).values({
      moduleId,
      publicId: nanoid(8),
      title,
      slug,
      bunnyVideoId,
      durationSeconds,
      sortOrder,
      isFree,
    });

    await c.env.KV.delete("cache:catalog");
    return c.redirect(`/admin/courses/${courseId}`);
  }
);

admin.get("/admin/lessons/:id/edit", async (c) => {
  const currentUser = c.get("user")!;
  const id = parseInt(c.req.param("id"), 10);
  const db = drizzle(c.env.DB);

  const [row] = await db
    .select({ lesson: lesson, courseId: module.courseId })
    .from(lesson)
    .innerJoin(module, eq(lesson.moduleId, module.id))
    .where(eq(lesson.id, id))
    .limit(1);

  if (!row) return c.text("Not found", 404);

  return c.html(
    <Layout title="Upravit epizodu" user={currentUser}>
      <AdminLessonForm
        courseId={row.courseId}
        moduleId={row.lesson.moduleId}
        lesson={row.lesson}
      />
    </Layout>
  );
});

admin.post("/admin/lessons/:id/edit", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const db = drizzle(c.env.DB);

  const [row] = await db
    .select({ courseId: module.courseId })
    .from(lesson)
    .innerJoin(module, eq(lesson.moduleId, module.id))
    .where(eq(lesson.id, id))
    .limit(1);

  if (!row) return c.text("Not found", 404);

  const body = await c.req.parseBody();
  const title = String(body.title ?? "").trim();
  const slug = String(body.slug ?? "").trim();
  const bunnyVideoId = String(body.bunnyVideoId ?? "").trim() || null;
  const durationSeconds = parseInt(String(body.durationSeconds ?? "0"), 10);
  const sortOrder = parseInt(String(body.sortOrder ?? "0"), 10);
  const isFree = body.isFree === "on";

  await db
    .update(lesson)
    .set({ title, slug, bunnyVideoId, durationSeconds, sortOrder, isFree })
    .where(eq(lesson.id, id));

  await c.env.KV.delete("cache:catalog");
  return c.redirect(`/admin/courses/${row.courseId}`);
});

admin.post("/admin/lessons/:id/delete", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const db = drizzle(c.env.DB);

  const [row] = await db
    .select({ courseId: module.courseId })
    .from(lesson)
    .innerJoin(module, eq(lesson.moduleId, module.id))
    .where(eq(lesson.id, id))
    .limit(1);

  if (!row) return c.text("Not found", 404);

  await db.delete(lesson).where(eq(lesson.id, id));
  await c.env.KV.delete("cache:catalog");
  return c.redirect(`/admin/courses/${row.courseId}`);
});

export { admin as adminRoutes };
