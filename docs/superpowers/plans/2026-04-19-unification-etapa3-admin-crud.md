# Admin CRUD — Kurzy, Moduly, Lekce

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Přidat plný CRUD pro správu kurzů, modulů a lekcí do admin sekce projektu videokurzy.

**Architecture:** Nový soubor `src/views/admin-courses.tsx` obsahuje view komponenty portované z `videokurz-demo/src/components/AdminPage.tsx`. Route handlery se přidají do existujícího `src/routes/admin.tsx`. KV klíč `cache:catalog` se invaliduje po každé mutaci.

**Tech Stack:** Hono JSX, Drizzle ORM, Cloudflare D1, Cloudflare KV, TypeScript, Tailwind CSS utility classes

---

## Soubory

**Vytvořit:**
- `src/views/admin-courses.tsx` — view komponenty: `AdminCoursesList`, `AdminCourseForm`, `AdminCourseDetail`, `AdminModuleForm`, `AdminLessonForm`, sdílené helpery `AdminField`, `AdminCheckbox`, `adminFormatDuration`

**Upravit:**
- `src/routes/admin.tsx` — přidat import views, přidat všechny CRUD routes pro kurzy/moduly/lekce

---

## Úkol 1: Vytvořit src/views/admin-courses.tsx

**Soubory:**
- Vytvořit: `src/views/admin-courses.tsx`

- [ ] **Krok 1.1: Vytvořit views soubor**

Vytvořit `src/views/admin-courses.tsx` s tímto obsahem:

```tsx
// ─── Types ────────────────────────────────────────────────────────

type Course = {
  id: number;
  title: string;
  slug: string;
  description: string;
  published: boolean;
};

type Module = {
  id: number;
  courseId: number;
  title: string;
  slug: string;
  sortOrder: number;
};

type Lesson = {
  id: number;
  publicId: string;
  moduleId: number;
  title: string;
  slug: string;
  bunnyVideoId: string | null;
  durationSeconds: number;
  isFree: boolean;
  sortOrder: number;
};

// ─── Navigation ───────────────────────────────────────────────────

function AdminCoursesNav({ active }: { active: string }) {
  const links = [
    { href: "/admin", label: "Přehled" },
    { href: "/admin/courses", label: "Kurzy" },
  ];
  return (
    <nav class="flex gap-1 mb-8 border-b border-gray-200 pb-2">
      {links.map((l) => (
        <a
          href={l.href}
          class={`px-4 py-2 rounded-t-lg text-sm font-medium no-underline transition-colors ${
            active === l.href
              ? "bg-indigo-600 text-white"
              : "text-gray-600 hover:bg-gray-100"
          }`}
        >
          {l.label}
        </a>
      ))}
    </nav>
  );
}

// ─── Courses list ─────────────────────────────────────────────────

export function AdminCoursesList({ courses }: { courses: Course[] }) {
  return (
    <section class="max-w-5xl mx-auto px-4 py-8">
      <h1 class="text-2xl font-bold mb-6">Admin</h1>
      <AdminCoursesNav active="/admin/courses" />
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-lg font-semibold">Kurzy</h2>
        <a
          href="/admin/courses/new"
          class="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium no-underline hover:bg-indigo-700"
        >
          + Nový kurz
        </a>
      </div>
      {courses.length === 0 ? (
        <p class="text-gray-500">Žádné kurzy.</p>
      ) : (
        <div class="space-y-3">
          {courses.map((c) => (
            <div class="bg-white border border-gray-200 rounded-lg p-4 flex items-center justify-between">
              <div>
                <a
                  href={`/admin/courses/${c.id}`}
                  class="font-medium text-indigo-600 hover:underline no-underline"
                >
                  {c.title}
                </a>
                <div class="text-xs text-gray-400 mt-0.5">/{c.slug}</div>
              </div>
              <span
                class={`px-2 py-0.5 rounded text-xs font-medium ${
                  c.published
                    ? "bg-green-100 text-green-800"
                    : "bg-gray-100 text-gray-600"
                }`}
              >
                {c.published ? "Publikováno" : "Skryto"}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ─── Course form (new + edit) ─────────────────────────────────────

export function AdminCourseForm({ course }: { course?: Course }) {
  const isEdit = !!course;
  return (
    <section class="max-w-3xl mx-auto px-4 py-8">
      <a
        href="/admin/courses"
        class="text-sm text-gray-400 hover:text-gray-600 no-underline"
      >
        &larr; Kurzy
      </a>
      <h1 class="text-2xl font-bold mb-6 mt-2">
        {isEdit ? "Upravit kurz" : "Nový kurz"}
      </h1>
      <form method="post" class="space-y-4">
        <AdminField label="Název" name="title" value={course?.title} required />
        <AdminField label="Slug (URL)" name="slug" value={course?.slug} required />
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Popis</label>
          <textarea
            name="description"
            rows={3}
            class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          >
            {course?.description ?? ""}
          </textarea>
        </div>
        <AdminCheckbox
          label="Publikováno"
          name="published"
          checked={course?.published ?? false}
        />
        <div class="flex gap-3 pt-2">
          <button
            type="submit"
            class="bg-indigo-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700"
          >
            {isEdit ? "Uložit" : "Vytvořit"}
          </button>
          <a
            href="/admin/courses"
            class="text-gray-500 hover:text-gray-700 px-4 py-2 text-sm no-underline"
          >
            Zrušit
          </a>
        </div>
      </form>
      {isEdit && (
        <div class="mt-8 pt-6 border-t border-gray-200">
          <h3 class="text-sm font-medium text-red-700 mb-2">Nebezpečná zóna</h3>
          <form
            method="post"
            action={`/admin/courses/${course!.id}/delete`}
          >
            <button
              type="submit"
              class="bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-700"
              onclick="return confirm('Opravdu smazat kurz a vše pod ním?')"
            >
              Smazat kurz
            </button>
          </form>
        </div>
      )}
    </section>
  );
}

// ─── Course detail (modules + lessons) ───────────────────────────

export function AdminCourseDetail({
  course,
  modules,
}: {
  course: Course;
  modules: (Module & { lessons: Lesson[] })[];
}) {
  return (
    <section class="max-w-5xl mx-auto px-4 py-8">
      <div class="flex items-center justify-between mb-6">
        <div>
          <a
            href="/admin/courses"
            class="text-sm text-gray-400 hover:text-gray-600 no-underline"
          >
            &larr; Kurzy
          </a>
          <h1 class="text-2xl font-bold">{course.title}</h1>
          <p class="text-sm text-gray-500">
            /{course.slug} &middot;{" "}
            {course.published ? "Publikováno" : "Skryto"}
          </p>
        </div>
        <a
          href={`/admin/courses/${course.id}/edit`}
          class="bg-gray-100 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium no-underline hover:bg-gray-200"
        >
          Upravit kurz
        </a>
      </div>

      <div class="flex items-center justify-between mb-4">
        <h2 class="text-lg font-semibold">Moduly</h2>
        <a
          href={`/admin/courses/${course.id}/modules/new`}
          class="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium no-underline hover:bg-indigo-700"
        >
          + Nový modul
        </a>
      </div>

      {modules.length === 0 ? (
        <p class="text-gray-500">Žádné moduly. Přidejte první.</p>
      ) : (
        <div class="space-y-6">
          {modules.map((m) => (
            <div class="bg-white border border-gray-200 rounded-lg">
              <div class="p-4 border-b border-gray-100 flex items-center justify-between">
                <div>
                  <span class="font-medium">{m.title}</span>
                  <span class="text-xs text-gray-400 ml-2">
                    pořadí: {m.sortOrder}
                  </span>
                </div>
                <div class="flex gap-2">
                  <a
                    href={`/admin/courses/${course.id}/modules/${m.id}/lessons/new`}
                    class="text-indigo-600 text-sm no-underline hover:underline"
                  >
                    + Epizoda
                  </a>
                  <a
                    href={`/admin/courses/${course.id}/modules/${m.id}/edit`}
                    class="text-gray-400 text-sm no-underline hover:text-gray-600"
                  >
                    Upravit
                  </a>
                </div>
              </div>
              {m.lessons.length > 0 && (
                <div class="divide-y divide-gray-50">
                  {m.lessons.map((l) => (
                    <div class="px-4 py-3 flex items-center justify-between text-sm">
                      <div class="flex items-center gap-3">
                        <span class="text-gray-400 w-6 text-right">
                          {l.sortOrder}.
                        </span>
                        <a
                          href={`/admin/lessons/${l.id}/edit`}
                          class="text-gray-900 no-underline hover:text-indigo-600"
                        >
                          {l.title}
                        </a>
                        {l.isFree && (
                          <span class="bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded text-xs">
                            zdarma
                          </span>
                        )}
                      </div>
                      <div class="text-gray-400 text-xs flex gap-3">
                        {l.bunnyVideoId ? (
                          <span class="text-green-600">video ✓</span>
                        ) : (
                          <span class="text-red-500">bez videa</span>
                        )}
                        <span>{adminFormatDuration(l.durationSeconds)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ─── Module form (new + edit) ─────────────────────────────────────

export function AdminModuleForm({
  courseId,
  mod,
}: {
  courseId: number;
  mod?: Module;
}) {
  const isEdit = !!mod;
  return (
    <section class="max-w-3xl mx-auto px-4 py-8">
      <a
        href={`/admin/courses/${courseId}`}
        class="text-sm text-gray-400 hover:text-gray-600 no-underline"
      >
        &larr; Zpět na kurz
      </a>
      <h1 class="text-2xl font-bold mb-6 mt-2">
        {isEdit ? "Upravit modul" : "Nový modul"}
      </h1>
      <form method="post" class="space-y-4">
        <AdminField label="Název" name="title" value={mod?.title} required />
        <AdminField label="Slug" name="slug" value={mod?.slug} required />
        <AdminField
          label="Pořadí"
          name="sortOrder"
          type="number"
          value={String(mod?.sortOrder ?? 0)}
          required
        />
        <div class="flex gap-3 pt-2">
          <button
            type="submit"
            class="bg-indigo-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700"
          >
            {isEdit ? "Uložit" : "Vytvořit"}
          </button>
          <a
            href={`/admin/courses/${courseId}`}
            class="text-gray-500 hover:text-gray-700 px-4 py-2 text-sm no-underline"
          >
            Zrušit
          </a>
        </div>
      </form>
      {isEdit && (
        <div class="mt-8 pt-6 border-t border-gray-200">
          <form
            method="post"
            action={`/admin/courses/${courseId}/modules/${mod!.id}/delete`}
          >
            <button
              type="submit"
              class="bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-700"
              onclick="return confirm('Smazat modul a všechny epizody v něm?')"
            >
              Smazat modul
            </button>
          </form>
        </div>
      )}
    </section>
  );
}

// ─── Lesson form (new + edit) ─────────────────────────────────────

export function AdminLessonForm({
  courseId,
  moduleId,
  lesson: les,
}: {
  courseId: number;
  moduleId: number;
  lesson?: Lesson;
}) {
  const isEdit = !!les;
  return (
    <section class="max-w-3xl mx-auto px-4 py-8">
      <a
        href={`/admin/courses/${courseId}`}
        class="text-sm text-gray-400 hover:text-gray-600 no-underline"
      >
        &larr; Zpět na kurz
      </a>
      <h1 class="text-2xl font-bold mb-6 mt-2">
        {isEdit ? "Upravit epizodu" : "Nová epizoda"}
      </h1>
      <form method="post" class="space-y-4">
        <AdminField label="Název" name="title" value={les?.title} required />
        <AdminField label="Slug" name="slug" value={les?.slug} required />
        <AdminField
          label="Bunny Video ID"
          name="bunnyVideoId"
          value={les?.bunnyVideoId ?? ""}
        />
        <AdminField
          label="Délka (sekundy)"
          name="durationSeconds"
          type="number"
          value={String(les?.durationSeconds ?? 0)}
          required
        />
        <AdminField
          label="Pořadí"
          name="sortOrder"
          type="number"
          value={String(les?.sortOrder ?? 0)}
          required
        />
        <AdminCheckbox
          label="Zdarma (free preview)"
          name="isFree"
          checked={les?.isFree ?? false}
        />
        <div class="flex gap-3 pt-2">
          <button
            type="submit"
            class="bg-indigo-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700"
          >
            {isEdit ? "Uložit" : "Vytvořit"}
          </button>
          <a
            href={`/admin/courses/${courseId}`}
            class="text-gray-500 hover:text-gray-700 px-4 py-2 text-sm no-underline"
          >
            Zrušit
          </a>
        </div>
      </form>
      {isEdit && (
        <div class="mt-8 pt-6 border-t border-gray-200">
          <form method="post" action={`/admin/lessons/${les!.id}/delete`}>
            <button
              type="submit"
              class="bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-700"
              onclick="return confirm('Smazat epizodu?')"
            >
              Smazat epizodu
            </button>
          </form>
        </div>
      )}
    </section>
  );
}

// ─── Shared helpers ───────────────────────────────────────────────

function AdminField({
  label,
  name,
  value,
  type = "text",
  required,
}: {
  label: string;
  name: string;
  value?: string;
  type?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label class="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <input
        type={type}
        name={name}
        value={value ?? ""}
        required={required}
        class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
      />
    </div>
  );
}

function AdminCheckbox({
  label,
  name,
  checked,
}: {
  label: string;
  name: string;
  checked: boolean;
}) {
  return (
    <label class="flex items-center gap-2 text-sm text-gray-700">
      <input
        type="checkbox"
        name={name}
        value="on"
        checked={checked}
        class="rounded border-gray-300"
      />
      {label}
    </label>
  );
}

export function adminFormatDuration(seconds: number): string {
  if (seconds === 0) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
```

- [ ] **Krok 1.2: Ověřit TypeScript**

```bash
cd /Users/patrickzandl/GitHub/videokurzy && npm run typecheck
```

Očekáváno: žádné chyby.

- [ ] **Krok 1.3: Commit**

```bash
cd /Users/patrickzandl/GitHub/videokurzy
git add src/views/admin-courses.tsx
git commit -m "feat: add admin-courses views (port from videokurz-demo)"
```

---

## Úkol 2: Course CRUD routes

**Soubory:**
- Upravit: `src/routes/admin.tsx`

Existující `admin.tsx` již importuje `{ course, module, lesson, … }` ze schématu a `nanoid`. Stačí přidat import views a nové routes.

- [ ] **Krok 2.1: Přidat import views do admin.tsx**

Na začátek souboru přidat (za existující importy):

```tsx
import {
  AdminCoursesList,
  AdminCourseForm,
  AdminCourseDetail,
  AdminModuleForm,
  AdminLessonForm,
} from "../views/admin-courses";
```

- [ ] **Krok 2.2: Nahradit existující GET /admin/courses**

Existující handler (řádky ~176–218) nahradit:

```tsx
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
```

- [ ] **Krok 2.3: Přidat GET /admin/courses/new**

```tsx
admin.get("/admin/courses/new", async (c) => {
  const currentUser = c.get("user")!;
  return c.html(
    <Layout title="Nový kurz" user={currentUser}>
      <AdminCourseForm />
    </Layout>
  );
});
```

- [ ] **Krok 2.4: Přidat POST /admin/courses/new**

```tsx
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
```

- [ ] **Krok 2.5: Přidat GET /admin/courses/:id**

```tsx
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
```

- [ ] **Krok 2.6: Přidat GET + POST /admin/courses/:id/edit**

```tsx
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
```

- [ ] **Krok 2.7: Přidat POST /admin/courses/:id/delete**

```tsx
admin.post("/admin/courses/:id/delete", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const db = drizzle(c.env.DB);
  await db.delete(course).where(eq(course.id, id));
  await c.env.KV.delete("cache:catalog");
  return c.redirect("/admin/courses");
});
```

- [ ] **Krok 2.8: Typecheck + commit**

```bash
cd /Users/patrickzandl/GitHub/videokurzy && npm run typecheck
git add src/routes/admin.tsx
git commit -m "feat: add course CRUD routes to admin"
```

---

## Úkol 3: Module CRUD routes

**Soubory:**
- Upravit: `src/routes/admin.tsx`

- [ ] **Krok 3.1: Přidat GET + POST /admin/courses/:courseId/modules/new**

```tsx
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
```

- [ ] **Krok 3.2: Přidat GET + POST /admin/courses/:courseId/modules/:moduleId/edit**

```tsx
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
```

- [ ] **Krok 3.3: Přidat POST /admin/courses/:courseId/modules/:moduleId/delete**

```tsx
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
```

- [ ] **Krok 3.4: Typecheck + commit**

```bash
cd /Users/patrickzandl/GitHub/videokurzy && npm run typecheck
git add src/routes/admin.tsx
git commit -m "feat: add module CRUD routes to admin"
```

---

## Úkol 4: Lesson CRUD routes

**Soubory:**
- Upravit: `src/routes/admin.tsx`

Lekce potřebují `publicId` (nanoid) při vytvoření — `nanoid` je již importován v admin.tsx. Lesson edit/delete zjišťuje `courseId` přes JOIN s tabulkou `module`.

- [ ] **Krok 4.1: Přidat GET + POST /admin/courses/:courseId/modules/:moduleId/lessons/new**

```tsx
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
```

- [ ] **Krok 4.2: Přidat GET + POST /admin/lessons/:id/edit**

JOIN lesson → module zajistí courseId pro redirect a back-link ve views.

```tsx
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
```

- [ ] **Krok 4.3: Přidat POST /admin/lessons/:id/delete**

```tsx
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
```

- [ ] **Krok 4.4: Typecheck + commit**

```bash
cd /Users/patrickzandl/GitHub/videokurzy && npm run typecheck
git add src/routes/admin.tsx
git commit -m "feat: add lesson CRUD routes to admin"
```

---

## Úkol 5: Manuální end-to-end test

- [ ] **Krok 5.1: Spustit dev server**

```bash
cd /Users/patrickzandl/GitHub/videokurzy && npm run dev
```

Wrangler dev nastartuje na `http://localhost:8787`.

- [ ] **Krok 5.2: Testovat kompletní CRUD flow**

Přihlásit se jako admin (`patrick@vibecoding.cz`) přes `http://localhost:8787/login`.

Postupně otestovat:

1. `GET /admin/courses` — vidí seznam s tlačítkem „+ Nový kurz"
2. `GET /admin/courses/new` — formulář funguje, pole validuje required
3. Vytvořit kurz (Název: „Test kurz", Slug: „test-kurz") → redirect na `/admin/courses/1`
4. Detail kurzu zobrazí „Žádné moduly"
5. `GET /admin/courses/1/modules/new` — přidat modul (Název: „Modul 1", Slug: „modul-1", Pořadí: 1)
6. Redirect zpět na detail — modul se zobrazí
7. `GET /admin/courses/1/modules/1/lessons/new` — přidat epizodu (Název: „Epizoda 1", Slug: „ep-1", Pořadí: 1)
8. Redirect zpět na detail — epizoda se zobrazí pod modulem
9. Klik na název epizody → `/admin/lessons/1/edit` — upravit název, uložit → redirect na detail kurzu
10. Klik „Upravit kurz" → togglenout Publikováno → uložit → v seznamu badge „Publikováno"
11. Smazat epizodu (přes edit stránku) → redirect na detail kurzu, epizoda zmizela
12. Smazat modul → redirect, modul zmizel
13. Smazat kurz → redirect na `/admin/courses`, kurz zmizel

- [ ] **Krok 5.3: Ověřit KV invalidaci**

Ve wrangler dev output by nemělo být `KV error`. Pokud KV binding není dostupný lokálně, wrangler dev ho vytvoří jako in-memory storage — chyby by neměly být.

- [ ] **Krok 5.4: Commit pokud vše funguje**

```bash
cd /Users/patrickzandl/GitHub/videokurzy
git tag etapa3-admin-crud-done
```
