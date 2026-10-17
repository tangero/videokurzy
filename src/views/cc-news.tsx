import type { FC } from "hono/jsx";
import { Layout } from "./layout";
import { fmtDate } from "../lib/dates";

type LayoutUser = { name: string | null; email: string } | null;

/** Jedno vydání v seznamu (odlehčený model — bez markdownu těla). */
export interface CcNewsListItem {
  slug: string;
  /** Skutečný český nadpis z front matteru (fallback weekLabel). */
  title: string;
  /** Perex z front matteru (post_excerpt), může chybět. */
  excerpt: string | null;
  versionRange: string | null;
  publishedAt: number | null; // epoch ms
}

/**
 * Doplňkové materiály ke Claude Code (externí, na vibecoding.cz). Statický
 * seznam — odkazy dodal majitel webu, ne dynamický obsah. PDF/cheat-sheet se
 * otevírají v nové záložce.
 */
const RESOURCES: Array<{ href: string; title: string; kind: string }> = [
  {
    href: "https://www.vibecoding.cz/cheat-sheet/claude-code?lang=cs",
    title: "Cheat sheet — Claude Code",
    kind: "Webová stránka",
  },
  {
    href: "https://www.vibecoding.cz/download/claude-code-tahak.pdf",
    title: "Tahák pro začátečníky v Claude Code",
    kind: "PDF",
  },
  {
    href: "https://www.vibecoding.cz/download/claude-code-pro-zacatecniky.pdf",
    title: "Claude Code pro začátečníky (prezentace)",
    kind: "PDF",
  },
];

/**
 * Seznam publikovaných vydání „Novinky v Claude Code" v designu serveru.
 * Gated (řeší routa), takže Layout vždy dostane přihlášeného uživatele.
 */
export const CcNewsListPage: FC<{ user: LayoutUser; items: CcNewsListItem[] }> = ({
  user,
  items,
}) => (
  <Layout title="Novinky v Claude Code" user={user} noindex>
    <section class="container-narrow" style="padding: 8px 0 32px">
      <h1>Novinky v Claude Code</h1>
      <p style="color: var(--muted); margin-bottom: 28px">
        Týdenní přehled novinek z Claude Code pro platící uživatele.{" "}
        <a href="/novinky-cc/temata">Vývoj jednotlivých témat →</a>
      </p>

      {items.length === 0 ? (
        <p style="color: var(--muted)">Zatím žádný publikovaný článek.</p>
      ) : (
        <ul class="cc-news-list">
          {items.map((it) => (
            <li>
              <a
                href={`/novinky-cc/${encodeURIComponent(it.slug)}`}
                class="card cc-news-card"
                style="display: block; text-decoration: none; color: inherit"
              >
                <div style="display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap">
                  <span style="font-weight: 600; font-size: 1.05rem">{it.title}</span>
                  {it.publishedAt && (
                    <span style="font-family: var(--font-mono); font-size: 0.78rem; color: var(--muted); white-space: nowrap">
                      {fmtDate(it.publishedAt, { month: "long", fallback: "" })}
                    </span>
                  )}
                </div>
                {it.excerpt && (
                  <p style="color: var(--muted); font-size: 0.92rem; line-height: 1.55; margin: 8px 0 0">
                    {it.excerpt}
                  </p>
                )}
                {it.versionRange && (
                  <div style="font-family: var(--font-mono); font-size: 0.78rem; color: var(--muted); margin-top: 8px">
                    {it.versionRange}
                  </div>
                )}
              </a>
            </li>
          ))}
        </ul>
      )}

      <h2 style="margin-top: 40px">Materiály ke stažení</h2>
      <p style="color: var(--muted); margin-bottom: 16px">
        Doplňkové materiály ke Claude Code na vibecoding.cz.
      </p>
      <ul class="cc-news-list">
        {RESOURCES.map((r) => (
          <li>
            <a
              href={r.href}
              target="_blank"
              rel="noreferrer"
              class="card cc-news-card"
              style="display: block; text-decoration: none; color: inherit"
            >
              <div style="display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap">
                <span style="font-weight: 600; font-size: 1rem">{r.title}</span>
                <span style="font-size: 0.75rem; color: var(--muted); white-space: nowrap">
                  {r.kind} ↗
                </span>
              </div>
            </a>
          </li>
        ))}
      </ul>
    </section>
  </Layout>
);

/**
 * Detail jednoho vydání — článek v designu serveru. `articleHtml` je už
 * vyrenderovaný (renderMarkdown), který escapuje raw HTML a omezuje odkazy na
 * http/https/relativní, proto je vložení přes dangerouslySetInnerHTML bezpečné.
 */
export const CcNewsArticlePage: FC<{
  user: LayoutUser;
  title: string;
  articleHtml: string;
}> = ({ user, title, articleHtml }) => (
  <Layout title={title} user={user} noindex>
    <article class="container-narrow" style="padding: 8px 0 40px">
      <a
        href="/novinky-cc"
        class="cc-news-back"
        style="font-family: var(--font-mono); font-size: 0.82rem; color: var(--muted)"
      >
        ← všechna vydání
      </a>
      {/* Skutečný nadpis z front matteru — vždy jeden h1 (nezávisí na markdownu). */}
      <h1 style="margin: 16px 0 8px">{title}</h1>
      <div
        class="lesson-body"
        dangerouslySetInnerHTML={{ __html: articleHtml }}
      />
    </article>
  </Layout>
);

// ─── Vývoj témat (Novinky v CC, fáze 2) ────────────────────────────

export interface CcTopicSummary {
  key: string;
  label: string;
  description: string;
  count: number;        // významné změny (2–3)
  lastAt: number | null; // epoch ms poslední významné změny
}

export interface CcTopicEntry {
  id: string;
  version: string;
  publishedAt: number;
  significance: number;
  text: string;
  reason: string | null;
  follows: { id: string; version: string; relation: string | null; reason: string | null } | null;
}

/** Přehled témat changelogu s počtem významných změn. */
export const CcTopicsPage: FC<{ user: LayoutUser; topics: CcTopicSummary[] }> = ({ user, topics }) => (
  <Layout title="Vývoj témat — Novinky v Claude Code" user={user} noindex>
    <section class="container-narrow" style="padding: 8px 0 32px">
      <p><a href="/novinky-cc">← Novinky v Claude Code</a></p>
      <h1>Vývoj témat v Claude Code</h1>
      <p style="color: var(--muted); margin-bottom: 28px">
        Významné změny z changelogu Claude Code roztříděné podle oblastí, od dubna 2025. U každé
        změny vidíte, na kterou dřívější navazuje.
      </p>
      <ul class="cc-news-list">
        {topics.map((t) => (
          <li>
            <a href={`/novinky-cc/temata/${encodeURIComponent(t.key)}`} class="card cc-news-card" style="display: block; text-decoration: none; color: inherit">
              <div style="display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap">
                <span style="font-weight: 600; font-size: 1.05rem">{t.label}</span>
                <span style="font-family: var(--font-mono); font-size: 0.78rem; color: var(--muted)">
                  {t.count} změn{t.lastAt ? ` · naposledy ${fmtDate(t.lastAt, { month: "long", fallback: "" })}` : ""}
                </span>
              </div>
              <p style="color: var(--muted); font-size: 0.92rem; margin: 8px 0 0">{t.description}</p>
            </a>
          </li>
        ))}
      </ul>
    </section>
  </Layout>
);

const SIG_LABEL: Record<number, string> = { 3: "zásadní", 2: "významná" };

/** Časová osa jednoho tématu (nejnovější nahoře) s vazbami „navazuje na". */
export const CcTopicPage: FC<{ user: LayoutUser; topic: CcTopicSummary; entries: CcTopicEntry[] }> = ({ user, topic, entries }) => (
  <Layout title={`${topic.label} — vývoj v Claude Code`} user={user} noindex>
    <section class="container-narrow" style="padding: 8px 0 32px">
      <p><a href="/novinky-cc/temata">← Všechna témata</a></p>
      <h1>{topic.label}</h1>
      <p style="color: var(--muted); margin-bottom: 28px">{topic.description} · {entries.length} významných změn</p>
      <ol style="list-style: none; padding: 0; margin: 0">
        {entries.map((e) => (
          <li id={`z-${e.id.replace(/[^a-zA-Z0-9]/g, "-")}`} style="padding: 14px 0; border-bottom: 1px solid var(--border)">
            <div style="font-family: var(--font-mono); font-size: 0.78rem; color: var(--muted)">
              v{e.version} · {fmtDate(e.publishedAt, { month: "long", fallback: "" })} · {SIG_LABEL[e.significance] ?? ""}
            </div>
            <div style="margin-top: 4px">{e.text}</div>
            {e.follows && (
              <div style="font-size: 0.88rem; color: var(--muted); margin-top: 4px">
                navazuje na{" "}
                <a href={`#z-${e.follows.id.replace(/[^a-zA-Z0-9]/g, "-")}`}>v{e.follows.version}</a>
                {e.follows.relation ? ` (${e.follows.relation})` : ""}
                {e.follows.reason ? `: ${e.follows.reason}` : ""}
              </div>
            )}
          </li>
        ))}
      </ol>
    </section>
  </Layout>
);
