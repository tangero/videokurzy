import { Hono } from "hono";
import type { FC } from "hono/jsx";
import { and, desc, eq, asc, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { nanoid } from "nanoid";
import type { Env, Variables } from "../types";
import { requireAdmin } from "../middleware/auth";
import { course, module, lesson, organization, purchase, user, siteConfig } from "../db/schema";
import { Layout } from "../views/layout";
import { sendEmail, organizationApprovedHtml, adminWelcomeUserHtml } from "../lib/email";
import {
  createAdminUsers,
  defaultAdminGrantExpiresOn,
  parseAdminGrantExpiresAt,
  listAdminUsers,
  getAdminUserDetail,
  updateAdminUser,
  deleteAdminUser,
  grantAdminAccess,
  revokeAdminPurchase,
  extendAdminPurchase,
} from "../lib/admin-users";
import { AdminUsersList, AdminUserDetailView } from "../views/admin-users";
import {
  triggerTranscribe,
  fetchBunnyVideo,
  fetchCaptionVtt,
  findCzechCaption,
  vttToPlainText,
} from "../lib/transcribe";
import { countDiscountedActivePurchases } from "../lib/discount";
import { scanFioPayments } from "../scheduled";
import {
  AdminNav,
  AdminCoursesList,
  AdminCourseForm,
  AdminCourseDetail,
  AdminModuleForm,
  AdminLessonForm,
  AdminSettingsForm,
} from "../views/admin-courses";

const admin = new Hono<{ Bindings: Env; Variables: Variables }>();

const DEFAULT_WELCOME_MESSAGE = `Ahoj či Dobrý den,
zřídil jsem Ti účet do mojí vzdělávací AI platformy kurzy.vibecoding.cz. Budu rád, když mi dáš zpětnou vazbu na to, co jsi se tu naučil! Patrick`;

const AdminUserForm: FC<{
  error?: string;
  values?: {
    emails?: string;
    name?: string;
    role?: string;
    access?: string;
    accessExpiresOn?: string;
    sendWelcomeEmail?: boolean;
    welcomeMessage?: string;
  };
}> = ({ error, values }) => (
  <div class="max-w-2xl mx-auto px-4 py-8">
    <h1 class="text-2xl font-bold mb-6">Admin</h1>
    <AdminNav active="/admin/users/new" />
    <h2 class="text-xl font-bold mb-2">Nový uživatel</h2>
    <p class="text-sm text-gray-600 mb-6">
      Uživatel se zakládá bez hesla. Přístup získá přes magic link na přihlašovací stránce.
    </p>
    {error && (
      <div class="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
        {error}
      </div>
    )}
    <form method="post" action="/admin/users/new" class="bg-white border rounded-lg p-5 space-y-4">
      <label class="block">
        <span class="block text-sm font-medium text-gray-700 mb-1">E-maily</span>
        <textarea
          name="emails"
          required
          rows={6}
          class="w-full rounded border px-3 py-2"
          placeholder={"jmeno@example.com\njine.jmeno@example.com"}
        >
          {values?.emails ?? ""}
        </textarea>
        <span class="mt-1 block text-xs text-gray-500">
          Vlož jeden nebo více e-mailů. Oddělení může být nový řádek, mezera, čárka nebo středník.
        </span>
      </label>
      <label class="block">
        <span class="block text-sm font-medium text-gray-700 mb-1">Jméno</span>
        <input
          name="name"
          value={values?.name ?? ""}
          class="w-full rounded border px-3 py-2"
          placeholder="Volitelné"
        />
        <span class="mt-1 block text-xs text-gray-500">
          Jméno se použije jen při založení jednoho uživatele.
        </span>
      </label>
      <label class="block">
        <span class="block text-sm font-medium text-gray-700 mb-1">Role</span>
        <select name="role" class="w-full rounded border px-3 py-2">
          <option value="user" selected={(values?.role ?? "user") === "user"}>
            user
          </option>
          <option value="admin" selected={values?.role === "admin"}>
            admin
          </option>
        </select>
      </label>
      <fieldset class="rounded border px-3 py-3">
        <legend class="px-1 text-sm font-medium text-gray-700">Přístup</legend>
        <div class="space-y-2 text-sm">
          <label class="flex items-start gap-2">
            <input
              type="radio"
              name="access"
              value="free"
              checked={(values?.access ?? "individual") === "free"}
              class="mt-1"
            />
            <span>
              <span class="font-medium">Zdarma</span>
              <span class="block text-gray-500">Bez placené licence, uvidí jen bezplatné lekce.</span>
            </span>
          </label>
          <label class="flex items-start gap-2">
            <input
              type="radio"
              name="access"
              value="individual"
              checked={(values?.access ?? "individual") === "individual"}
              class="mt-1"
            />
            <span>
              <span class="font-medium">Soukromá licence</span>
              <span class="block text-gray-500">Plný přístup do zvoleného data.</span>
            </span>
          </label>
          <label class="flex items-start gap-2">
            <input
              type="radio"
              name="access"
              value="organization"
              checked={values?.access === "organization"}
              class="mt-1"
            />
            <span>
              <span class="font-medium">Firemní licence</span>
              <span class="block text-gray-500">Plný přístup pro tyto uživatele do zvoleného data.</span>
            </span>
          </label>
        </div>
      </fieldset>
      <label class="block">
        <span class="block text-sm font-medium text-gray-700 mb-1">Platnost přístupu do</span>
        <input
          name="accessExpiresOn"
          type="date"
          value={values?.accessExpiresOn ?? defaultAdminGrantExpiresOn()}
          class="w-full rounded border px-3 py-2"
        />
        <span class="mt-1 block text-xs text-gray-500">
          Výchozí hodnota je 90 dní od dnešního dne. U volby Zdarma se placená licence nevytváří.
        </span>
      </label>
      <fieldset class="rounded border px-3 py-3">
        <legend class="px-1 text-sm font-medium text-gray-700">Uvítací e-mail</legend>
        <label class="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            name="sendWelcomeEmail"
            value="on"
            checked={values?.sendWelcomeEmail ?? true}
            class="mt-1"
          />
          <span>
            <span class="font-medium">Odeslat uvítací e-mail z patrick@vibecoding.cz</span>
            <span class="block text-gray-500">
              Pod tvůj text se automaticky připojí technické informace o účtu, typu přístupu a platnosti.
            </span>
          </span>
        </label>
        <label class="block mt-3">
          <span class="block text-sm font-medium text-gray-700 mb-1">Text e-mailu</span>
          <textarea
            name="welcomeMessage"
            rows={6}
            class="w-full rounded border px-3 py-2 text-sm"
          >
            {values?.welcomeMessage ?? DEFAULT_WELCOME_MESSAGE}
          </textarea>
        </label>
      </fieldset>
      <div class="flex items-center gap-3 pt-2">
        <button type="submit" class="bg-gray-900 text-white px-4 py-2 rounded hover:bg-gray-700">
          Založit uživatele
        </button>
        <a href="/admin" class="text-sm text-gray-600 hover:underline">
          zrušit
        </a>
      </div>
    </form>
  </div>
);

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
  const recentUsers = await db
    .select({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      createdAt: user.createdAt,
    })
    .from(user)
    .orderBy(desc(user.createdAt))
    .limit(8);
  const orgs = await db.select().from(organization).orderBy(asc(organization.createdAt));
  const userCreated = c.req.query("userCreated");

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
        <AdminNav active="/admin" />
        {userCreated && (
          <div class="mb-6 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
            Založeno: {userCreated}. Přihlášení probíhá přes magic link na /login.
          </div>
        )}

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

        {/* Users */}
        <div id="users" class="flex items-center justify-between gap-4 mb-4">
          <h2 class="text-xl font-bold">Uživatelé</h2>
          <div class="flex items-center gap-2">
            <a href="/admin/users" class="text-sm text-indigo-600 hover:underline">
              všichni uživatelé →
            </a>
            <a href="/admin/users/new" class="text-sm bg-gray-900 text-white px-3 py-2 rounded hover:bg-gray-700">
              Přidat uživatele
            </a>
          </div>
        </div>
        <div class="bg-white rounded-lg border overflow-hidden mb-8">
          <table class="w-full text-sm">
            <thead class="bg-gray-50">
              <tr>
                <th class="px-4 py-2 text-left">E-mail</th>
                <th class="px-4 py-2 text-left">Jméno</th>
                <th class="px-4 py-2 text-left">Role</th>
                <th class="px-4 py-2 text-left">Vytvořen</th>
              </tr>
            </thead>
            <tbody>
              {recentUsers.map((u) => (
                <tr class="border-t">
                  <td class="px-4 py-2 font-medium">
                    <a href={`/admin/users/${u.id}`} class="text-indigo-600 hover:underline no-underline">
                      {u.email}
                    </a>
                  </td>
                  <td class="px-4 py-2 text-gray-600">{u.name ?? "—"}</td>
                  <td class="px-4 py-2">
                    <span class={`px-2 py-1 rounded-full text-xs font-medium ${
                      u.role === "admin"
                        ? "bg-blue-100 text-blue-700"
                        : "bg-gray-100 text-gray-700"
                    }`}>
                      {u.role}
                    </span>
                  </td>
                  <td class="px-4 py-2 text-gray-500">
                    {u.createdAt.toLocaleDateString("cs-CZ")}
                  </td>
                </tr>
              ))}
              {recentUsers.length === 0 && (
                <tr>
                  <td colspan={4} class="px-4 py-4 text-gray-500 text-center">
                    Zatím žádní uživatelé
                  </td>
                </tr>
              )}
            </tbody>
          </table>
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

admin.get("/admin/users/new", async (c) => {
  const currentUser = c.get("user")!;
  return c.html(
    <Layout title="Nový uživatel" user={currentUser}>
      <AdminUserForm />
    </Layout>
  );
});

admin.post("/admin/users/new", async (c) => {
  const currentUser = c.get("user")!;
  const db = drizzle(c.env.DB);
  const body = await c.req.parseBody();
  const emails = String(body.emails ?? body.email ?? "");
  const name = String(body.name ?? "");
  const role = String(body.role ?? "user");
  const access = String(body.access ?? "individual");
  const accessExpiresOn = String(body.accessExpiresOn ?? "");
  const sendWelcomeEmail = body.sendWelcomeEmail === "on";
  const welcomeMessage = String(body.welcomeMessage ?? "").trim();

  try {
    const expiresAt = parseAdminGrantExpiresAt(accessExpiresOn);
    const result = await createAdminUsers(db, { emails, name, role, access, expiresAt });
    if (result.errors.length > 0) {
      const failed = result.errors.map((e) => `${e.email}: ${e.message}`).join("; ");
      throw new Error(`${result.created.length} založeno, ${result.errors.length} se nepodařilo: ${failed}`);
    }

    if (sendWelcomeEmail && welcomeMessage && result.created.length > 0) {
      const access2 = (["free", "individual", "organization"].includes(access)
        ? access
        : "individual") as "free" | "individual" | "organization";
      const expiryForEmail = access2 === "free" ? null : expiresAt;
      for (const u of result.created) {
        c.executionCtx.waitUntil(
          sendEmail(c.env, {
            from: "Patrick Zandl <patrick@vibecoding.cz>",
            replyTo: "patrick@vibecoding.cz",
            to: u.email,
            subject: "Tvůj účet na kurzy.vibecoding.cz",
            html: adminWelcomeUserHtml({
              personalMessage: welcomeMessage,
              email: u.email,
              access: access2,
              expiresAt: expiryForEmail,
              loginUrl: `${c.env.BETTER_AUTH_URL}/login?email=${encodeURIComponent(u.email)}`,
            }),
          })
        );
      }
    }

    const label = result.created.length === 1
      ? result.created[0].email
      : `${result.created.length} uživatelů`;
    return c.redirect(`/admin?userCreated=${encodeURIComponent(label)}`);
  } catch (err) {
    const message = (err as Error).message || "Uživatele se nepodařilo založit.";
    return c.html(
      <Layout title="Nový uživatel" user={currentUser}>
        <AdminUserForm
          error={message}
          values={{
            emails: emails.trim(),
            name: name.trim(),
            role,
            access,
            accessExpiresOn,
            sendWelcomeEmail,
            welcomeMessage,
          }}
        />
      </Layout>,
      400
    );
  }
});

// ─── Users CRUD ───────────────────────────────────────────────────

const USER_PAGE_SIZE = 50;
const FLASH_MESSAGES: Record<string, { kind: "ok" | "err"; text: string }> = {
  saved: { kind: "ok", text: "Změny uloženy." },
  deleted: { kind: "ok", text: "Uživatel smazán." },
  granted: { kind: "ok", text: "Přístup přidán." },
  revoked: { kind: "ok", text: "Přístup odebrán." },
  extended: { kind: "ok", text: "Platnost přístupu upravena." },
};

function flashFromQuery(c: { req: { query: (k: string) => string | undefined } }) {
  const ok = c.req.query("ok");
  if (ok && FLASH_MESSAGES[ok]) return FLASH_MESSAGES[ok];
  const err = c.req.query("err");
  if (err) return { kind: "err" as const, text: err };
  return undefined;
}

admin.get("/admin/users", async (c) => {
  const currentUser = c.get("user")!;
  const db = drizzle(c.env.DB);
  const search = (c.req.query("q") ?? "").trim();
  const page = Math.max(1, parseInt(c.req.query("page") ?? "1", 10) || 1);
  const offset = (page - 1) * USER_PAGE_SIZE;
  const { rows, total } = await listAdminUsers(db, { search, limit: USER_PAGE_SIZE, offset });

  return c.html(
    <Layout title="Uživatelé" user={currentUser}>
      <AdminUsersList
        rows={rows}
        total={total}
        search={search}
        page={page}
        pageSize={USER_PAGE_SIZE}
        flash={flashFromQuery(c)}
      />
    </Layout>
  );
});

admin.get("/admin/users/:id", async (c) => {
  const currentUser = c.get("user")!;
  const db = drizzle(c.env.DB);
  const detail = await getAdminUserDetail(db, c.req.param("id"));
  if (!detail) return c.text("Not found", 404);
  return c.html(
    <Layout title={detail.email} user={currentUser}>
      <AdminUserDetailView
        user={detail}
        flash={flashFromQuery(c)}
        defaultExpiresOn={defaultAdminGrantExpiresOn()}
        currentUserId={currentUser.id}
      />
    </Layout>
  );
});

admin.post("/admin/users/:id/edit", async (c) => {
  const currentUser = c.get("user")!;
  const id = c.req.param("id");
  const db = drizzle(c.env.DB);
  const body = await c.req.parseBody();
  const name = String(body.name ?? "");
  const role = String(body.role ?? "user");

  try {
    // Nelze měnit vlastní roli — chrání před locked-out adminem.
    const roleToSet = id === currentUser.id ? undefined : role;
    await updateAdminUser(db, id, { name, role: roleToSet });
    return c.redirect(`/admin/users/${id}?ok=saved`);
  } catch (err) {
    const message = encodeURIComponent((err as Error).message || "Změny se nepodařilo uložit.");
    return c.redirect(`/admin/users/${id}?err=${message}`);
  }
});

admin.post("/admin/users/:id/delete", async (c) => {
  const currentUser = c.get("user")!;
  const id = c.req.param("id");
  if (id === currentUser.id) {
    return c.redirect(`/admin/users/${id}?err=${encodeURIComponent("Vlastní účet nelze smazat.")}`);
  }
  const db = drizzle(c.env.DB);
  try {
    await deleteAdminUser(db, id);
    return c.redirect("/admin/users?ok=deleted");
  } catch (err) {
    const message = encodeURIComponent((err as Error).message || "Uživatele se nepodařilo smazat.");
    return c.redirect(`/admin/users/${id}?err=${message}`);
  }
});

admin.post("/admin/users/:id/purchases/new", async (c) => {
  const id = c.req.param("id");
  const db = drizzle(c.env.DB);
  const body = await c.req.parseBody();
  const access = String(body.access ?? "individual");
  const expiresOn = String(body.expiresOn ?? "");

  if (access !== "individual" && access !== "organization") {
    return c.redirect(`/admin/users/${id}?err=${encodeURIComponent("Neplatný typ přístupu.")}`);
  }

  try {
    const expiresAt = parseAdminGrantExpiresAt(expiresOn);
    await grantAdminAccess(db, { userId: id, access, expiresAt });
    return c.redirect(`/admin/users/${id}?ok=granted`);
  } catch (err) {
    const message = encodeURIComponent((err as Error).message || "Grant se nepodařilo přidat.");
    return c.redirect(`/admin/users/${id}?err=${message}`);
  }
});

admin.post("/admin/users/:id/purchases/:purchaseId/revoke", async (c) => {
  const id = c.req.param("id");
  const purchaseId = parseInt(c.req.param("purchaseId"), 10);
  const db = drizzle(c.env.DB);
  try {
    await revokeAdminPurchase(db, { userId: id, purchaseId });
    return c.redirect(`/admin/users/${id}?ok=revoked`);
  } catch (err) {
    const message = encodeURIComponent((err as Error).message || "Přístup se nepodařilo odebrat.");
    return c.redirect(`/admin/users/${id}?err=${message}`);
  }
});

admin.post("/admin/users/:id/purchases/:purchaseId/extend", async (c) => {
  const id = c.req.param("id");
  const purchaseId = parseInt(c.req.param("purchaseId"), 10);
  const db = drizzle(c.env.DB);
  const body = await c.req.parseBody();
  const expiresOn = String(body.expiresOn ?? "");
  try {
    const expiresAt = parseAdminGrantExpiresAt(expiresOn);
    await extendAdminPurchase(db, { userId: id, purchaseId, expiresAt });
    return c.redirect(`/admin/users/${id}?ok=extended`);
  } catch (err) {
    const message = encodeURIComponent((err as Error).message || "Platnost se nepodařilo upravit.");
    return c.redirect(`/admin/users/${id}?err=${message}`);
  }
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

// ─── Bunny API proxy ──────────────────────────────────────────────

admin.get("/admin/api/bunny/video/:videoId", async (c) => {
  const videoId = c.req.param("videoId");
  const libraryId = c.env.BUNNY_LIBRARY_ID;
  const apiKey = c.env.BUNNY_API_KEY;
  const url = `https://video.bunnycdn.com/library/${libraryId}/videos/${videoId}`;
  const res = await fetch(url, { headers: { AccessKey: apiKey } });
  const body = await res.text();
  if (!res.ok) {
    return c.json({
      error: `Bunny vrátil ${res.status}`,
      detail: body,
      libraryId,
      url,
    }, 502);
  }
  const data = JSON.parse(body) as Record<string, unknown>;
  return c.json({
    title: data.title,
    length: data.length,
    chapters: data.chapters,
    moments: data.moments,
    thumbnailFileName: data.thumbnailFileName,
    status: data.status,
  });
});

// ─── FIO manual scan ─────────────────────────────────────────────

admin.post("/admin/api/fio/scan", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const result = await scanFioPayments(db, c.env);
    return c.json({ ok: true, ...result });
  } catch (err) {
    return c.json({ ok: false, error: (err as Error).message }, 500);
  }
});

// ─── Transcribe AI ────────────────────────────────────────────────

admin.post("/admin/api/lessons/:id/transcribe", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const db = drizzle(c.env.DB);
  const [row] = await db
    .select({
      id: lesson.id,
      bunnyVideoId: lesson.bunnyVideoId,
      moduleId: lesson.moduleId,
    })
    .from(lesson)
    .where(eq(lesson.id, id))
    .limit(1);
  if (!row) return c.text("Not found", 404);
  if (!row.bunnyVideoId) {
    return c.json({ error: "Lekce nemá přiřazené Bunny video." }, 400);
  }

  try {
    await triggerTranscribe(c.env, row.bunnyVideoId, { sourceLanguage: "cs", force: true });
    await db
      .update(lesson)
      .set({ transcribeStatus: "pending", transcribedAt: null, transcribeError: null })
      .where(eq(lesson.id, id));
    return c.redirect(`/admin/lessons/${id}/edit#transkripce`);
  } catch (err) {
    const message = (err as Error).message || "Transkripci se nepodařilo spustit.";
    await db
      .update(lesson)
      .set({ transcribeStatus: "error", transcribeError: message.slice(0, 1000) })
      .where(eq(lesson.id, id));
    return c.html(
      <Layout title="Transkripce selhala" user={c.get("user")!}>
        <div class="max-w-2xl mx-auto px-4 py-8">
          <h1 class="text-2xl font-bold mb-4">Transkripci se nepodařilo spustit</h1>
          <p class="text-red-700 mb-4">{message}</p>
          <a href={`/admin/lessons/${id}/edit`} class="text-indigo-600 hover:underline">
            ← Zpět na lekci
          </a>
        </div>
      </Layout>,
      502,
    );
  }
});

admin.post("/admin/api/lessons/:id/transcribe/refresh", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const db = drizzle(c.env.DB);
  const [row] = await db
    .select({ id: lesson.id, bunnyVideoId: lesson.bunnyVideoId })
    .from(lesson)
    .where(eq(lesson.id, id))
    .limit(1);
  if (!row) return c.text("Not found", 404);
  if (!row.bunnyVideoId) {
    return c.json({ error: "Lekce nemá přiřazené Bunny video." }, 400);
  }

  try {
    const video = await fetchBunnyVideo(c.env, row.bunnyVideoId);
    const captionsSummary = (video.captions ?? [])
      .map((c) => c.srclang)
      .join(",");
    const czechCaption = findCzechCaption(video);
    if (!czechCaption) {
      await db
        .update(lesson)
        .set({
          transcribeError: captionsSummary
            ? `Bunny zatím nemá český caption track. Dostupné jazyky: ${captionsSummary}`
            : "Bunny zatím nemá žádné caption tracky — transkripce stále probíhá.",
        })
        .where(eq(lesson.id, id));
      return c.redirect(`/admin/lessons/${id}/edit#transkripce`);
    }
    const result = await fetchCaptionVtt(c.env, row.bunnyVideoId, czechCaption.srclang);
    if (result.kind === "ok") {
      await db
        .update(lesson)
        .set({
          transcribeStatus: "done",
          transcribedAt: new Date(),
          transcript: vttToPlainText(result.vtt),
          transcribeError: null,
        })
        .where(eq(lesson.id, id));
    } else {
      const diag = result.kind === "no-pull-zone"
        ? "Captions u Bunny existují, ale BUNNY_PULL_ZONE secret není nastavený."
        : `Captions u Bunny existují (${captionsSummary}), ale CDN vrátil HTTP ${result.status} na ${result.url}. Soubor se možná teprve generuje, zkus za 5 minut. Pokud trvá déle, zkontroluj cestu k VTT.`;
      await db
        .update(lesson)
        .set({
          transcribeStatus: "done",
          transcribedAt: new Date(),
          transcript: null,
          transcribeError: diag,
        })
        .where(eq(lesson.id, id));
    }
    return c.redirect(`/admin/lessons/${id}/edit#transkripce`);
  } catch (err) {
    const message = (err as Error).message || "Stav se nepodařilo obnovit.";
    await db
      .update(lesson)
      .set({ transcribeStatus: "error", transcribeError: message.slice(0, 1000) })
      .where(eq(lesson.id, id));
    return c.html(
      <Layout title="Obnovení selhalo" user={c.get("user")!}>
        <div class="max-w-2xl mx-auto px-4 py-8">
          <h1 class="text-2xl font-bold mb-4">Obnovení stavu selhalo</h1>
          <p class="text-red-700 mb-4">{message}</p>
          <a href={`/admin/lessons/${id}/edit`} class="text-indigo-600 hover:underline">
            ← Zpět na lekci
          </a>
        </div>
      </Layout>,
      502,
    );
  }
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
    const durationSeconds =
      parseInt(String(body.durationMinutes ?? "0"), 10) * 60 +
      parseInt(String(body.durationSecondsRem ?? "0"), 10);
    const sortOrder = parseInt(String(body.sortOrder ?? "0"), 10);
    const isFree = body.isFree === "on";
    const chapters = String(body.chaptersJson ?? "[]").trim() || "[]";
    const moments = String(body.momentsJson ?? "[]").trim() || "[]";
    const bodyMarkdown = String(body.bodyMarkdown ?? "").trim();

    await db.insert(lesson).values({
      moduleId,
      publicId: nanoid(8),
      title,
      slug,
      bunnyVideoId,
      durationSeconds,
      sortOrder,
      isFree,
      chapters,
      moments,
      bodyMarkdown,
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

  const saved = c.req.query("saved") === "1";
  return c.html(
    <Layout title="Upravit epizodu" user={currentUser}>
      <AdminLessonForm
        courseId={row.courseId}
        moduleId={row.lesson.moduleId}
        lesson={row.lesson}
        saved={saved}
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
  const durationSeconds =
    parseInt(String(body.durationMinutes ?? "0"), 10) * 60 +
    parseInt(String(body.durationSecondsRem ?? "0"), 10);
  const sortOrder = parseInt(String(body.sortOrder ?? "0"), 10);
  const isFree = body.isFree === "on";
  const chapters = String(body.chaptersJson ?? "[]").trim() || "[]";
  const moments = String(body.momentsJson ?? "[]").trim() || "[]";
  const bodyMarkdown = String(body.bodyMarkdown ?? "").trim();

  await db
    .update(lesson)
    .set({ title, slug, bunnyVideoId, durationSeconds, sortOrder, isFree, chapters, moments, bodyMarkdown })
    .where(eq(lesson.id, id));

  await c.env.KV.delete("cache:catalog");
  return c.redirect(`/admin/lessons/${id}/edit?saved=1`);
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

// ─── Settings ─────────────────────────────────────────────────────

async function loadSettings(db: ReturnType<typeof drizzle>) {
  const rows = await db.select().from(siteConfig);
  const cfg = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const codeExpiresRaw = cfg.discount_code_expires_at ?? "";
  const codeExpiresAt = codeExpiresRaw ? new Date(codeExpiresRaw) : null;
  return {
    priceIndividual: parseInt(cfg.price_individual ?? "2000", 10),
    priceOrganization: parseInt(cfg.price_organization ?? "15000", 10),
    benefitsIndividual: JSON.parse(cfg.benefits_individual ?? "[]") as string[],
    benefitsOrganization: JSON.parse(cfg.benefits_organization ?? "[]") as string[],
    discount: {
      active: cfg.discount_active === "true",
      percent: parseInt(cfg.discount_percent ?? "0", 10),
      limit: parseInt(cfg.discount_limit ?? "0", 10),
      code: cfg.discount_code ?? "",
      codeExpiresAt: codeExpiresAt && !Number.isNaN(codeExpiresAt.getTime()) ? codeExpiresAt : null,
      label: cfg.discount_label ?? "",
    },
  };
}

export async function loadDiscountSettings(db: ReturnType<typeof drizzle>) {
  const s = await loadSettings(db);
  return s.discount;
}

admin.get("/admin/settings", async (c) => {
  const currentUser = c.get("user")!;
  const db = drizzle(c.env.DB);
  const settings = await loadSettings(db);
  const slotsUsed = await countDiscountedActivePurchases(db);
  return c.html(
    <Layout title="Nastavení" user={currentUser}>
      <AdminSettingsForm {...settings} slotsUsed={slotsUsed} />
    </Layout>
  );
});

admin.post("/admin/settings", async (c) => {
  const db = drizzle(c.env.DB);
  const body = await c.req.parseBody();

  const priceIndividual = Math.max(0, parseInt(String(body.price_individual ?? "2000"), 10));
  const priceOrganization = Math.max(0, parseInt(String(body.price_organization ?? "15000"), 10));
  const benefitsIndividual = String(body.benefits_individual ?? "[]");
  const benefitsOrganization = String(body.benefits_organization ?? "[]");

  const discountActive = body.discount_active === "on";
  const discountPercent = Math.max(0, Math.min(100, parseInt(String(body.discount_percent ?? "0"), 10) || 0));
  const discountLimit = Math.max(0, parseInt(String(body.discount_limit ?? "0"), 10) || 0);
  const discountCode = String(body.discount_code ?? "").trim();
  const discountCodeExpiresOn = String(body.discount_code_expires_on ?? "").trim();
  const discountCodeExpiresAt = discountCodeExpiresOn
    ? new Date(`${discountCodeExpiresOn}T23:59:59.999Z`)
    : null;
  const discountLabel = String(body.discount_label ?? "").trim();

  const updates: Array<[string, string]> = [
    ["price_individual", String(priceIndividual)],
    ["price_organization", String(priceOrganization)],
    ["benefits_individual", benefitsIndividual],
    ["benefits_organization", benefitsOrganization],
    ["discount_active", discountActive ? "true" : "false"],
    ["discount_percent", String(discountPercent)],
    ["discount_limit", String(discountLimit)],
    ["discount_code", discountCode],
    [
      "discount_code_expires_at",
      discountCodeExpiresAt && !Number.isNaN(discountCodeExpiresAt.getTime())
        ? discountCodeExpiresAt.toISOString()
        : "",
    ],
    ["discount_label", discountLabel],
  ];

  await Promise.all(
    updates.map(([key, value]) =>
      db
        .insert(siteConfig)
        .values({ key, value })
        .onConflictDoUpdate({ target: siteConfig.key, set: { value } }),
    ),
  );

  await c.env.KV.delete("cache:catalog");

  const currentUser = c.get("user")!;
  const settings = await loadSettings(db);
  const slotsUsed = await countDiscountedActivePurchases(db);
  return c.html(
    <Layout title="Nastavení" user={currentUser}>
      <AdminSettingsForm {...settings} slotsUsed={slotsUsed} saved />
    </Layout>
  );
});

export { admin as adminRoutes, loadSettings };
