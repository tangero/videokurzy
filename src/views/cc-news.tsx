import type { FC } from "hono/jsx";
import { Layout } from "./layout";
import { fmtDate } from "../lib/dates";
import type { TopicTrends } from "../lib/cc-news/trends";
import { CcSectionNav } from "./cc-section-nav";
import type { ToolWeekCard } from "../lib/cc-news/ecosystem";

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
  /** Hlavní body českého článku (`summary_points`), nejvýš tři. */
  points?: string[];
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
const fmtPp = (x: number) => `${x > 0 ? "+" : x < 0 ? "−" : "±"}${Math.abs(x).toLocaleString("cs-CZ", { maximumFractionDigits: 1, minimumFractionDigits: 1 })} p. b.`;

/** Text s `inline kódem` z markdownu: liché úseky mezi backticky jako <code>, zbytek jako text. */
const InlineCode: FC<{ text: string }> = ({ text }) => (
  <>{text.split("`").map((part, i) => (i % 2 === 1 ? <code>{part}</code> : part))}</>
);

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

/** Dvě dlaždice pod nadpisem: kam míří vývoj Claude Code a co dělají ostatní nástroje. */
const HubTiles: FC<{ trends?: TopicTrends | null; ecosystem?: ToolWeekCard[] }> = ({ trends, ecosystem }) => {
  const t = trends && trends.total > 0 ? trends : null;
  const rising = t?.rising.slice(0, 3) ?? [];
  const top = t ? [...t.topics].sort((x, y) => y.share - x.share).filter((x) => x.share > 0).slice(0, 3) : [];
  const names = (ecosystem ?? []).map((c) => c.name);
  return (
    <div class="cc-tiles">
      <a class="cc-tile" href="/novinky-cc/temata">
        <span class="cc-tile-h">Kam teď míří vývoj Claude Code <span aria-hidden="true">→</span></span>
        <span class="cc-tile-text">
          {rising.length > 0 ? (
            <>Roste: {rising.map((r, i) => <>{i > 0 && ", "}{r.label} <span class="cc-num cc-up">{fmtPp(r.delta)}</span></>)}</>
          ) : top.length > 0 ? (
            <>Nejvíc změn: {top.map((r, i) => <>{i > 0 && ", "}{r.label} <span class="cc-num">{fmtPct(r.share)}</span></>)}</>
          ) : (
            "Témata změn v changelogu za poslední 4 týdny a jak se mění."
          )}
        </span>
      </a>
      <a class="cc-tile" href="/novinky-cc/ekosystem">
        <span class="cc-tile-h">Mapa vývojářských nástrojů <span aria-hidden="true">→</span></span>
        <span class="cc-tile-text">
          {names.length > 0
            ? `Co se tento týden změnilo v ${names.join(", ")} a čemu se věnují vedle Claude Code.`
            : "Claude Code vedle dalších agentů pro programování: týden, témata a dohánění."}
        </span>
      </a>
    </div>
  );
};

/** Pondělí týdne po vydání (vydání vychází v pondělí za minulý týden). */
export function nextIssueDate(publishedAt: number): number {
  const d = new Date(publishedAt);
  const sinceMonday = (d.getUTCDay() + 6) % 7;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - sinceMonday + 7);
}

/** Ostatní nástroje tento týden: jedna věta na nástroj, odkaz na mapu ekosystému. */
const EcosystemStrip: FC<{ cards: ToolWeekCard[] }> = ({ cards }) => (
  <section class="cc-eco" aria-labelledby="cc-eco-h">
    <h2 id="cc-eco-h" class="cc-section-h">Ostatní nástroje tento týden</h2>
    <ul class="cc-eco-list">
      {cards.map((card) => (
        <li class={`cu-${card.tool}`}>
          <a class="cc-eco-name" href={`/novinky-cc/ekosystem#${card.tool}`}>
            <span class="cu-key" aria-hidden="true" />
            {card.name}
          </a>
          <span class="cc-eco-text" lang={card.pending ? "en" : undefined}>
            {card.points[0] ? <InlineCode text={card.points[0]} /> : <span class="cc-muted">Za poslední čtyři týdny žádné novinky.</span>}
          </span>
        </li>
      ))}
    </ul>
    <p class="cc-eco-links">
      <a href="/novinky-cc/ekosystem">Mapa vývojářských nástrojů →</a>
      <a href="/novinky-cc/dohanani">Kdo koho dohání →</a>
    </p>
  </section>
);

/**
 * Seznam publikovaných vydání „Novinky v Claude Code" v designu serveru.
 * Gated (řeší routa), takže Layout vždy dostane přihlášeného uživatele.
 * Pořadí: lišta podsekcí a dlaždice → aktuální vydání → ostatní nástroje → archiv → materiály.
 */
export const CcNewsListPage: FC<{
  user: LayoutUser;
  items: CcNewsListItem[];
  trends?: TopicTrends | null;
  ecosystem?: ToolWeekCard[];
}> = ({ user, items, trends, ecosystem }) => {
  const [latest, ...archive] = items;
  return (
  <Layout title="Novinky v Claude Code" user={user} noindex>
    <section class="container-narrow" style="padding: 8px 0 32px">
      <h1>Novinky v Claude Code</h1>
      <p style="color: var(--muted); margin-bottom: 20px">
        Týdenní přehled novinek z Claude Code pro platící uživatele.
      </p>
      <CcSectionNav current="vydani" />
      <HubTiles trends={trends} ecosystem={ecosystem} />

      {!latest ? (
        <p style="color: var(--muted)">Zatím žádný publikovaný článek.</p>
      ) : (
        <>
          <h2 class="cc-section-h">Aktuální vydání</h2>
          {/* Opožděné vydání: datum v minulosti by mátlo, raději nic. */}
          {latest.publishedAt && nextIssueDate(latest.publishedAt) + 86_400_000 > Date.now() && (
            <p class="cc-meta cc-next">
              Další vydání v pondělí {fmtDate(nextIssueDate(latest.publishedAt), { month: "long", fallback: "" })}
            </p>
          )}
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
                {latest.points && latest.points.length > 0 && (
                  <ul class="cc-features">
                    {latest.points.map((p) => (
                      <li>
                        <InlineCode text={p} />
                      </li>
                    ))}
                  </ul>
                )}
                {latest.versionRange && <div class="cc-meta" style="margin-top: 10px">{latest.versionRange}</div>}
              </a>
              {latest.topics && <TopicChips topics={latest.topics} />}
            </li>
          </ul>

          {ecosystem && ecosystem.length > 0 && <EcosystemStrip cards={ecosystem} />}

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

// Přehled témat žije v cc-topics.tsx; re-export kvůli dosavadním importům.
export { CcTopicsPage, type CcTopicSummary } from "./cc-topics";
