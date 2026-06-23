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
        Týdenní přehled novinek z Claude Code pro platící uživatele.
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
