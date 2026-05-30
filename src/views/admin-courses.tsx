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
  chapters: string | null;
  moments: string | null;
  bodyMarkdown: string | null;
  transcribeStatus?: "none" | "pending" | "done" | "error";
  transcribedAt?: Date | null;
  transcript?: string | null;
  transcribeError?: string | null;
};

// ─── Navigation ───────────────────────────────────────────────────

export function AdminNav({ active }: { active: string }) {
  const links = [
    { href: "/admin", label: "Přehled" },
    { href: "/admin/users", label: "Uživatelé" },
    { href: "/admin/courses", label: "Kurzy" },
    { href: "/admin/stats", label: "Statistiky" },
    { href: "/admin/settings", label: "Nastavení" },
  ];
  return (
    <nav class="flex flex-wrap items-center gap-1 mb-8 border-b border-gray-200 pb-2">
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
      <a
        href="/admin/users/new"
        class={`sm:ml-auto px-4 py-2 rounded-lg text-sm font-medium no-underline transition-colors ${
          active === "/admin/users/new"
            ? "bg-gray-900 text-white"
            : "bg-gray-900 text-white hover:bg-gray-700"
        }`}
      >
        Přidat uživatele
      </a>
    </nav>
  );
}

// ─── Courses list ─────────────────────────────────────────────────

export function AdminCoursesList({ courses }: { courses: Course[] }) {
  return (
    <section class="max-w-5xl mx-auto px-4 py-8">
      <h1 class="text-2xl font-bold mb-6">Admin</h1>
      <AdminNav active="/admin/courses" />
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

function TranscribeSection({ lesson: les }: { lesson: Lesson }) {
  const status = les.transcribeStatus ?? "none";
  const minutes = Math.max(1, Math.ceil(les.durationSeconds / 60));
  const estPrice = (minutes * 0.10).toFixed(2);

  return (
    <section
      id="transkripce"
      class="border border-indigo-100 bg-indigo-50/30 rounded-lg p-4 space-y-3"
    >
      <div class="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 class="text-sm font-semibold text-gray-900">Transkripce</h3>
          <p class="text-xs text-gray-500">
            Automatický český přepis přes Bunny Transcribe AI (~$0.10 / min).
          </p>
        </div>
        <span
          class={`px-2 py-1 rounded-full text-xs font-medium ${
            status === "done"
              ? "bg-emerald-100 text-emerald-800"
              : status === "pending"
                ? "bg-yellow-100 text-yellow-800"
                : status === "error"
                  ? "bg-red-100 text-red-800"
                  : "bg-gray-100 text-gray-700"
          }`}
        >
          {status === "done" && "hotovo"}
          {status === "pending" && "probíhá"}
          {status === "error" && "chyba"}
          {status === "none" && "neproběhla"}
        </span>
      </div>

      {!les.bunnyVideoId && (
        <p class="text-xs text-gray-500 italic">
          Nejprve přiřaď Bunny Video ID, pak ulož lekci a poté lze spustit transkripci.
        </p>
      )}

      {les.bunnyVideoId && status === "error" && les.transcribeError && (
        <div class="rounded border border-red-200 bg-red-50 p-3 text-xs text-red-800">
          <div class="font-medium mb-1">Chyba:</div>
          <code class="block whitespace-pre-wrap break-all font-mono">{les.transcribeError}</code>
          {les.transcribeError.includes("Missing transcription language settings") && (
            <p class="mt-2 text-red-900">
              <strong>Řešení:</strong> v Bunny dashboardu otevři Stream → tvoje library → Settings →
              Transcribing a zapni „Enable Transcribing" s českým jazykem (cs).
            </p>
          )}
        </div>
      )}

      {les.bunnyVideoId && status === "done" && (
        <div class="space-y-2">
          <p class="text-xs text-gray-500">
            Hotovo {les.transcribedAt ? les.transcribedAt.toLocaleDateString("cs-CZ") : ""}. Titulky
            jsou v playeru jako CC track.
          </p>
          {!les.transcript && les.transcribeError && (
            <div class="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
              <div class="font-medium mb-1">Diagnostika stahování textu:</div>
              <code class="block whitespace-pre-wrap break-all font-mono">{les.transcribeError}</code>
            </div>
          )}
          {les.transcript && (
            <details class="text-sm">
              <summary class="cursor-pointer text-indigo-600 hover:underline">
                Zobrazit přepis ({les.transcript.length.toLocaleString("cs-CZ")} znaků)
              </summary>
              <div class="mt-2 max-h-72 overflow-y-auto whitespace-pre-wrap bg-white border rounded p-3 text-xs leading-relaxed">
                {les.transcript}
              </div>
            </details>
          )}
        </div>
      )}

      {les.bunnyVideoId && status === "pending" && (
        <p class="text-xs text-gray-600">
          Bunny zpracovává video. Krátká videa &lt; 5 min, delší 10–20 min. Po dokončení klikni „Synchronizovat z Bunny" níže.
        </p>
      )}

      {les.bunnyVideoId && (
        <div class="flex flex-wrap items-center gap-2 pt-1">
          {(status === "none" || status === "error") && (
            <form method="post" action={`/admin/api/lessons/${les.id}/transcribe`}>
              <button
                type="submit"
                class="bg-indigo-600 text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700"
                onclick={`return confirm('Spustit transkripci pro ${minutes} min videa? Odhad ceny: $${estPrice}.');`}
              >
                Spustit transkripci
              </button>
            </form>
          )}
          {status === "done" && (
            <form
              method="post"
              action={`/admin/api/lessons/${les.id}/transcribe`}
              onsubmit={`return confirm('Přepsat existující transkript? Cena: $${estPrice}.');`}
            >
              <button
                type="submit"
                class="bg-white border border-gray-300 text-gray-700 px-3 py-2 rounded-lg text-sm font-medium hover:bg-gray-50"
              >
                Spustit znovu
              </button>
            </form>
          )}
          <form method="post" action={`/admin/api/lessons/${les.id}/transcribe/refresh`}>
            <button
              type="submit"
              class="bg-gray-900 text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-gray-700"
              title="Zjistí aktuální stav z Bunny. Funguje i když transkripci spustíš v Bunny dashboardu."
            >
              Synchronizovat z Bunny
            </button>
          </form>
          <span class="text-xs text-gray-500">~{minutes} min · ${estPrice}</span>
        </div>
      )}
    </section>
  );
}

export function AdminLessonForm({
  courseId,
  moduleId,
  lesson: les,
  saved,
}: {
  courseId: number;
  moduleId: number;
  lesson?: Lesson;
  saved?: boolean;
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
      {saved && (
        <div class="mb-6 bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-lg text-sm">
          Změny uloženy.
        </div>
      )}
      <form method="post" class="space-y-4" id="lesson-form">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Název</label>
          <input
            id="lesson-title"
            type="text"
            name="title"
            value={les?.title ?? ""}
            required
            class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          />
        </div>
        <div>
          <div class="flex items-center justify-between mb-1">
            <label class="block text-sm font-medium text-gray-700">Slug</label>
            <button
              type="button"
              id="slug-auto-btn"
              class="text-xs text-indigo-500 hover:text-indigo-700"
            >
              ↺ generovat z názvu
            </button>
          </div>
          <input
            id="slug-input"
            type="text"
            name="slug"
            value={les?.slug ?? ""}
            required
            class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          />
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Bunny Video ID</label>
          <div class="flex gap-2">
            <input
              id="bunny-video-id"
              type="text"
              name="bunnyVideoId"
              value={les?.bunnyVideoId ?? ""}
              class="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
            <button
              type="button"
              id="bunny-load-btn"
              class="bg-gray-100 text-gray-700 px-3 py-2 rounded-lg text-sm font-medium hover:bg-gray-200 whitespace-nowrap"
            >
              Načíst z Bunny
            </button>
          </div>
          <div id="bunny-status" class="text-xs mt-1 text-gray-400 hidden"></div>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Délka</label>
          <div class="flex items-center gap-2">
            <input
              type="number"
              name="durationMinutes"
              min="0"
              value={String(Math.floor((les?.durationSeconds ?? 0) / 60))}
              class="w-24 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
            <span class="text-gray-500 text-sm">min</span>
            <input
              type="number"
              name="durationSecondsRem"
              min="0"
              max="59"
              value={String((les?.durationSeconds ?? 0) % 60)}
              class="w-24 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
            <span class="text-gray-500 text-sm">sek</span>
          </div>
        </div>
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
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Popis lekce (Markdown)</label>
          <textarea
            name="bodyMarkdown"
            rows={7}
            class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 font-mono"
            placeholder="Krátký úvod, odkazy, odrážky nebo poznámky k epizodě."
          >
            {les?.bodyMarkdown ?? ""}
          </textarea>
          <p class="text-xs text-gray-400 mt-1">
            Podporuje odstavce, odrážky, odkazy, tučné písmo, kurzívu a inline kód.
          </p>
        </div>

        {/* Chapters */}
        <div>
          <div class="flex items-center justify-between mb-2">
            <label class="block text-sm font-medium text-gray-700">Chapters</label>
            <button type="button" id="add-chapter-btn" class="text-xs text-indigo-500 hover:text-indigo-700">+ Přidat chapter</button>
          </div>
          <div id="chapters-list" class="space-y-2">
            {(les?.chapters ? JSON.parse(les.chapters) as {title:string;start:number;end:number}[] : []).map((ch, i) => (
              <div class="chapter-row flex gap-2 items-start">
                <input type="text" name={`chapter_title_${i}`} value={ch.title} placeholder="Název" class="flex-1 border border-gray-300 rounded px-2 py-1 text-sm" />
                <input type="number" name={`chapter_start_${i}`} value={String(ch.start)} placeholder="Začátek (s)" class="w-24 border border-gray-300 rounded px-2 py-1 text-sm" />
                <input type="number" name={`chapter_end_${i}`} value={String(ch.end)} placeholder="Konec (s)" class="w-24 border border-gray-300 rounded px-2 py-1 text-sm" />
                <button type="button" class="remove-row text-gray-400 hover:text-red-500 text-lg leading-none px-1">✕</button>
              </div>
            ))}
          </div>
          <input type="hidden" name="chaptersJson" id="chapters-json" value={les?.chapters ?? "[]"} />
        </div>

        {/* Moments */}
        <div>
          <div class="flex items-center justify-between mb-2">
            <label class="block text-sm font-medium text-gray-700">Moments</label>
            <button type="button" id="add-moment-btn" class="text-xs text-indigo-500 hover:text-indigo-700">+ Přidat moment</button>
          </div>
          <div id="moments-list" class="space-y-2">
            {(les?.moments ? JSON.parse(les.moments) as {label:string;timestamp:number}[] : []).map((mo, i) => (
              <div class="moment-row flex gap-2 items-start">
                <input type="text" name={`moment_label_${i}`} value={mo.label} placeholder="Popisek" class="flex-1 border border-gray-300 rounded px-2 py-1 text-sm" />
                <input type="number" name={`moment_timestamp_${i}`} value={String(mo.timestamp)} placeholder="Čas (s)" class="w-24 border border-gray-300 rounded px-2 py-1 text-sm" />
                <button type="button" class="remove-row text-gray-400 hover:text-red-500 text-lg leading-none px-1">✕</button>
              </div>
            ))}
          </div>
          <input type="hidden" name="momentsJson" id="moments-json" value={les?.moments ?? "[]"} />
        </div>

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
      <script dangerouslySetInnerHTML={{ __html: `
        (function () {
          var titleEl = document.getElementById('lesson-title');
          var slugEl = document.getElementById('slug-input');
          var autoBtn = document.getElementById('slug-auto-btn');
          var bunnyIdEl = document.getElementById('bunny-video-id');
          var bunnyBtn = document.getElementById('bunny-load-btn');
          var bunnyStatus = document.getElementById('bunny-status');
          var chaptersList = document.getElementById('chapters-list');
          var momentsList = document.getElementById('moments-list');
          var chaptersJson = document.getElementById('chapters-json');
          var momentsJson = document.getElementById('moments-json');
          var autoMode = slugEl.value === '';

          function slugify(s) {
            var map = {'á':'a','č':'c','ď':'d','é':'e','ě':'e','í':'i','ň':'n','ó':'o','ř':'r','š':'s','ť':'t','ú':'u','ů':'u','ý':'y','ž':'z'};
            return s.toLowerCase()
              .replace(/[áčďéěíňóřšťúůýž]/g, function(c){ return map[c]||c; })
              .replace(/[^a-z0-9]+/g, '-')
              .replace(/^-+|-+$/, '');
          }

          function fmtTime(s) {
            var m = Math.floor(s/60);
            return m + ':' + String(s%60).padStart(2,'0');
          }

          function addChapterRow(title, start, end) {
            var div = document.createElement('div');
            div.className = 'chapter-row flex gap-2 items-start';
            div.innerHTML =
              '<input type="text" placeholder="Název" class="flex-1 border border-gray-300 rounded px-2 py-1 text-sm" value="' + (title||'').replace(/"/g,'&quot;') + '">' +
              '<input type="number" placeholder="Začátek (s)" class="w-24 border border-gray-300 rounded px-2 py-1 text-sm" value="' + (start||0) + '">' +
              '<input type="number" placeholder="Konec (s)" class="w-24 border border-gray-300 rounded px-2 py-1 text-sm" value="' + (end||0) + '">' +
              '<button type="button" class="remove-row text-gray-400 hover:text-red-500 text-lg leading-none px-1">✕</button>';
            div.querySelector('.remove-row').addEventListener('click', function(){ div.remove(); serializeChapters(); });
            div.querySelectorAll('input').forEach(function(el){ el.addEventListener('change', serializeChapters); el.addEventListener('input', serializeChapters); });
            chaptersList.appendChild(div);
            serializeChapters();
          }

          function addMomentRow(label, timestamp) {
            var div = document.createElement('div');
            div.className = 'moment-row flex gap-2 items-start';
            div.innerHTML =
              '<input type="text" placeholder="Popisek" class="flex-1 border border-gray-300 rounded px-2 py-1 text-sm" value="' + (label||'').replace(/"/g,'&quot;') + '">' +
              '<input type="number" placeholder="Čas (s)" class="w-24 border border-gray-300 rounded px-2 py-1 text-sm" value="' + (timestamp||0) + '">' +
              '<button type="button" class="remove-row text-gray-400 hover:text-red-500 text-lg leading-none px-1">✕</button>';
            div.querySelector('.remove-row').addEventListener('click', function(){ div.remove(); serializeMoments(); });
            div.querySelectorAll('input').forEach(function(el){ el.addEventListener('change', serializeMoments); el.addEventListener('input', serializeMoments); });
            momentsList.appendChild(div);
            serializeMoments();
          }

          function serializeChapters() {
            var rows = chaptersList.querySelectorAll('.chapter-row');
            var result = [];
            rows.forEach(function(row) {
              var inputs = row.querySelectorAll('input');
              result.push({ title: inputs[0].value, start: parseInt(inputs[1].value)||0, end: parseInt(inputs[2].value)||0 });
            });
            chaptersJson.value = JSON.stringify(result);
          }

          function serializeMoments() {
            var rows = momentsList.querySelectorAll('.moment-row');
            var result = [];
            rows.forEach(function(row) {
              var inputs = row.querySelectorAll('input');
              result.push({ label: inputs[0].value, timestamp: parseInt(inputs[1].value)||0 });
            });
            momentsJson.value = JSON.stringify(result);
          }

          // Wire up remove buttons for server-rendered rows
          chaptersList.querySelectorAll('.remove-row').forEach(function(btn) {
            btn.addEventListener('click', function(){ btn.closest('.chapter-row').remove(); serializeChapters(); });
          });
          chaptersList.querySelectorAll('input').forEach(function(el){ el.addEventListener('change', serializeChapters); el.addEventListener('input', serializeChapters); });
          momentsList.querySelectorAll('.remove-row').forEach(function(btn) {
            btn.addEventListener('click', function(){ btn.closest('.moment-row').remove(); serializeMoments(); });
          });
          momentsList.querySelectorAll('input').forEach(function(el){ el.addEventListener('change', serializeMoments); el.addEventListener('input', serializeMoments); });

          document.getElementById('add-chapter-btn').addEventListener('click', function(){ addChapterRow('', 0, 0); });
          document.getElementById('add-moment-btn').addEventListener('click', function(){ addMomentRow('', 0); });

          titleEl && titleEl.addEventListener('input', function () {
            if (autoMode) slugEl.value = slugify(this.value);
          });
          slugEl && slugEl.addEventListener('input', function () { autoMode = false; });
          autoBtn && autoBtn.addEventListener('click', function () {
            autoMode = true;
            slugEl.value = slugify(titleEl.value);
          });

          bunnyBtn && bunnyBtn.addEventListener('click', async function () {
            var videoId = bunnyIdEl.value.trim();
            if (!videoId) { bunnyStatus.textContent = 'Zadej nejdřív Bunny Video ID.'; bunnyStatus.className = 'text-xs mt-1 text-red-500'; bunnyStatus.classList.remove('hidden'); return; }
            bunnyBtn.textContent = 'Načítám…';
            bunnyBtn.disabled = true;
            bunnyStatus.classList.add('hidden');
            try {
              var res = await fetch('/admin/api/bunny/video/' + encodeURIComponent(videoId));
              var data = await res.json();
              if (!res.ok || data.error) {
                bunnyStatus.textContent = (data.error || 'Chyba') + (data.detail ? ': ' + data.detail : '');
                bunnyStatus.className = 'text-xs mt-1 text-red-500';
                bunnyStatus.classList.remove('hidden');
                bunnyBtn.textContent = 'Načíst z Bunny';
                bunnyBtn.disabled = false;
                return;
              }
              // Duration
              var mins = Math.floor((data.length || 0) / 60);
              var secs = (data.length || 0) % 60;
              document.querySelector('[name=durationMinutes]').value = mins;
              document.querySelector('[name=durationSecondsRem]').value = secs;
              // Title
              if (data.title && !titleEl.value) {
                titleEl.value = data.title;
                if (autoMode) slugEl.value = slugify(data.title);
              }
              // Chapters — replace existing rows
              chaptersList.innerHTML = '';
              (data.chapters || []).forEach(function(ch) { addChapterRow(ch.title, ch.start, ch.end); });
              // Moments — replace existing rows
              momentsList.innerHTML = '';
              (data.moments || []).forEach(function(mo) { addMomentRow(mo.label, mo.timestamp); });
              var info = mins + ':' + String(secs).padStart(2,'0');
              if (data.chapters && data.chapters.length) info += ' · ' + data.chapters.length + ' kapitol';
              if (data.moments && data.moments.length) info += ' · ' + data.moments.length + ' momentů';
              bunnyStatus.textContent = '✓ Načteno: ' + info;
              bunnyStatus.className = 'text-xs mt-1 text-green-600';
              bunnyStatus.classList.remove('hidden');
              bunnyBtn.textContent = '✓ Načteno';
            } catch(e) {
              bunnyStatus.textContent = 'Síťová chyba.';
              bunnyStatus.className = 'text-xs mt-1 text-red-500';
              bunnyStatus.classList.remove('hidden');
              bunnyBtn.textContent = 'Načíst z Bunny';
              bunnyBtn.disabled = false;
            }
          });
        })();
      ` }} />
      {isEdit && les && (
        <div class="mt-8 pt-6 border-t border-gray-200">
          <TranscribeSection lesson={les} />
        </div>
      )}
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

// ─── Settings form ────────────────────────────────────────────────

type DiscountSettingsView = {
  active: boolean;
  percent: number;
  limit: number;
  code: string;
  codeExpiresAt: Date | null;
  label: string;
};

export function AdminSettingsForm({
  priceIndividual,
  priceOrganization,
  benefitsIndividual,
  benefitsOrganization,
  discount,
  slotsUsed,
  saved,
}: {
  priceIndividual: number;
  priceOrganization: number;
  benefitsIndividual: string[];
  benefitsOrganization: string[];
  discount: DiscountSettingsView;
  slotsUsed: number;
  saved?: boolean;
}) {
  const codeExpiresOn = discount.codeExpiresAt
    ? discount.codeExpiresAt.toISOString().slice(0, 10)
    : "";
  const slotsLeft = Math.max(0, discount.limit - slotsUsed);
  const discountedIndividual = discount.percent > 0
    ? Math.floor((priceIndividual * (100 - discount.percent)) / 100)
    : priceIndividual;
  const discountedOrganization = discount.percent > 0
    ? Math.floor((priceOrganization * (100 - discount.percent)) / 100)
    : priceOrganization;
  return (
    <section class="max-w-3xl mx-auto px-4 py-8">
      <h1 class="text-2xl font-bold mb-6">Admin</h1>
      <AdminNav active="/admin/settings" />

      {saved && (
        <div class="mb-6 bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-lg text-sm">
          Nastavení uloženo.
        </div>
      )}

      <form method="post" class="space-y-8">
        {/* Ceny */}
        <div>
          <h2 class="text-lg font-semibold mb-4">Ceny předplatného (CZK/rok)</h2>
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Osobní předplatné</label>
              <div class="flex items-center gap-2">
                <input type="number" name="price_individual" value={String(priceIndividual)} min="0" step="100"
                  class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500" />
                <span class="text-gray-500 text-sm whitespace-nowrap">Kč</span>
              </div>
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Firemní licence</label>
              <div class="flex items-center gap-2">
                <input type="number" name="price_organization" value={String(priceOrganization)} min="0" step="100"
                  class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500" />
                <span class="text-gray-500 text-sm whitespace-nowrap">Kč</span>
              </div>
            </div>
          </div>
        </div>

        {/* Zaváděcí sleva */}
        <div class="rounded-lg border border-amber-200 bg-amber-50/40 p-4 space-y-3">
          <h2 class="text-lg font-semibold">Zaváděcí sleva</h2>
          <label
            class={`flex items-center gap-3 rounded-md border px-3 py-2 cursor-pointer ${
              discount.active
                ? "border-emerald-300 bg-emerald-50"
                : "border-gray-300 bg-white"
            }`}
          >
            <input
              type="checkbox"
              name="discount_active"
              checked={discount.active}
              class="h-4 w-4"
            />
            <span class="text-sm">
              <strong>Sleva je aktivní</strong>
              <span class="block text-xs text-gray-500">
                Bez zaškrtnutí nic nezobrazuje, i kdyby ostatní pole byla vyplněná.
              </span>
            </span>
          </label>
          <div class="grid grid-cols-2 gap-4">
            <label class="block">
              <span class="block text-sm font-medium text-gray-700 mb-1">Sleva</span>
              <div class="flex items-center gap-2">
                <input
                  type="number"
                  name="discount_percent"
                  value={String(discount.percent)}
                  min="0"
                  max="100"
                  class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
                <span class="text-gray-500 text-sm">%</span>
              </div>
            </label>
            <label class="block">
              <span class="block text-sm font-medium text-gray-700 mb-1">Limit slotů</span>
              <input
                type="number"
                name="discount_limit"
                value={String(discount.limit)}
                min="0"
                class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
            </label>
          </div>
          <label class="block">
            <span class="block text-sm font-medium text-gray-700 mb-1">Popisek (badge)</span>
            <input
              type="text"
              name="discount_label"
              value={discount.label}
              placeholder="Zaváděcí sleva"
              class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
          </label>
          <div class="grid grid-cols-2 gap-4">
            <label class="block">
              <span class="block text-sm font-medium text-gray-700 mb-1">Promo kód (volitelný)</span>
              <input
                type="text"
                name="discount_code"
                value={discount.code}
                placeholder="prázdné = bez kódu"
                class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono uppercase"
              />
            </label>
            <label class="block">
              <span class="block text-sm font-medium text-gray-700 mb-1">Kód platí do</span>
              <input
                type="date"
                name="discount_code_expires_on"
                value={codeExpiresOn}
                class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
            </label>
          </div>
          <div class="rounded border border-amber-300 bg-white p-3 text-xs space-y-1">
            <div>
              <strong>Využito:</strong> {slotsUsed} / {discount.limit} slotů
              {slotsLeft > 0 ? (
                <span class="text-emerald-700"> · zbývá {slotsLeft}</span>
              ) : (
                <span class="text-red-700"> · vyčerpáno</span>
              )}
            </div>
            {discount.percent > 0 && (
              <div class="text-gray-600">
                Zlevněné ceny: individual {discountedIndividual.toLocaleString("cs-CZ")} Kč
                (z {priceIndividual.toLocaleString("cs-CZ")}), organization{" "}
                {discountedOrganization.toLocaleString("cs-CZ")} Kč
                (z {priceOrganization.toLocaleString("cs-CZ")}).
              </div>
            )}
            <div class="text-gray-500">
              Po vyčerpání slotů sleva platí jen pro lidi s promo kódem (pokud je nastavený a nevypršel).
            </div>
          </div>
        </div>

        {/* Výhody - jednotlivec */}
        <div>
          <div class="flex items-center justify-between mb-3">
            <h2 class="text-lg font-semibold">Výhody — osobní předplatné</h2>
            <button type="button" id="add-benefit-ind" class="text-xs text-indigo-500 hover:text-indigo-700">+ Přidat</button>
          </div>
          <div id="benefits-ind-list" class="space-y-2">
            {benefitsIndividual.map((b, i) => (
              <div class="benefit-ind-row flex gap-2">
                <input type="text" name={`benefit_ind_${i}`} value={b}
                  class="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500" />
                <button type="button" class="remove-row text-gray-400 hover:text-red-500 text-lg px-1">✕</button>
              </div>
            ))}
          </div>
          <input type="hidden" name="benefits_individual" id="benefits-ind-json" value={JSON.stringify(benefitsIndividual)} />
        </div>

        {/* Výhody - firma */}
        <div>
          <div class="flex items-center justify-between mb-3">
            <h2 class="text-lg font-semibold">Výhody — firemní licence</h2>
            <button type="button" id="add-benefit-org" class="text-xs text-indigo-500 hover:text-indigo-700">+ Přidat</button>
          </div>
          <div id="benefits-org-list" class="space-y-2">
            {benefitsOrganization.map((b, i) => (
              <div class="benefit-org-row flex gap-2">
                <input type="text" name={`benefit_org_${i}`} value={b}
                  class="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500" />
                <button type="button" class="remove-row text-gray-400 hover:text-red-500 text-lg px-1">✕</button>
              </div>
            ))}
          </div>
          <input type="hidden" name="benefits_organization" id="benefits-org-json" value={JSON.stringify(benefitsOrganization)} />
        </div>

        <div class="pt-2">
          <button type="submit" class="bg-indigo-600 text-white px-6 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700">
            Uložit nastavení
          </button>
        </div>
      </form>

      <script dangerouslySetInnerHTML={{ __html: `
        (function() {
          function makeRow(listId, rowClass, jsonId, serialize) {
            var list = document.getElementById(listId);
            var json = document.getElementById(jsonId);
            function ser() {
              var rows = list.querySelectorAll('.' + rowClass);
              var vals = [];
              rows.forEach(function(r){ var inp = r.querySelector('input[type=text]'); if(inp) vals.push(inp.value); });
              json.value = JSON.stringify(vals);
            }
            list.querySelectorAll('.remove-row').forEach(function(btn){
              btn.addEventListener('click', function(){ btn.closest('.' + rowClass).remove(); ser(); });
            });
            list.querySelectorAll('input').forEach(function(el){ el.addEventListener('input', ser); });
            return function addRow(val) {
              var div = document.createElement('div');
              div.className = rowClass + ' flex gap-2';
              div.innerHTML = '<input type="text" class="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500" value="' + (val||'').replace(/"/g,'&quot;') + '"><button type="button" class="remove-row text-gray-400 hover:text-red-500 text-lg px-1">✕</button>';
              div.querySelector('.remove-row').addEventListener('click', function(){ div.remove(); ser(); });
              div.querySelector('input').addEventListener('input', ser);
              list.appendChild(div);
              ser();
            };
          }
          var addInd = makeRow('benefits-ind-list', 'benefit-ind-row', 'benefits-ind-json');
          var addOrg = makeRow('benefits-org-list', 'benefit-org-row', 'benefits-org-json');
          document.getElementById('add-benefit-ind').addEventListener('click', function(){ addInd(''); });
          document.getElementById('add-benefit-org').addEventListener('click', function(){ addOrg(''); });
        })();
      ` }} />
    </section>
  );
}
