import type { FC } from "hono/jsx";
import { Layout } from "./layout";

// Veřejná stránka placené epizody pro nepřihlášené. Hlavně kvůli sdílení
// odkazu /watch/:slug na Facebook/X — crawler není přihlášený a dřív dostal
// redirect na ceník, takže náhled ukazoval homepage. Obsah (video, markdown)
// zůstává za paywallem; tady je jen název, krátký popis a náhled.

interface WatchPublicProps {
  lesson: {
    title: string;
    slug: string;
    durationSeconds: number;
    moduleId: number;
    moduleTitle?: string;
  };
  description: string;
  ogUrl: string;
  ogImage?: string;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export const WatchPublicPage: FC<WatchPublicProps> = ({ lesson, description, ogUrl, ogImage }) => {
  const moduleNum = String(lesson.moduleId).padStart(2, "0");

  return (
    <Layout
      title={lesson.title}
      description={description}
      ogUrl={ogUrl}
      ogImage={ogImage}
      ogType="video.other"
      user={null}
    >
      <div class="container" style="padding-top:20px;max-width:880px">
        <div class="video-wrap">
          {ogImage ? (
            <img
              src={ogImage}
              alt=""
              style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;filter:brightness(0.55)"
            />
          ) : null}
          <div
            style={`position:absolute;inset:0;${ogImage ? "" : "background:linear-gradient(135deg,#0f1412 0%,#1a2620 100%);"}display:flex;flex-direction:column;justify-content:center;align-items:center;gap:14px;padding:28px;color:#fff;text-align:center`}
          >
            <div style="font-family:var(--font-mono);font-size:0.8rem;letter-spacing:0.05em;color:rgba(207,233,220,0.9)">
              // epizoda pro předplatitele
            </div>
            <a class="btn" href="/#cenik">odemknout kurz</a>
          </div>
        </div>

        <div style="margin-top:24px">
          <div class="hstack" style="margin-bottom:8px;gap:8px">
            <span class="pill">modul {moduleNum}</span>
            {lesson.moduleTitle && <span class="mono muted">{lesson.moduleTitle}</span>}
            {lesson.durationSeconds > 0 && (
              <span class="mono muted">{formatDuration(lesson.durationSeconds)}</span>
            )}
          </div>
          <h1 style="margin:0 0 12px">{lesson.title}</h1>
          <p class="muted" style="max-width:68ch">{description}</p>
          <div class="hstack" style="gap:12px;margin-top:20px;flex-wrap:wrap">
            <a class="btn" href="/#cenik">získat přístup</a>
            <a class="btn btn-ghost" href="/login">už mám přístup — přihlásit se</a>
          </div>
        </div>
      </div>
    </Layout>
  );
};
