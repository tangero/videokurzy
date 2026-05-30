import type { FC } from "hono/jsx";
import { renderMarkdown } from "../lib/markdown";
import { Layout } from "./layout";

interface SidebarLesson {
  id: number;
  title: string;
  slug: string;
  durationSeconds: number;
  isFree: boolean;
  completed: boolean;
  moduleId: number;
  globalIndex: number;
}

interface LessonChapter {
  title: string;
  start: number;
  end: number;
}

interface WatchProps {
  user: { name: string | null; email: string };
  lesson: {
    id: number;
    title: string;
    slug: string;
    durationSeconds: number;
    moduleId: number;
    moduleTitle?: string;
  };
  chapters: LessonChapter[];
  bodyMarkdown?: string | null;
  embedUrl: string;
  completed: boolean;
  prevSlug: string | null;
  nextSlug: string | null;
  hasPaidAccess: boolean;
  loggedIn: boolean;
  isLastFreeLesson?: boolean;
  nearbyLessons?: SidebarLesson[];
  lessonGlobalIndex?: number;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const ArrowLeftIcon = () => (
  <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <line x1="19" y1="12" x2="5" y2="12" />
    <polyline points="12 19 5 12 12 5" />
  </svg>
);

const ArrowIcon = () => (
  <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <line x1="5" y1="12" x2="19" y2="12" />
    <polyline points="12 5 19 12 12 19" />
  </svg>
);

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

export const WatchPage: FC<WatchProps> = ({
  user,
  lesson,
  chapters,
  bodyMarkdown,
  embedUrl,
  completed,
  prevSlug,
  nextSlug,
  hasPaidAccess,
  isLastFreeLesson,
  nearbyLessons,
  lessonGlobalIndex,
}) => {
  const idx = lessonGlobalIndex ?? 0;
  const moduleNum = String(lesson.moduleId).padStart(2, "0");
  const lessonNum = String(idx + 1).padStart(2, "0");
  const bodyHtml = renderMarkdown(bodyMarkdown);

  return (
    <Layout title={lesson.title} user={user}>
      <div class="container" style="padding-top:20px">
        <a class="btn btn-ghost btn-sm" href="/dashboard" style="margin-bottom:18px;display:inline-flex">
          <ArrowLeftIcon /> zpět na dashboard
        </a>

        <div
          style={`display:grid;grid-template-columns:${chapters.length > 0 ? "minmax(0,1fr) 320px" : "1fr"};gap:28px;align-items:start`}
          class="watch-grid"
        >
          {/* Main column */}
          <div>
            {/* Video */}
            <div class="video-wrap">
              {embedUrl ? (
                <iframe
                  id="lesson-video-player"
                  src={embedUrl}
                  loading="lazy"
                  allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture;"
                  allowfullscreen
                ></iframe>
              ) : (
                <div
                  style="position:absolute;inset:0;background:radial-gradient(circle at 30% 40%,rgba(47,122,91,0.25),transparent 55%),radial-gradient(circle at 70% 65%,rgba(244,195,112,0.12),transparent 50%),linear-gradient(135deg,#0f1412 0%,#1a2620 100%);display:flex;flex-direction:column;justify-content:flex-end;padding:28px;color:#cfe9dc"
                >
                  <div
                    style="font-family:var(--font-mono);font-size:0.75rem;color:rgba(207,233,220,0.75);letter-spacing:0.05em"
                  >
                    // modul {moduleNum} · epizoda {lessonNum}
                  </div>
                  <div
                    style="font-family:var(--font-head);font-size:1.4rem;font-weight:600;color:#fff;margin-top:6px;max-width:80%"
                  >
                    {lesson.title}
                  </div>
                </div>
              )}
            </div>

            {/* Lesson info */}
            <div style="margin-top:24px">
              <div class="hstack" style="margin-bottom:8px;gap:8px">
                <span class="pill">modul {moduleNum}</span>
                {lesson.moduleTitle && (
                  <span class="mono muted">{lesson.moduleTitle}</span>
                )}
              </div>
              <h1
                style="font-family:var(--font-head);font-size:clamp(1.5rem,2.5vw,2rem);font-weight:700;letter-spacing:-0.02em;margin:0 0 8px"
              >
                {lesson.title}
              </h1>
              <p style="color:var(--muted);font-size:1.02rem;margin:0">
                {formatDuration(lesson.durationSeconds)}
              </p>
              {bodyHtml && (
                <div
                  class="lesson-body"
                  dangerouslySetInnerHTML={{ __html: bodyHtml }}
                />
              )}
            </div>

            {/* Controls */}
            <div
              class="hstack"
              style="gap:12px;margin-top:20px;padding-top:20px;border-top:1px solid var(--border);flex-wrap:wrap;align-items:center;justify-content:space-between"
            >
              <div class="hstack" style="gap:10px">
                {prevSlug && (
                  <a class="btn btn-ghost btn-sm" href={`/watch/${prevSlug}`}>
                    <ArrowLeftIcon /> předchozí
                  </a>
                )}
                {nextSlug && (
                  <a class="btn btn-ghost btn-sm" href={`/watch/${nextSlug}`}>
                    další <ArrowIcon />
                  </a>
                )}
              </div>

              <div id={`progress-${lesson.id}`}>
                {completed ? (
                  <span
                    style="display:inline-flex;align-items:center;gap:6px;font-family:var(--font-mono);font-size:0.82rem;color:var(--accent-2)"
                  >
                    <span class="check-pop">
                      <CheckIcon />
                    </span>{" "}
                    dokončeno
                  </span>
                ) : (
                  <button
                    hx-post={`/api/progress/${lesson.id}`}
                    hx-target={`#progress-${lesson.id}`}
                    hx-swap="outerHTML"
                    class="btn btn-sm"
                  >
                    <CheckIcon /> označit jako dokončené
                  </button>
                )}
              </div>
            </div>

            {nearbyLessons && nearbyLessons.length > 0 && (
              <section class="next-lessons-panel" aria-labelledby="next-lessons-title">
                <div
                  class="mono"
                  style="font-size:0.7rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:10px"
                >
                  // epizody
                </div>
                <h2 id="next-lessons-title">Další epizody</h2>
                <div class="next-lessons-list">
                  {nearbyLessons.map((l) => {
                    const locked = !hasPaidAccess && !l.isFree;
                    const current = l.id === lesson.id;
                    return (
                      <div class={`lesson ${locked ? "locked" : ""} ${current ? "current" : ""}`}>
                        <span class="lesson-num">
                          {String(l.globalIndex + 1).padStart(2, "0")}
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
                          ) : current ? (
                            <span style="color:var(--accent-2)">
                              <PlaySmIcon />
                            </span>
                          ) : (
                            <span style="color:var(--muted)">
                              <CircleIcon />
                            </span>
                          )}
                        </span>
                        <div class="lesson-title">
                          {locked || current ? (
                            l.title
                          ) : (
                            <a href={`/watch/${l.slug}`}>{l.title}</a>
                          )}
                          <span class="lesson-sub">
                            {formatDuration(l.durationSeconds)}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {!hasPaidAccess && (
                  <a class="btn btn-block btn-sm" href="/#cenik" style="margin-top:14px">
                    odemknout vše
                  </a>
                )}
              </section>
            )}

            {/* Upgrade banner for free users watching last free lesson */}
            {isLastFreeLesson && !hasPaidAccess && (
              <div class="banner-upgrade" style="margin-top:28px">
                <div style="flex:1;min-width:240px">
                  <h4>Tohle byla poslední bezplatná epizoda.</h4>
                  <p>
                    Za 3&nbsp;000&nbsp;Kč/rok odemkneš zbývajících 7 epizod a všechny budoucí
                    kurzy.
                  </p>
                </div>
                <a class="btn" href="/#cenik">
                  pokračovat v kurzu{" "}
                  <span class="arrow">
                    <ArrowIcon />
                  </span>
                </a>
              </div>
            )}
          </div>

          {/* Sidebar */}
          {chapters.length > 0 && (
            <aside class="chapter-panel chapter-sidebar" aria-labelledby="chapter-panel-title">
              <div class="chapter-panel-head">
                <div>
                  <div class="mono chapter-eyebrow">// kapitoly</div>
                  <h2 id="chapter-panel-title">Obsah epizody</h2>
                </div>
                <span class="chapter-count">{chapters.length}</span>
              </div>
              <div class="chapter-list">
                {chapters.map((chapter, index) => (
                  <button
                    type="button"
                    class="chapter-item"
                    data-chapter-start={String(chapter.start)}
                    data-chapter-end={String(chapter.end)}
                  >
                    <span class="chapter-index">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span class="chapter-main">
                      <span class="chapter-title">{chapter.title}</span>
                      <span class="chapter-time">
                        {formatDuration(chapter.start)}
                        {chapter.end > chapter.start ? ` - ${formatDuration(chapter.end)}` : ""}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </aside>
          )}
        </div>
      </div>

      <style>{`
        @media (max-width: 900px) {
          .watch-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
      {embedUrl && chapters.length > 0 && (
        <>
          <script src="https://assets.mediadelivery.net/playerjs/playerjs-latest.min.js"></script>
          <script dangerouslySetInnerHTML={{ __html: `
            (function () {
              var iframe = document.getElementById('lesson-video-player');
              var buttons = Array.prototype.slice.call(document.querySelectorAll('.chapter-item'));
              if (!iframe || !buttons.length || !window.playerjs) return;

              var player = new window.playerjs.Player(iframe);

              function setActive(seconds) {
                var active = null;
                buttons.forEach(function (button) {
                  var start = parseInt(button.getAttribute('data-chapter-start') || '0', 10);
                  var end = parseInt(button.getAttribute('data-chapter-end') || '0', 10);
                  if (seconds >= start && (!end || seconds <= end)) active = button;
                  button.classList.remove('is-active');
                  button.removeAttribute('aria-current');
                });
                if (active) {
                  active.classList.add('is-active');
                  active.setAttribute('aria-current', 'true');
                }
              }

              buttons.forEach(function (button) {
                button.addEventListener('click', function () {
                  var start = parseInt(button.getAttribute('data-chapter-start') || '0', 10);
                  player.setCurrentTime(start);
                  player.play();
                  setActive(start);
                });
              });

              player.on('timeupdate', function (event) {
                var data = event && event.data ? event.data : event;
                var seconds = data && typeof data.seconds === 'number' ? data.seconds : 0;
                setActive(seconds);
              });

              player.on('ready', function () {
                player.getCurrentTime(function (seconds) {
                  setActive(typeof seconds === 'number' ? seconds : 0);
                });
              });
            })();
          ` }} />
        </>
      )}
    </Layout>
  );
};

export const ProgressComplete: FC<{ lessonId: number }> = ({ lessonId }) => (
  <div id={`progress-${lessonId}`}>
    <span
      style="display:inline-flex;align-items:center;gap:6px;font-family:var(--font-mono);font-size:0.82rem;color:var(--accent-2)"
    >
      <span class="check-pop">
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </span>{" "}
      dokončeno
    </span>
  </div>
);
