import type { FC } from "hono/jsx";
import { Layout } from "./layout";

// Sdílené vyhledávání lekcí: formulář + výsledky. Používá dashboard (/dashboard?q=),
// veřejná stránka /hledat a formulář v osnově na úvodní stránce.

export interface SearchResultItem {
  id: number;
  title: string;
  slug: string;
  durationSeconds: number;
  isFree: boolean;
  completed: boolean;
  moduleTitle: string;
  matchedIn: "title" | "body";
}

export interface LessonSearchState {
  query: string;
  results: SearchResultItem[];
}

// 1 epizoda, 2–4 epizody, 0 / 5+ epizod
function pluralEpisodes(n: number): string {
  if (n === 1) return "1 epizoda";
  if (n >= 2 && n <= 4) return `${n} epizody`;
  return `${n} epizod`;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const CheckIcon = () => (
  <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const LockIcon = () => (
  <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <rect x="4" y="11" width="16" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>
);

const CircleIcon = () => (
  <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
    <circle cx="12" cy="12" r="9" />
  </svg>
);

/** GET formulář — funguje i bez JS. `action` určuje, kam se hledá (/dashboard vs /hledat). */
export const LessonSearchForm: FC<{ action: string; query?: string }> = ({ action, query }) => (
  <form method="get" action={action} role="search" class="lesson-search">
    <label for="lesson-search-q" class="sr-only">Hledat v epizodách</label>
    <input
      id="lesson-search-q"
      type="search"
      name="q"
      value={query ?? ""}
      placeholder="Hledat v epizodách…"
      maxlength={100}
      autocomplete="off"
    />
    <button type="submit" class="btn btn-sm">hledat</button>
    <style>{`
      .lesson-search { display: flex; gap: 8px; align-items: center; }
      .lesson-search input {
        flex: 1; min-width: 0; width: 240px; padding: 7px 12px;
        font: inherit; font-size: 0.92rem; color: inherit;
        background: var(--surface, transparent);
        border: 1px solid var(--border); border-radius: 8px;
      }
      .lesson-search input:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
      @media (max-width: 720px) { .lesson-search { width: 100%; } }
      .sr-only {
        position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
        overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
      }
    `}</style>
  </form>
);

/**
 * Seznam výsledků. `lockedHref` — kam vede zamčená lekce (veřejně na ceník);
 * bez něj se zamčená lekce vykreslí jako prostý text (dashboard).
 */
export const LessonSearchResults: FC<{
  search: LessonSearchState;
  hasPaidAccess: boolean;
  lessonNumber: (id: number) => number;
  resetHref: string;
  resetLabel: string;
  lockedHref?: string;
}> = ({ search, hasPaidAccess, lessonNumber, resetHref, resetLabel, lockedHref }) => (
  <div style="margin-bottom:40px">
    <p class="mono" style="font-size:0.82rem;color:var(--muted);margin:0 0 14px">
      {search.results.length === 0
        ? `Pro „${search.query}“ jsme nenašli žádnou epizodu.`
        : `„${search.query}“ — ${pluralEpisodes(search.results.length)}`}{" "}
      · <a href={resetHref}>{resetLabel}</a>
    </p>
    {search.results.length > 0 && (
      <div class="module">
        {search.results.map((l) => {
          const locked = !hasPaidAccess && !l.isFree;
          const href = locked ? lockedHref : `/watch/${l.slug}`;
          return (
            <div class={`lesson ${locked ? "locked" : ""}`}>
              <span class="lesson-num">{String(lessonNumber(l.id)).padStart(2, "0")}</span>
              <span class="lesson-icon">
                {locked ? (
                  <span style="color:var(--muted)">
                    <LockIcon />
                  </span>
                ) : l.completed ? (
                  <span style="color:var(--accent)">
                    <CheckIcon />
                  </span>
                ) : (
                  <span style="color:var(--muted)">
                    <CircleIcon />
                  </span>
                )}
              </span>
              <div class="lesson-title">
                {href ? <a href={href}>{l.title}</a> : l.title}
                <span class="mono" style="display:block;font-size:0.72rem;color:var(--muted);margin-top:2px">
                  {l.moduleTitle}
                  {l.matchedIn === "body" ? " · shoda v popisu" : ""}
                </span>
              </div>
              <span class="lesson-duration">{formatDuration(l.durationSeconds)}</span>
            </div>
          );
        })}
      </div>
    )}
  </div>
);

/** Veřejná stránka /hledat — pro nepřihlášené i přihlášené. */
export const LessonSearchPage: FC<{
  user: { name: string | null; email: string } | null;
  search: LessonSearchState | null;
  hasPaidAccess: boolean;
  lessonNumbers: Record<number, number>;
}> = ({ user, search, hasPaidAccess, lessonNumbers }) => {
  const hasLocked = search?.results.some((l) => !hasPaidAccess && !l.isFree) ?? false;
  return (
    <Layout title="Hledat v epizodách" user={user} noindex>
      <div class="container" style="padding:28px 0 40px">
        <div class="section-header" style="flex-wrap:wrap;align-items:flex-end">
          <div>
            <div class="kicker">hledání</div>
            <h2 style="font-family:var(--font-head);font-size:1.5rem;font-weight:600;margin:0">
              {search ? "Výsledky hledání" : "Hledat v epizodách"}
            </h2>
          </div>
          <LessonSearchForm action="/hledat" query={search?.query} />
        </div>
        {search ? (
          <LessonSearchResults
            search={search}
            hasPaidAccess={hasPaidAccess}
            lessonNumber={(id) => lessonNumbers[id] ?? 0}
            resetHref="/#obsah"
            resetLabel="celý obsah kurzu"
            lockedHref="/#cenik"
          />
        ) : (
          <p style="color:var(--muted)">
            Zadej, co hledáš — prohledáme názvy i popisy všech epizod.
          </p>
        )}
        {hasLocked && (
          <div class="banner-upgrade">
            <div style="flex:1;min-width:240px">
              <h4>Některé nalezené epizody jsou pod&nbsp;zámkem.</h4>
              <p>Po odemknutí získáš přístup ke všem epizodám kurzu.</p>
            </div>
            <a class="btn" href="/#cenik">odemknout vše</a>
          </div>
        )}
      </div>
    </Layout>
  );
};
