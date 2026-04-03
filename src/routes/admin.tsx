import { Hono } from "hono";
import { eq, asc, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { nanoid } from "nanoid";
import type { Env, Variables } from "../types";
import { requireAdmin } from "../middleware/auth";
import { course, module, lesson, organization, purchase, user } from "../db/schema";
import { Layout } from "../views/layout";

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
                <th class="px-4 py-2 text-left">Status</th>
                <th class="px-4 py-2 text-left">Akce</th>
              </tr>
            </thead>
            <tbody>
              {orgs.map((org) => (
                <tr class="border-t" id={`org-${org.id}`}>
                  <td class="px-4 py-2">{org.domain}</td>
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
              ))}
              {orgs.length === 0 && (
                <tr>
                  <td colspan={3} class="px-4 py-4 text-gray-500 text-center">
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

  return c.html(
    <tr class="border-t" id={`org-${org.id}`}>
      <td class="px-4 py-2">{org.domain}</td>
      <td class="px-4 py-2">
        <span class="px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">
          active
        </span>
      </td>
      <td class="px-4 py-2"></td>
    </tr>
  );
});

// Courses management
admin.get("/admin/courses", async (c) => {
  const currentUser = c.get("user")!;
  const db = drizzle(c.env.DB);

  const courses = await db.select().from(course).orderBy(asc(course.id));

  return c.html(
    <Layout title="Správa kurzů" user={currentUser}>
      <div class="max-w-4xl mx-auto px-4 py-8">
        <div class="flex justify-between items-center mb-6">
          <h1 class="text-2xl font-bold">Kurzy</h1>
          <a href="/admin" class="text-sm text-gray-500 hover:underline">
            &larr; Admin
          </a>
        </div>

        {courses.map((c) => (
          <div class="bg-white p-4 rounded-lg border mb-4">
            <div class="flex justify-between items-center">
              <div>
                <h3 class="font-semibold">{c.title}</h3>
                <p class="text-sm text-gray-500">/{c.slug}</p>
              </div>
              <span
                class={`text-xs px-2 py-1 rounded-full ${
                  c.published
                    ? "bg-green-100 text-green-700"
                    : "bg-gray-100 text-gray-600"
                }`}
              >
                {c.published ? "publikován" : "draft"}
              </span>
            </div>
          </div>
        ))}

        {courses.length === 0 && (
          <p class="text-gray-500">Zatím žádné kurzy. Použijte seed script.</p>
        )}
      </div>
    </Layout>
  );
});

export { admin as adminRoutes };
