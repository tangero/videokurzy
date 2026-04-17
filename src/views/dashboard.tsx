import type { FC } from "hono/jsx";
import { Layout } from "./layout";

interface LessonItem {
  id: number;
  publicId: string;
  title: string;
  slug: string;
  durationSeconds: number;
  isFree: boolean;
  completed: boolean;
}

interface ModuleItem {
  id: number;
  title: string;
  lessons: LessonItem[];
}

interface DashboardProps {
  user: { name: string | null; email: string };
  modules: ModuleItem[];
  completedCount: number;
  totalCount: number;
  hasPaidAccess: boolean;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatTotal(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
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

const PlaySmIcon = () => (
  <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
    <polygon points="6 4 20 12 6 20 6 4" />
  </svg>
);

const ArrowIcon = () => (
  <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <line x1="5" y1="12" x2="19" y2="12" />
    <polyline points="12 5 19 12 12 19" />
  </svg>
);

export const DashboardPage: FC<DashboardProps> = ({
  user,
  modules,
  completedCount,
  totalCount,
  hasPaidAccess,
}) => {
  const allLessons = modules.flatMap((m) => m.lessons);
  const nextLesson = allLessons.find((l) => !l.completed) ?? allLessons[0];
  const accessibleCount = hasPaidAccess ? totalCount : 3;
  const pct = accessibleCount > 0 ? Math.round((completedCount / accessibleCount) * 100) : 0;
  const totalDuration = allLessons.reduce((a, l) => a + l.durationSeconds, 0);

  return (
    <Layout title="Můj kurz" user={user}>
      <div class="container">
        {/* Hero banner */}
        <section
          style="display:grid;grid-template-columns:1.4fr 1fr;gap:28px;align-items:stretch;padding:28px 0"
          class="dashboard-hero"
        >
          <div>
            <div class="eyebrow">// {user.email}</div>
            <h1
              style="font-family:var(--font-head);font-size:clamp(1.8rem,3vw,2.5rem);font-weight:700;letter-spacing:-0.02em;margin:10px 0 10px"
            >
              Vítej zpátky.
            </h1>
            <p style="color:var(--muted);font-size:1.02rem;max-width:520px;margin:0 0 20px">
              {hasPaidAccess
                ? `Pokračuješ v kurzu. Dokoukáno ${completedCount} z ${totalCount} epizod.`
                : `Máš přístup k prvním 3 epizodám zdarma. Zhlédnuto ${completedCount} ze 3.`}
            </p>
            <div class="progress" style="max-width:520px;margin-bottom:18px">
              <span style={`width:${pct}%`}></span>
            </div>
            <div class="hstack" style="gap:10px;flex-wrap:wrap">
              {nextLesson && (
                <a class="btn btn-lg" href={`/watch/${nextLesson.slug}`}>
                  <PlaySmIcon />
                  {completedCount > 0 ? "pokračovat" : "začít"} — {nextLesson.title}
                </a>
              )}
              {!hasPaidAccess && (
                <a class="btn btn-ghost btn-lg" href="/#cenik">
                  odemknout vše za 3&nbsp;000&nbsp;Kč
                </a>
              )}
            </div>
          </div>
          <div
            class="card"
            style="display:grid;grid-template-columns:1fr 1fr;gap:14px;padding:22px;align-content:start"
          >
            <MiniStat
              label="status"
              value={hasPaidAccess ? "předplacené" : "free"}
              hint={hasPaidAccess ? "plný přístup" : "první 3 epizody"}
            />
            <MiniStat
              label="dokoukáno"
              value={`${completedCount}/${totalCount}`}
              hint={formatTotal(totalDuration)}
            />
            {nextLesson && (
              <MiniStat
                label="další epizoda"
                value={`#${String(allLessons.findIndex((l) => l.id === nextLesson.id) + 1).padStart(2, "0")}`}
                hint={formatDuration(nextLesson.durationSeconds)}
              />
            )}
            <MiniStat label="přístup" value={hasPaidAccess ? "roční" : "zdarma"} hint="magic link" />
          </div>
        </section>

        {/* Upgrade banner */}
        {!hasPaidAccess && (
          <div class="banner-upgrade" style="margin-bottom:36px">
            <div style="flex:1;min-width:240px">
              <h4>Zůstalo 7 epizod pod&nbsp;zámkem.</h4>
              <p>Modul 02 a 03 — design, databáze, deployment. Odemkne se za 3&nbsp;000&nbsp;Kč/rok.</p>
            </div>
            <a class="btn" href="/#cenik">
              koupit kurz{" "}
              <span class="arrow">
                <ArrowIcon />
              </span>
            </a>
          </div>
        )}

        {/* Module list */}
        <section>
          <div class="section-header">
            <div>
              <div class="kicker">osnova</div>
              <h2 style="font-family:var(--font-head);font-size:1.5rem;font-weight:600;margin:0">
                Všechny epizody
              </h2>
            </div>
          </div>
          <div class="module-list" style="margin-bottom:40px">
            {modules.map((m) => {
              const modDuration = m.lessons.reduce((a, l) => a + l.durationSeconds, 0);
              return (
                <div class="module">
                  <div class="module-head">
                    <div>
                      <div class="module-index">
                        modul {String(m.id).padStart(2, "0")}
                      </div>
                      <h3 class="module-title">{m.title}</h3>
                    </div>
                    <div class="module-meta">
                      {m.lessons.length} epizod · {formatTotal(modDuration)}
                    </div>
                  </div>
                  {m.lessons.map((l) => {
                    const locked = !hasPaidAccess && !l.isFree;
                    return (
                      <div class={`lesson ${locked ? "locked" : ""}`}>
                        <span class="lesson-num">
                          {String(allLessons.findIndex((al) => al.id === l.id) + 1).padStart(2, "0")}
                        </span>
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
                          {locked ? (
                            l.title
                          ) : (
                            <a href={`/watch/${l.slug}`}>{l.title}</a>
                          )}
                        </div>
                        <span class="lesson-duration">
                          {formatDuration(l.durationSeconds)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </section>
      </div>

      <style>{`
        @media (max-width: 720px) {
          .dashboard-hero { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </Layout>
  );
};

const MiniStat: FC<{ label: string; value: string; hint: string }> = ({
  label,
  value,
  hint,
}) => (
  <div>
    <div
      class="mono"
      style="font-size:0.7rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.08em"
    >
      {label}
    </div>
    <div
      style="font-family:var(--font-head);font-size:1.35rem;font-weight:700;letter-spacing:-0.01em;margin-top:4px"
    >
      {value}
    </div>
    <div class="mono" style="font-size:0.72rem;color:var(--muted);margin-top:4px">
      {hint}
    </div>
  </div>
);
