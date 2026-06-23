import type { FC } from "hono/jsx";
import { Layout } from "./layout";

type LayoutUser = { name: string | null; email: string } | null;

/** Jedno vydání v seznamu (odlehčený model — bez markdownu těla). */
export interface CcNewsListItem {
  slug: string;
  weekLabel: string;
  versionRange: string | null;
  publishedAt: number | null; // epoch ms
}

const fmtDate = (ms: number | null): string =>
  ms
    ? new Date(ms).toLocaleDateString("cs-CZ", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : "";

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
        <div style="display: grid; gap: 14px">
          {items.map((it) => (
            <a
              href={`/novinky-cc/${encodeURIComponent(it.slug)}`}
              class="card cc-news-card"
              style="display: block; text-decoration: none; color: inherit"
            >
              <div style="display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap">
                <span style="font-weight: 600; font-size: 1.05rem">{it.weekLabel}</span>
                {it.publishedAt && (
                  <span style="font-family: var(--font-mono); font-size: 0.78rem; color: var(--muted)">
                    {fmtDate(it.publishedAt)}
                  </span>
                )}
              </div>
              {it.versionRange && (
                <div style="font-family: var(--font-mono); font-size: 0.8rem; color: var(--muted); margin-top: 4px">
                  {it.versionRange}
                </div>
              )}
            </a>
          ))}
        </div>
      )}
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
      <div
        class="cc-news-article"
        style="margin-top: 16px"
        dangerouslySetInnerHTML={{ __html: articleHtml }}
      />
    </article>
  </Layout>
);
