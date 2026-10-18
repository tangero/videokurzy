import type { FC } from "hono/jsx";
import { Layout } from "./layout";
import { cheatSheetUrl } from "../lib/cc-news/taxonomy";
import type { SiteArticle } from "../lib/cc-news/site-articles";
import { fmtDate } from "../lib/dates";
import { docsLink, termMentions, weekOf, type HistoryItem, type Phase, type Term, type TermKind, type ToolHistory, type WeekDetail } from "../lib/cc-news/topic-history";

type LayoutUser = { name: string | null; email: string } | null;

const MONTHS = ["led", "úno", "bře", "dub", "kvě", "čvn", "čvc", "srp", "zář", "říj", "lis", "pro"];
const PHASE_LABEL: Record<Phase, string> = {
  peak: "Teď nejaktivnější období v historii tématu",
  rising: "Teď zrychluje",
  steady: "Vyvíjí se běžným tempem",
  quiet: "Teď zpomalilo",
  dormant: "Delší dobu beze změn",
};

const fmt1 = (x: number) => x.toLocaleString("cs-CZ", { maximumFractionDigits: 1 });
const day = (ms: number) => fmtDate(ms, { month: "long", fallback: "" });
const dayShort = (ms: number) => new Date(ms).toLocaleDateString("cs-CZ", { day: "numeric", month: "numeric", timeZone: "UTC" });
const anchor = (id: string) => `z-${id.replace(/[^a-zA-Z0-9]/g, "-")}`;

/** Týdenní osa tématu: sloupec = týden, výška = počet změn, tečka = zásadní změna. */
export const TopicTimeline: FC<{ history: ToolHistory; selected: string | null; topicKey: string; marked?: Set<string> }> = ({ history, selected, topicKey, marked }) => {
  // Odmocninové měřítko: jinak špičky posledních týdnů (tempo vydávání roste) zploští celou historii.
  const max = Math.sqrt(Math.max(1, ...history.weeks.map((w) => w.added + w.fixed)));
  let lastLabel = -99;
  return (
    <div class="tl" style={`--n:${history.weeks.length}`} role="list" aria-label={`Změny v tématu po týdnech, ${history.name}`}>
      {history.weeks.map((w, i) => {
        const n = w.added + w.fixed;
        const d = new Date(w.start);
        const prev = history.weeks[i - 1];
        const newMonth = (!prev || new Date(prev.start).getUTCMonth() !== d.getUTCMonth()) && i - lastLabel >= 4;
        if (newMonth) lastLabel = i;
        const label = newMonth ? `${MONTHS[d.getUTCMonth()]}${d.getUTCMonth() === 0 || i === 0 ? ` ${String(d.getUTCFullYear()).slice(2)}` : ""}` : "";
        const title = `Týden od ${dayShort(w.start)}: ${n ? `${w.added} nových, ${w.fixed} oprav${w.major ? `, ${w.major} zásadní` : ""}` : "bez změn"}`;
        const body = (
          <>
            <span class="tl-dot">{w.major > 0 ? "●" : ""}</span>
            <span class="tl-col">
              <span class="tl-fix" style={`height:${n ? ((100 * Math.sqrt(n) * w.fixed) / n / max).toFixed(1) : 0}%`} />
              <span class="tl-new" style={`height:${n ? ((100 * Math.sqrt(n) * w.added) / n / max).toFixed(1) : 0}%`} />
            </span>
            <span class="tl-axis">{label}</span>
          </>
        );
        return n ? (
          <a role="listitem" class={`tl-week${w.key === selected ? " is-selected" : ""}${marked?.has(w.key) ? " is-marked" : ""}`} href={`/novinky-cc/temata/${topicKey}?tyden=${w.key}#detail`} title={title} aria-label={title}>
            {body}
          </a>
        ) : (
          <span role="listitem" class="tl-week is-empty" title={title}>{body}</span>
        );
      })}
    </div>
  );
};

/** „1 změna / 3 změny / 5 změn“; desetinná čísla mají tvar „změny“. */
export function zmen(n: number): string {
  if (!Number.isInteger(n)) return "změny";
  return n === 1 ? "změna" : n >= 2 && n <= 4 ? "změny" : "změn";
}

/** Měsíční osa pro úzké displeje: týdny sečtené po měsících, klik na poslední aktivní týden měsíce. */
export const TopicTimelineMonthly: FC<{ history: ToolHistory; selected: string | null; topicKey: string }> = ({ history, selected, topicKey }) => {
  const months: { label: string; added: number; fixed: number; major: number; lastKey: string | null; keys: string[] }[] = [];
  for (const w of history.weeks) {
    const d = new Date(w.start);
    const label = `${MONTHS[d.getUTCMonth()]}${d.getUTCMonth() === 0 || !months.length ? ` ${String(d.getUTCFullYear()).slice(2)}` : ""}`;
    const id = `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
    let m = months[months.length - 1];
    if (!m || (m as unknown as { id: string }).id !== id) {
      m = Object.assign({ label, added: 0, fixed: 0, major: 0, lastKey: null, keys: [] }, { id });
      months.push(m);
    }
    m.added += w.added;
    m.fixed += w.fixed;
    m.major += w.major;
    m.keys.push(w.key);
    if (w.added + w.fixed) m.lastKey = w.key;
  }
  const max = Math.sqrt(Math.max(1, ...months.map((m) => m.added + m.fixed)));
  return (
    <div class="tlm" style={`--n:${months.length}`} role="list" aria-label={`Změny v tématu po měsících, ${history.name}`}>
      {months.map((m, i) => {
        const n = m.added + m.fixed;
        const h = (x: number) => (n ? ((100 * Math.sqrt(n) * x) / n / max).toFixed(1) : "0");
        const body = (
          <>
            <span class="tl-dot">{m.major > 0 ? "●" : ""}</span>
            <span class="tl-col">
              <span class="tl-fix" style={`height:${h(m.fixed)}%`} />
              <span class="tl-new" style={`height:${h(m.added)}%`} />
            </span>
            <span class="tl-axis">{i % 3 === 0 ? m.label : ""}</span>
          </>
        );
        const title = `${m.label}: ${n} ${zmen(n)}`;
        return m.lastKey ? (
          <a role="listitem" class={`tl-week${selected && m.keys.includes(selected) ? " is-selected" : ""}`} href={`/novinky-cc/temata/${topicKey}?tyden=${m.lastKey}#detail`} title={title} aria-label={title}>{body}</a>
        ) : (
          <span role="listitem" class="tl-week is-empty" title={title}>{body}</span>
        );
      })}
    </div>
  );
};

/** Detail pojmu: všechny zmínky v obou nástrojích chronologicky. */
export const TermDetailView: FC<{ term: string; items: HistoryItem[]; tools: ToolHistory[]; topicKey: string }> = ({ term, items, tools, topicKey }) => {
  const mentions = termMentions(items, term);
  const mainTool = tools[0]?.tool;
  return (
    <section id="detail" class="wk" aria-labelledby="td-h">
      <header class="wk-head">
        <h2 id="td-h"><code class="td-term">{term}</code></h2>
        <a class="wk-close" href={`/novinky-cc/temata/${topicKey}#detail`}>zavřít ×</a>
        <p class="td-sum">
          {tools.map((t) => {
            const own = mentions.filter((m) => m.tool === t.tool);
            return own.length ? <span><strong>{t.name}</strong> {own.length}× od {day(own[0]!.publishedAt)}</span> : <span><strong>{t.name}</strong> v changelogu nezmíněno</span>;
          })}
        </p>
      </header>
      <ol class="td-list">
        {mentions.map((m) => (
          <li class={`td-item td-${m.tool === mainTool ? "main" : "other"}${m.type === "Fixed" ? " td-fix" : ""}`}>
            <span class="td-when">{dayShort(m.publishedAt)} {new Date(m.publishedAt).getUTCFullYear()}</span>
            <span class="td-tool">{tools.find((t) => t.tool === m.tool)?.name} v{m.version}{m.type === "Fixed" ? <span class="td-kind">oprava</span> : null}</span>
            <div>
              <p class="wk-reason">
                {m.tool === mainTool ? <a href={`/novinky-cc/temata/${topicKey}?tyden=${weekKeyOf(m.publishedAt)}#${anchor(m.id)}`}>{m.reason ?? m.text}</a> : (m.reason ?? m.text)}
              </p>
              {m.reason && <p class="wk-orig">{m.text}</p>}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
};

const ItemRow: FC<{ item: HistoryItem; byId: Map<string, HistoryItem>; topicKey: string }> = ({ item, byId, topicKey }) => {
  const f = item.followsId ? byId.get(item.followsId) : undefined;
  return (
    <li id={anchor(item.id)} class="wk-item">
      <span class="wk-ver">v{item.version}</span>
      <div>
        {item.reason && <p class="wk-reason">{item.reason}</p>}
        <p class={item.reason ? "wk-orig" : "wk-reason"}>{item.text}</p>
        {f && (
          <p class="wk-follows">
            navazuje na <a href={`/novinky-cc/temata/${topicKey}?tyden=${weekKeyOf(f.publishedAt)}#${anchor(f.id)}`}>v{f.version}</a>
            {item.relation ? ` (${item.relation})` : ""}
            {item.followReason ? `: ${item.followReason}` : ""}
          </p>
        )}
      </div>
    </li>
  );
};

const weekKeyOf = (ms: number) => weekOf(ms).key;

/** Nejnovější článek z rubriky nástroje, kterému se stránka věnuje, na vibecoding.cz. */
export const SiteArticlesBox: FC<{ articles: SiteArticle[] }> = ({ articles }) =>
  articles.length ? (
    <aside class="art" aria-label="Nejnovější články na vibecoding.cz">
      <h3 class="wk-h3">Nejnovější na vibecoding.cz</h3>
      <ul>
        {articles.map((a) => (
          <li>
            <span class="art-tool">
              {a.rubricUrl ? <a href={a.rubricUrl} target="_blank" rel="noreferrer">{a.toolName}</a> : a.toolName}
            </span>
            <a class="art-title" href={a.url} target="_blank" rel="noreferrer">{a.title} ↗</a>
            {a.publishedAt && <span class="art-date">{day(a.publishedAt)}</span>}
          </li>
        ))}
      </ul>
    </aside>
  ) : null;

export const WeekDetailView: FC<{ detail: WeekDetail; byId: Map<string, HistoryItem>; topicKey: string; articles?: SiteArticle[] }> = ({ detail, byId, topicKey, articles = [] }) => (
  <section id="detail" class="wk" aria-labelledby="wk-h">
    <header class="wk-head">
      <h2 id="wk-h">
        Týden {parseInt(detail.key.slice(6), 10)} <span class="wk-dates">{dayShort(detail.start)}–{dayShort(detail.start + 6 * 86_400_000)} {new Date(detail.start).getUTCFullYear()}</span>
      </h2>
      <span class="wk-range">
        {detail.versions.length > 1 ? `v${detail.versions[0]}–v${detail.versions[detail.versions.length - 1]}` : `v${detail.versions[0]}`}
      </span>
      <nav class="wk-nav" aria-label="Další týdny se změnou">
        {detail.prevKey ? <a href={`/novinky-cc/temata/${topicKey}?tyden=${detail.prevKey}#detail`}>← předchozí</a> : <span />}
        {detail.nextKey ? <a href={`/novinky-cc/temata/${topicKey}?tyden=${detail.nextKey}#detail`}>další →</a> : <span />}
      </nav>
    </header>
    {detail.major.length > 0 && (
      <>
        <h3 class="wk-h3">Zásadní</h3>
        <ul class="wk-list">{detail.major.map((i) => <ItemRow item={i} byId={byId} topicKey={topicKey} />)}</ul>
      </>
    )}
    {detail.added.length > 0 && (
      <>
        <h3 class="wk-h3">Nové a změněné ({detail.added.length})</h3>
        <ul class="wk-list">{detail.added.map((i) => <ItemRow item={i} byId={byId} topicKey={topicKey} />)}</ul>
      </>
    )}
    <SiteArticlesBox articles={articles} />
    {detail.fixed.length > 0 && (
      <details class="wk-fixes">
        <summary>Opravy ({detail.fixed.length})</summary>
        <ul class="wk-list">{detail.fixed.map((i) => <ItemRow item={i} byId={byId} topicKey={topicKey} />)}</ul>
      </details>
    )}
  </section>
);

const MONTHS_LONG = ["leden", "únor", "březen", "duben", "květen", "červen", "červenec", "srpen", "září", "říjen", "listopad", "prosinec"];

export const Milestones: FC<{ history: ToolHistory; topicKey: string }> = ({ history, topicKey }) => {
  const byMonth = new Map<string, typeof history.milestones>();
  for (const m of [...history.milestones].reverse()) {
    const d = new Date(m.publishedAt);
    const k = `${MONTHS_LONG[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
    byMonth.set(k, [...(byMonth.get(k) ?? []), m]);
  }
  return (
    <section class="ms" aria-labelledby="ms-h">
      <h2 id="ms-h" class="th-h2">Milníky</h2>
      <p class="th-sub">Zásadní změny tématu v {history.name}, nejnovější nahoře.</p>
      <ol class="ms-list">
        {[...byMonth.entries()].map(([month, ms]) => (
          <li class="ms-month">
            <span class="ms-label">{month}</span>
            <ul>
              {ms.map((m) => (
                <li>
                  <a href={`/novinky-cc/temata/${topicKey}?tyden=${m.weekKey}#${anchor(m.id)}`}>{m.title}</a>
                  <span class="ms-ver">v{m.version}</span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </section>
  );
};

const KIND_LABEL: Record<TermKind, string> = {
  event: "Události",
  key: "Nastavení a pole",
  dotted: "Hooky modů a pluginů",
  command: "Příkazy",
  env: "Proměnné prostředí",
};

/** Slovník tématu: identifikátory z changelogu a kolikrát a odkdy se objevují u každého nástroje. */
export const TermsView: FC<{ terms: Term[]; tools: ToolHistory[]; topicKey: string; recentFrom: number }> = ({ terms, tools, topicKey, recentFrom }) => {
  const total = (t: Term) => Object.values(t.uses).reduce((s, u) => s + (u?.count ?? 0), 0);
  const kinds = (["event", "key", "dotted", "command", "env"] as TermKind[])
    .map((k) => ({ k, list: terms.filter((t) => t.kind === k && (total(t) >= 2 || Object.keys(t.uses).length > 1)).sort((a, b) => total(b) - total(a)).slice(0, 14) }))
    .filter((g) => g.list.length);
  if (!kinds.length) return null;
  return (
    <section class="tv" aria-labelledby="tv-h">
      <h2 id="tv-h" class="th-h2">Slovník tématu</h2>
      <p class="th-sub">
        Názvy, které se v changelogu objevují nejčastěji. Číslo = počet zmínek, datum = první zmínka v changelogu
        (funkce mohla existovat dřív). Kliknutím na název uvidíte, jak se vyvíjel.
      </p>
      {kinds.map(({ k, list }) => (
        <div class="tv-group">
          <h3 class="wk-h3">{KIND_LABEL[k]}</h3>
          <table class="tv-table">
            <colgroup><col class="tv-c1" />{tools.map(() => <col />)}</colgroup>
            <thead>
              <tr>
                <th scope="col">Název</th>
                {tools.map((t) => <th scope="col">{t.name}</th>)}
              </tr>
            </thead>
            <tbody>
              {list.map((t) => (
                <tr>
                  <th scope="row">
                    <a href={`/novinky-cc/temata/${topicKey}?pojem=${encodeURIComponent(t.term)}#detail`}><code>{t.term}</code></a>
                    {Math.min(...Object.values(t.uses).map((u) => u!.first)) >= recentFrom && <span class="tv-new">nové</span>}
                  </th>
                  {tools.map((tool) => {
                    const u = t.uses[tool.tool];
                    return <td>{u ? <><span class="tv-n">{u.count}×</span> <span class="tv-first">od {dayShort(u.first)}{new Date(u.first).getUTCFullYear() !== 2026 ? ` ${new Date(u.first).getUTCFullYear()}` : ""}</span></> : <span class="tv-none">—</span>}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </section>
  );
};

/** Srovnání nástrojů na společném období: podíl tématu na všech změnách nástroje po týdnech. */
export const CompareView: FC<{ tools: ToolHistory[]; terms: Term[]; topicKey: string }> = ({ tools, terms, topicKey }) => {
  const present = tools.filter((t) => t.total > 0);
  if (present.length < 2) return null;
  const from = Math.max(...present.map((t) => t.weeks[0]!.start));
  const series = present.map((t) => ({ t, weeks: t.weeks.filter((w) => w.start >= from) }));
  const max = Math.max(1, ...series.flatMap((s) => s.weeks.map((w) => w.share ?? 0)));
  const overall = series.map(({ t, weeks }) => {
    const n = weeks.reduce((s, w) => s + w.added + w.fixed, 0);
    const all = weeks.reduce((s, w) => s + (w.toolTotal ?? 0), 0);
    return { name: t.name, share: all ? (100 * n) / all : 0 };
  });
  const pctTxt = (x: number) => `${x.toLocaleString("cs-CZ", { maximumFractionDigits: 1 })} %`;
  const weeksAxis = series[0]!.weeks;
  const majors = series.map(({ t, weeks }) => ({ name: t.name, n: weeks.reduce((s, w) => s + w.added + w.fixed, 0), major: weeks.reduce((s, w) => s + w.major, 0) }));
  const [a, b] = overall;
  // Pro dva nástroje poměr slovy, pro víc jen výčet podílů.
  const lead = overall.length === 2 && a && b && a.share > 0 ? b.share / a.share : 0;
  return (
    <section class="cmp" aria-labelledby="cmp-h">
      <h2 id="cmp-h" class="th-h2">Srovnání nástrojů</h2>
      <p class="th-sub">
        Od týdne {day(from)}, odkdy sledujeme všechny nástroje. Výška sloupce = podíl tématu na všech změnách daného nástroje v týdnu,
        takže srovnání nezkresluje, že každý nástroj vydává jinak často.
      </p>
      <p class="cmp-take">
        Podíl tématu na změnách: {overall.map((o, i) => `${i ? ", " : ""}${o.name} ${pctTxt(o.share)}`).join("")}
        {lead > 0 && (lead >= 1.2 ? ` (${b!.name} ${fmt1(lead)}× víc)` : lead <= 0.83 ? ` (${b!.name} ${fmt1(1 / lead)}× méně)` : " (zhruba stejně)")}.{" "}
        Zásadních změn: {majors.map((m, i) => `${i ? ", " : ""}${m.name} ${m.major} z ${m.n} (${pctTxt(m.n ? (100 * m.major) / m.n : 0)})`).join("")}.
      </p>
      {series.map(({ t, weeks }) => {
        const n = weeks.reduce((s, w) => s + w.added + w.fixed, 0);
        const major = weeks.reduce((s, w) => s + w.major, 0);
        return (
          <div class="cmp-row">
            <div class="cmp-name">
              <strong>{t.name}</strong>
              <span>{n} změn · {major} zásadních</span>
            </div>
            <div class="cmp-bars" style={`--n:${weeks.length}`}>
              {weeks.map((w) => (
                <span class="cmp-bar" title={`Týden od ${dayShort(w.start)}: ${w.share !== null ? w.share.toFixed(1) : "0"} % změn`}>
                  <span style={`height:${(((w.share ?? 0) / max) * 100).toFixed(1)}%`} />
                </span>
              ))}
            </div>
          </div>
        );
      })}
      <div class="cmp-row cmp-axis-row" aria-hidden="true">
        <span />
        <div class="cmp-axis" style={`--n:${weeksAxis.length}`}>
          {weeksAxis.map((w, i) => {
            const d = new Date(w.start);
            const prev = weeksAxis[i - 1];
            return <span>{!prev || new Date(prev.start).getUTCMonth() !== d.getUTCMonth() ? MONTHS[d.getUTCMonth()] : ""}</span>;
          })}
        </div>
      </div>
      {(() => {
        const events = terms.filter((t) => t.kind === "event");
        const keys = series.map(({ t }) => t.tool);
        const all = events.filter((t) => keys.every((k) => t.uses[k]));
        // U hlavního nástroje jen pojmy zmíněné aspoň dvakrát (jinak šum z jednorázových zmínek).
        const only = series.map(({ t }, i) => ({
          name: t.name,
          list: events.filter((x) => x.uses[t.tool] && keys.every((k) => k === t.tool || !x.uses[k]) && (i > 0 || (x.uses[t.tool]?.count ?? 0) >= 2)),
        }));
        const link = (t: Term) => <a href={`/novinky-cc/temata/${topicKey}?pojem=${encodeURIComponent(t.term)}#detail`}><code>{t.term}</code></a>;
        const list = (xs: Term[]) => xs.map((t, i) => <>{i ? ", " : ""}{link(t)}</>);
        return all.length + only.reduce((s, o) => s + o.list.length, 0) > 0 ? (
          <dl class="cmp-terms">
            {all.length > 0 && <><dt>{keys.length === 2 ? "Zmíněno u obou" : "Zmíněno u všech"}</dt><dd>{list(all)}</dd></>}
            {only.filter((o) => o.list.length).map((o) => <><dt>Jen {o.name}</dt><dd>{list(o.list)}</dd></>)}
            <dd class="cmp-note">
              Podle zmínek v changelogu: {series.map(({ t }, i) => `${i ? ", " : ""}u ${t.name} od ${day(t.since!)}`).join("")}. Nástroj může funkci
              mít, i když ji changelog nezmínil.
            </dd>
          </dl>
        ) : null;
      })()}
    </section>
  );
};

export interface TopicHistoryPageProps {
  user: LayoutUser;
  topic: { key: string; label: string; about: string };
  main: ToolHistory;
  others: ToolHistory[];
  terms: Term[];
  detail: WeekDetail | null;
  /** Vybraný pojem ze slovníku (?pojem=); má přednost před detailem týdne. */
  term?: string | null;
  /** Nejnovější článek rubriky hlavního nástroje na vibecoding.cz (box v detailu týdne). */
  articles?: SiteArticle[];
  items: HistoryItem[];
}


/** Úvodní věta ze dat: tempo posledních 4 týdnů proti průměru tématu. */
function lede(h: ToolHistory): string {
  if (!h.since) return "";
  const ratio = h.avgPerWeek > 0 ? h.recentPerWeek / h.avgPerWeek : 0;
  const r = Math.round(h.recentPerWeek * 10) / 10;
  const base = `Za poslední 4 týdny ${fmt1(r)} ${zmen(r)} týdně, dlouhodobý průměr je ${fmt1(h.avgPerWeek)}`;
  return ratio >= 1.5 ? `${base}, tedy ${fmt1(ratio)}× víc.` : ratio <= 0.5 && ratio > 0 ? `${base}, tedy méně než polovina.` : `${base}.`;
}

export const TopicHistoryPage: FC<TopicHistoryPageProps> = ({ user, topic, main, others, terms, detail, term, items, articles = [] }) => {
  const byId = new Map(items.map((i) => [i.id, i]));
  const tools = [main, ...others];
  const docs = docsLink(items, main.tool);
  const recentFrom = main.weeks[Math.max(0, main.weeks.length - 5)]?.start ?? 0;
  const marked = term ? new Set(termMentions(items, term).filter((m) => m.tool === main.tool).map((m) => weekKeyOf(m.publishedAt))) : undefined;
  return (
    <Layout title={`${topic.label} — vývoj v Claude Code`} user={user} noindex>
      <article class="container-narrow th" style="padding: 8px 0 48px">
        <a href="/novinky-cc/temata" class="cc-news-back">← Všechna témata</a>
        <header class="th-head">
          <h1>{topic.label}</h1>
          <p class="th-about">{topic.about}</p>
          {main.since && (
            <p class="th-facts">
              <span>od {day(main.since)}</span>
              <span>{main.majorCount} milníků</span>
              <span>{main.total} změn</span>
              <strong>{PHASE_LABEL[main.phase]}</strong>
            </p>
          )}
          {main.since && <p class="th-lede">{lede(main)}</p>}
          <p class="th-docs">
            <a href={cheatSheetUrl(topic.key)} target="_blank" rel="noreferrer">Tahák Claude Code česky ↗</a>
            {docs && (
              <a href={docs} target="_blank" rel="noreferrer" hreflang="en">Oficiální dokumentace (anglicky) ↗</a>
            )}
          </p>
        </header>

        {main.weeks.length > 0 && (
          <section class="th-tl" aria-label="Časová osa">
            <div class="tl-desk"><TopicTimeline history={main} selected={term ? null : detail?.key ?? null} topicKey={topic.key} marked={marked} /></div>
            <div class="tl-mob"><TopicTimelineMonthly history={main} selected={term ? null : detail?.key ?? null} topicKey={topic.key} /></div>
            <p class="th-legend">
              <span><i class="cc-key cc-key-new" /> nové a změněné</span>
              <span><i class="cc-key cc-key-fix" /> opravy</span>
              <span>● zásadní změna</span>
              {marked ? <span>▲ týdny se zmínkou o <code>{term}</code></span> : <span>Klikněte na týden pro detail.</span>}
            </p>
          </section>
        )}

        {term ? <TermDetailView term={term} items={items} tools={tools} topicKey={topic.key} /> : detail && <WeekDetailView detail={detail} byId={byId} topicKey={topic.key} articles={articles} />}
        <CompareView tools={tools} terms={terms} topicKey={topic.key} />
        <TermsView terms={terms} tools={tools} topicKey={topic.key} recentFrom={recentFrom} />
        {main.milestones.length > 0 && <Milestones history={main} topicKey={topic.key} />}
      </article>
    </Layout>
  );
};

