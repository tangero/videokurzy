import type { FC } from "hono/jsx";
import { Layout } from "./layout";
import { fmtDate } from "../lib/dates";
import { TREND_THRESHOLD_PP, type TopicTrend } from "../lib/cc-news/trends";
import { STRIP_WEEKS, type TopicOverview, type TopicsOverview, type ToolFocus } from "../lib/cc-news/topics-overview";
import { zmen } from "./cc-topic";
import { CatchupBlock } from "./cc-catchup";
import type { Catchup } from "../lib/cc-news/catchup";

type LayoutUser = { name: string | null; email: string } | null;

const WEEK = 7 * 86_400_000;
const num = (x: number) => x.toLocaleString("cs-CZ", { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const fmtPct = (x: number) => `${num(x)} %`;
const fmtPp = (x: number) => {
  const r = Math.round(x * 10) / 10;
  return `${r > 0 ? "+" : r < 0 ? "−" : "±"}${num(Math.abs(r))} b.`;
};
const day = (ms: number) => fmtDate(ms, { month: "long", fallback: "" });
const dayShort = (ms: number) => new Date(ms).toLocaleDateString("cs-CZ", { day: "numeric", month: "numeric", timeZone: "UTC" });
const href = (key: string) => `/novinky-cc/temata/${encodeURIComponent(key)}`;

/** Souhrn tématu bez trendů (záložní seznam, když výpočet přehledu selže). */
export interface CcTopicSummary {
  key: string;
  label: string;
  description: string;
  count: number;        // významné změny (2–3)
  lastAt: number | null; // epoch ms poslední významné změny
}

const BANDS: { dir: TopicTrend["direction"]; title: string; note: string }[] = [
  { dir: "up", title: "Roste", note: "podíl vzrostl o víc než {pp} b." },
  { dir: "flat", title: "Drží se", note: "podíl se změnil nejvýš o {pp} b." },
  { dir: "down", title: "Ustupuje", note: "podíl klesl o víc než {pp} b." },
];

/** Věta nahoře: kam šlo nejvíc změn, co nejvíc přidává a co ubírá. */
function headline(o: TopicsOverview): string {
  const [top] = o.topics;
  const up = o.topics.filter((t) => t.direction === "up").sort((a, b) => b.delta - a.delta).slice(0, 3);
  const down = o.topics.filter((t) => t.direction === "down").sort((a, b) => a.delta - b.delta)[0];
  const list = (ts: TopicOverview[]) => ts.map((t) => `${t.label} (${fmtPp(t.delta)})`).join(", ").replace(/, ([^,]*)$/, " a $1");
  let s = top ? `Nejvíc změn šlo do tématu ${top.label}: ${fmtPct(top.share)}.` : "";
  if (up.length) s += ` Nejvíc přidává ${list(up)}.`;
  if (down) s += ` Nejvíc ubírá ${down.label} (${fmtPp(down.delta)}).`;
  return s.trim();
}

/** Týdenní průběh podílu: sytost buňky = podíl tématu v týdnu, poslední 4 týdny orámované. */
const Strip: FC<{ t: TopicOverview; max: number; stripFrom: number; large?: boolean }> = ({ t, max, stripFrom, large }) => (
  <span class={`tp-strip${large ? " tp-strip-lg" : ""}`} role="img"
    aria-label={`Podíl tématu po týdnech, posledních 4: ${t.weeks.slice(-4).map((w) => (w === null ? "bez dat" : fmtPct(w))).join(", ")}`}>
    {t.weeks.map((w, i) => {
      const recent = i >= STRIP_WEEKS - 4;
      const title = `týden od ${dayShort(stripFrom + i * WEEK)}: ${w === null ? "bez zatříděných změn" : fmtPct(w)}`;
      return w === null
        ? <i class={`tp-cell tp-gap${recent ? " tp-recent" : ""}`} title={title} />
        : <i class={`tp-cell${recent ? " tp-recent" : ""}`} title={title} style={`--a:${Math.sqrt(Math.min(w / max, 1)).toFixed(3)}`} />;
    })}
  </span>
);

const Delta: FC<{ t: TopicTrend }> = ({ t }) => (
  <span class={`tp-delta tp-${t.direction}`}>{fmtPp(t.delta)}</span>
);

/** Zásadní změny za 4 týdny jako tečky (nejvýš 5) a číslo. */
const Major: FC<{ n: number }> = ({ n }) =>
  n > 0 ? (
    <span class="tp-major" title={`${n} zásadních změn za 4 týdny`}>
      <span aria-hidden="true">{"●".repeat(Math.min(n, 5))}</span>
      <span class="tp-major-n">{n}</span>
    </span>
  ) : <span class="tp-major tp-major-0">–</span>;

/** 1–3 nejrychleji rostoucí témata s důvodem. */
const Rising: FC<{ o: TopicsOverview; max: number }> = ({ o, max }) => {
  const up = o.topics.filter((t) => t.direction === "up").sort((a, b) => b.delta - a.delta).slice(0, 3);
  if (!up.length) return null;
  return (
    <section class="tp-rising" aria-labelledby="tp-rising-h">
      <h2 id="tp-rising-h" class="tp-h2">Na vzestupu</h2>
      <ol class="tp-rising-list">
        {up.map((t, i) => (
          <li class={i === 0 ? "tp-rise tp-rise-lead" : "tp-rise"}>
            <a class="tp-rise-title" href={href(t.key)}>{t.label}</a>
            <p class="tp-rise-nums">
              <span class="tp-share">{fmtPct(t.share)}</span> <Delta t={t} />
              <span class="tp-muted"> · dříve {fmtPct(t.prevShare)}</span>
              {t.major > 0 && <span class="tp-muted"> · zásadních {t.major}</span>}
            </p>
            <Strip t={t} max={max} stripFrom={o.stripFrom} large={i === 0} />
            {t.highlight && <p class="tp-why"><span class="tp-muted">Naposledy: </span>{t.highlight}</p>}
          </li>
        ))}
      </ol>
    </section>
  );
};

const Row: FC<{ t: TopicOverview; max: number; stripFrom: number }> = ({ t, max, stripFrom }) => (
  <li class="tp-row">
    <a class="tp-row-title" href={href(t.key)} title={t.description || undefined}>{t.label}</a>
    <Strip t={t} max={max} stripFrom={stripFrom} />
    <span class="tp-share">{fmtPct(t.share)}</span>
    <Delta t={t} />
    <Major n={t.major} />
  </li>
);

const Tools: FC<{ tools: ToolFocus[] }> = ({ tools }) => (
  <section class="tp-tools" aria-labelledby="tp-tools-h">
    <h2 id="tp-tools-h" class="tp-h2">Čemu se věnují ostatní</h2>
    <p class="tp-note">Hlavní témata ostatních sledovaných nástrojů za stejné 4 týdny a podíl téhož tématu u Claude Code.</p>
    <div class="tp-tools-grid">
      {tools.map((tool) => (
        <div class="tp-tool">
          <h3>{tool.name}</h3>
          {tool.total > 0 ? (
            <>
              <p class="tp-muted tp-tool-n">{tool.total} {zmen(tool.total)} za 4 týdny</p>
              <ol>
                {tool.top.map((t) => (
                  <li>
                    <a href={href(t.key)}>{t.label}</a>
                    <span class="tp-share">{fmtPct(t.share)}</span>
                    <span class="tp-muted tp-cc">Claude Code {fmtPct(t.ccShare)}</span>
                  </li>
                ))}
              </ol>
            </>
          ) : (
            <p class="tp-muted">Změny sbíráme od 18. 10. 2026, roztříděná témata zatím nejsou.</p>
          )}
        </div>
      ))}
    </div>
  </section>
);

/** Záložní seznam bez trendů. */
const PlainList: FC<{ topics: CcTopicSummary[] }> = ({ topics }) => (
  <ul class="tp-plain">
    {topics.map((t) => (
      <li>
        <a href={href(t.key)}>{t.label}</a>
        <span class="tp-muted"> · {t.count} {zmen(t.count)}{t.lastAt ? `, naposledy ${day(t.lastAt)}` : ""}</span>
        <p class="tp-muted">{t.description}</p>
      </li>
    ))}
  </ul>
);

/** Přehled témat: co je teď v centru vývoje Claude Code, co roste a co ustupuje. */
export const CcTopicsPage: FC<{ user: LayoutUser; overview: TopicsOverview | null; topics: CcTopicSummary[]; catchup?: Catchup | null }> = ({ user, overview, topics, catchup }) => {
  const o = overview && overview.total > 0 ? overview : null;
  const shown = o?.topics.filter((t) => t.share > 0 || t.prevShare > 0) ?? [];
  const max = Math.max(...shown.flatMap((t) => t.weeks.map((w) => w ?? 0)), 1);
  const toIncl = o ? o.to - 86_400_000 : 0;
  const pp = TREND_THRESHOLD_PP.toLocaleString("cs-CZ");
  return (
    <Layout title="Témata vývoje — Novinky v Claude Code" user={user} noindex>
      <section class="container-narrow tp" style="padding: 8px 0 40px">
        <p><a href="/novinky-cc">← Novinky v Claude Code</a></p>
        <h1 class="tp-h1">Kam teď míří vývoj Claude Code</h1>
        {o ? (
          <>
            <p class="tp-lede">{headline(o)}</p>
            <p class="tp-note">
              Podíl témat na {o.total} {zmen(o.total)} v changelogu za 4 týdny {day(o.from)} až {day(toIncl)},
              proti předchozím 13 týdnům.
            </p>
            <Rising o={o} max={max} />
            <section class="tp-map" aria-labelledby="tp-map-h">
              <div class="tp-map-head">
                <h2 id="tp-map-h" class="tp-h2">Všechna témata</h2>
                <p class="tp-legend" aria-hidden="true">
                  <span class="tp-legend-strip"><i class="tp-cell" style="--a:0.25" /><i class="tp-cell" style="--a:0.6" /><i class="tp-cell" style="--a:1" /></span>
                  podíl v týdnu, {dayShort(o.stripFrom)}–{dayShort(toIncl)} · <i class="tp-cell tp-recent tp-legend-recent" style="--a:0.6" /> poslední 4 týdny · ● zásadní změna
                </p>
              </div>
              <div class="tp-cols" aria-hidden="true">
                <span>Téma</span><span>17 týdnů</span><span>Podíl</span><span>Změna</span><span>Zásadní</span>
              </div>
              {BANDS.map((b) => {
                const rows = shown.filter((t) => t.direction === b.dir);
                return rows.length ? (
                  <div class={`tp-band tp-band-${b.dir}`}>
                    <h3 class="tp-band-h">{b.title} <span class="tp-muted">{b.note.replace("{pp}", pp)}</span></h3>
                    <ul class="tp-rows">{rows.map((t) => <Row t={t} max={max} stripFrom={o.stripFrom} />)}</ul>
                  </div>
                ) : null;
              })}
            </section>
            {catchup && catchup.tools.length > 0 && <CatchupBlock catchup={catchup} />}
            {o.tools.length > 0 && <Tools tools={o.tools} />}
            <p class="tp-note tp-method">
              Podíl počítá všechny položky changelogu včetně oprav; rozpracovaný týden se nepočítá. Témata
              přiřazuje jazykový model, jednotlivé položky mohou být zařazené nepřesně. Zásadní změna je
              taková, kterou model ohodnotil nejvyšší vahou (nová schopnost, nekompatibilní změna).
            </p>
          </>
        ) : (
          <>
            <p class="tp-lede">Významné změny z changelogu Claude Code roztříděné podle oblastí, od dubna 2025.</p>
            <PlainList topics={topics} />
          </>
        )}
      </section>
    </Layout>
  );
};
