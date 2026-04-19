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
          <form method="post" action={`/admin/courses/${course!.id}/delete`}>
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
