import type { FC } from "hono/jsx";
import { Layout } from "./layout";
import { fmtDate } from "../lib/dates";
import { TREND_THRESHOLD_PP, type TopicTrend, type TopicTrends } from "../lib/cc-news/trends";

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
  /** Témata hlavních novinek z výběru týdne (jen vydání ze changelogu). */
  topics?: { key: string; label: string }[];
  /** Hlavní novinky z výběru týdne, nejvýš tři. */
  features?: { title: string; lede: string }[];
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

const fmtPct = (x: number) => `${x.toLocaleString("cs-CZ", { maximumFractionDigits: 1, minimumFractionDigits: 1 })} %`;
const fmtPp = (x: number) => `${x > 0 ? "+" : x < 0 ? "−" : "±"}${Math.abs(x).toLocaleString("cs-CZ", { maximumFractionDigits: 1, minimumFractionDigits: 1 })} b.`;
const ARROW: Record<TopicTrend["direction"], string> = { up: "↑", down: "↓", flat: "→" };
const ARROW_LABEL: Record<TopicTrend["direction"], string> = { up: "roste", down: "klesá", flat: "beze změny" };

const TopicChips: FC<{ topics: { key: string; label: string }[] }> = ({ topics }) =>
  topics.length ? (
    <ul class="cc-chips" aria-label="Témata">
      {topics.map((t) => (
        <li>
          <a class="cc-chip" href={`/novinky-cc/temata/${encodeURIComponent(t.key)}`}>{t.label}</a>
        </li>
      ))}
    </ul>
  ) : null;

/** Kam teď míří vývoj: rostoucí témata a podíl všech témat za poslední 4 týdny. */
const TrendsPanel: FC<{ trends: TopicTrends }> = ({ trends }) => {
  const max = Math.max(...trends.topics.map((t) => t.share), 1);
  const toIncl = trends.to - 86_400_000;
  return (
    <section class="cc-trends" aria-labelledby="cc-trends-h">
      <h2 id="cc-trends-h">Kam teď míří vývoj</h2>
      <p class="cc-trends-note">
        Podíl témat na {trends.total} změnách v changelogu za poslední 4 týdny
        ({fmtDate(trends.from, { month: "long", fallback: "" })} až {fmtDate(toIncl, { month: "long", fallback: "" })})
        proti předchozím 13 týdnům.
      </p>

      {trends.rising.length > 0 && (
        <ol class="cc-rising">
          {trends.rising.map((t) => (
            <li>
              <a href={`/novinky-cc/temata/${encodeURIComponent(t.key)}`} class="cc-rising-title">{t.label}</a>
              <span class="cc-num">{fmtPct(t.share)} <span class="cc-up">{fmtPp(t.delta)}</span></span>
              {(t.highlight || t.major > 0) && (
                <p>
                  {t.highlight && (
                    <>
                      <span class="cc-muted">Naposledy: </span>
                      {t.highlight}
                    </>
                  )}
                  {t.major > 0 && (
                    <span class="cc-muted">{t.highlight ? " · " : ""}Zásadních změn za 4 týdny: {t.major}</span>
                  )}
                </p>
              )}
            </li>
          ))}
        </ol>
      )}

      <div class="cc-bars" role="table" aria-label="Podíl témat za poslední 4 týdny">
        <div class="cc-bars-legend" aria-hidden="true">
          <span><i class="cc-key cc-key-new" /> nové funkce a změny</span>
          <span><i class="cc-key cc-key-fix" /> opravy</span>
        </div>
        {trends.topics.filter((t) => t.added + t.fixed > 0).map((t) => {
          const n = t.added + t.fixed;
          const w = (100 * t.share) / max;
          return (
            <div class="cc-bar-row" role="row">
              <a role="rowheader" class="cc-bar-label" href={`/novinky-cc/temata/${encodeURIComponent(t.key)}`}>{t.label}</a>
              <div class="cc-bar-track" role="cell" aria-label={`${t.added} nových, ${t.fixed} oprav`}>
                <span class="cc-bar cc-bar-new" style={`width:${((w * t.added) / n).toFixed(2)}%`} />
                <span class="cc-bar cc-bar-fix" style={`width:${((w * t.fixed) / n).toFixed(2)}%`} />
              </div>
              <span role="cell" class="cc-num cc-bar-val">
                {fmtPct(t.share)}{" "}
                <span class={`cc-${t.direction}`} title={`${ARROW_LABEL[t.direction]} (${fmtPp(t.delta)})`}>
                  {ARROW[t.direction]}
                  <span class="sr-only"> {ARROW_LABEL[t.direction]}</span>
                </span>
              </span>
            </div>
          );
        })}
      </div>
      <p class="cc-trends-note">
        Témata změnám přiřazuje jazykový model, takže jednotlivé položky mohou být zařazené nepřesně.
        Šipka ukazuje změnu podílu o víc než {TREND_THRESHOLD_PP.toLocaleString("cs-CZ")} procentního bodu.{" "}
        <a href="/novinky-cc/temata">Vývoj jednotlivých témat →</a>
      </p>
    </section>
  );
};

/**
 * Seznam publikovaných vydání „Novinky v Claude Code" v designu serveru.
 * Gated (řeší routa), takže Layout vždy dostane přihlášeného uživatele.
 * Pořadí: trendy → aktuální vydání → archiv → materiály.
 */
export const CcNewsListPage: FC<{ user: LayoutUser; items: CcNewsListItem[]; trends?: TopicTrends | null }> = ({
  user,
  items,
  trends,
}) => {
  const [latest, ...archive] = items;
  return (
  <Layout title="Novinky v Claude Code" user={user} noindex>
    <section class="container-narrow" style="padding: 8px 0 32px">
      <h1>Novinky v Claude Code</h1>
      <p style="color: var(--muted); margin-bottom: 28px">
        Týdenní přehled novinek z Claude Code pro platící uživatele.{" "}
        <a href="/novinky-cc/temata">Vývoj jednotlivých témat →</a>
      </p>

      {trends && trends.total > 0 && <TrendsPanel trends={trends} />}

      {!latest ? (
        <p style="color: var(--muted)">Zatím žádný publikovaný článek.</p>
      ) : (
        <>
          <h2 class="cc-section-h">Aktuální vydání</h2>
          <ul class="cc-news-list">
            <li>
              <a
                href={`/novinky-cc/${encodeURIComponent(latest.slug)}`}
                class="card cc-news-card cc-news-latest"
                style="display: block; text-decoration: none; color: inherit"
              >
                <div style="display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap">
                  <span class="cc-latest-title">{latest.title}</span>
                  {latest.publishedAt && (
                    <span class="cc-meta">{fmtDate(latest.publishedAt, { month: "long", fallback: "" })}</span>
                  )}
                </div>
                {latest.excerpt && <p class="cc-excerpt">{latest.excerpt}</p>}
                {latest.features && latest.features.length > 0 && (
                  <ul class="cc-features">
                    {latest.features.map((f) => (
                      <li>
                        <strong>{f.title}</strong>
                        {f.lede ? ` ${f.lede}` : ""}
                      </li>
                    ))}
                  </ul>
                )}
                {latest.versionRange && <div class="cc-meta" style="margin-top: 10px">{latest.versionRange}</div>}
              </a>
              {latest.topics && <TopicChips topics={latest.topics} />}
            </li>
          </ul>

          {archive.length > 0 && (
            <>
              <h2 class="cc-section-h">Starší vydání</h2>
              <ul class="cc-archive">
                {archive.map((it) => (
                  <li>
                    <a href={`/novinky-cc/${encodeURIComponent(it.slug)}`} class="cc-archive-link">
                      <span class="cc-archive-title">{it.title}</span>
                      <span class="cc-meta">
                        {it.publishedAt ? fmtDate(it.publishedAt, { month: "long", fallback: "" }) : ""}
                        {it.versionRange ? ` · ${it.versionRange}` : ""}
                      </span>
                    </a>
                    {it.topics && <TopicChips topics={it.topics} />}
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
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
};

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
  /** Podíl na změnách za poslední 4 týdny (%) a směr proti čtvrtletí; bez trendů chybí. */
  share?: number;
  direction?: TopicTrend["direction"];
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
        Významné změny z changelogu Claude Code roztříděné podle oblastí, od dubna 2025. Témata jsou
        seřazená podle podílu na změnách za poslední 4 týdny. U každé změny vidíte, na kterou dřívější navazuje.
      </p>
      <ul class="cc-news-list">
        {topics.map((t) => (
          <li>
            <a href={`/novinky-cc/temata/${encodeURIComponent(t.key)}`} class="card cc-news-card" style="display: block; text-decoration: none; color: inherit">
              <div style="display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap">
                <span style="font-weight: 600; font-size: 1.05rem">{t.label}</span>
                <span style="font-family: var(--font-mono); font-size: 0.78rem; color: var(--muted)">
                  {t.share !== undefined && (
                    <>
                      {fmtPct(t.share)} za 4 týdny{" "}
                      <span class={`cc-${t.direction ?? "flat"}`}>{ARROW[t.direction ?? "flat"]}</span> ·{" "}
                    </>
                  )}
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
