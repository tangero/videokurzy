import type { FC } from "hono/jsx";
import { Layout } from "./layout";
import { MONTH_DAYS, type Catchup, type CatchupPair, type ToolCatchup } from "../lib/cc-news/catchup";

type LayoutUser = { name: string | null; email: string } | null;

const DETAIL_HREF = "/novinky-cc/dohanani";
const dayFull = (ms: number) => new Date(ms).toLocaleDateString("cs-CZ", { day: "numeric", month: "numeric", year: "numeric", timeZone: "UTC" });
const dayShort = (ms: number) => new Date(ms).toLocaleDateString("cs-CZ", { day: "numeric", month: "numeric", timeZone: "UTC" });
const months = (days: number) => (days / MONTH_DAYS).toLocaleString("cs-CZ", { maximumFractionDigits: 1 });
const monthsWord = (n: number) => (n === 1 ? "měsíc" : n >= 2 && n <= 4 ? "měsíce" : "měsíců");
const funkce = (n: number) => (n === 1 ? "funkci" : n >= 2 && n <= 4 ? "funkce" : "funkcí");
/** Třída barvy nástroje (tečka, čára). */
const toolClass = (tool: string) => `cu-${tool}`;
const topicHref = (key: string) => `/novinky-cc/temata/${encodeURIComponent(key)}`;

const joinCs = (xs: string[]) => xs.join(", ").replace(/, ([^,]*)$/, " a $1");

/** Slovní shrnutí jednoho nástroje. */
const ToolSummary: FC<{ t: ToolCatchup }> = ({ t }) => {
  if (!t.pairs.length) {
    return (
      <p class="cu-sum tp-muted">
        {t.since ? `Změny sbíráme od ${dayFull(t.since)}. ` : "Změny zatím nesbíráme. "}
        Zatím jsme nenašli funkci Claude Code, kterou by zavedl pod stejným názvem. Pokud ji pojmenovává po svém,
        srovnání bude potřebovat párování podle významu.
      </p>
    );
  }
  const med = Math.round((t.medianLagDays ?? 0) / MONTH_DAYS);
  return (
    <p class="cu-sum">
      Dohnal <b>{t.pairs.length} {funkce(t.pairs.length)}</b> Claude Code, medián zpoždění <b>{med} {monthsWord(med)}</b>.
      {t.now.length > 0 && <> Teď dohání v {t.now.length === 1 ? "tématu" : "tématech"} {joinCs(t.now.map((x) => x.label))}.</>}
    </p>
  );
};

/** Blok „Kdo koho dohání“ na přehledu témat: slovní hodnocení a odkaz na časovou osu. */
/** `standalone` = na stránce /novinky-cc/dohanani (bez vlastního nadpisu, odkazy na kotvy). */
export const CatchupBlock: FC<{ catchup: Catchup; standalone?: boolean }> = ({ catchup, standalone }) => (
  <section class="cu" aria-labelledby={standalone ? undefined : "cu-h"} aria-label={standalone ? "Souhrn po nástrojích" : undefined}>
    {!standalone && (
      <>
        <h2 id="cu-h" class="tp-h2">Kdo koho dohání</h2>
        <p class="tp-note">
          Funkce Claude Code, které ostatní nástroje přidaly později. Počítá se jen zavedení nové funkce se stejně
          pojmenovanou událostí, příkazem nebo nastavením, každý případ ověřil jazykový model.
        </p>
      </>
    )}
    <div class="cu-tools">
      {/* Nástroje s dohnanými funkcemi první, prázdné stavy přes celou šířku na konec. */}
      {[...catchup.tools].sort((a, b) => Number(b.pairs.length > 0) - Number(a.pairs.length > 0)).map((t) => (
        <div class={`cu-tool${t.pairs.length ? "" : " cu-tool-wide"}`}>
          <h3><span class={`cu-key ${toolClass(t.tool)}`} aria-hidden="true" />{t.name}</h3>
          <ToolSummary t={t} />
          {t.pairs.length > 0 && <a class="cu-more" href={`${DETAIL_HREF}#${t.tool}`}>Časová osa dohánění →</a>}
          {t.pairs.length > 0 && t.since && t.lead.length > 0 && (
            <p class="cu-lead">
              Claude Code od {dayShort(t.since)} přidal nové pojmy bez protějšku hlavně v {t.lead.length === 1 ? "tématu" : "tématech"}{" "}
              {t.lead.map((l, i) => (
                <>{i > 0 && (i === t.lead.length - 1 ? " a " : ", ")}<b>{l.label}</b> ({l.n})</>
              ))}.
            </p>
          )}
        </div>
      ))}
    </div>
  </section>
);

// ─── Časová osa ──────────────────────────────────────────────────

interface Axis { start: number; end: number; ticks: { at: number; label: string }[] }

const MONTHS_SHORT = ["led", "úno", "bře", "dub", "kvě", "čvn", "čvc", "srp", "zář", "říj", "lis", "pro"];

/** Osa od čtvrtletí před první funkcí CC po měsíc za posledním dohnáním; popisky po čtvrtletích. */
export function timelineAxis(pairs: CatchupPair[], to: number): Axis {
  const first = Math.min(...pairs.map((p) => p.ccAt), to);
  const last = Math.max(...pairs.map((p) => p.otherAt), to);
  const s = new Date(first);
  const startQ = Date.UTC(s.getUTCFullYear(), Math.floor(s.getUTCMonth() / 3) * 3, 1);
  const e = new Date(last);
  const end = Date.UTC(e.getUTCFullYear(), e.getUTCMonth() + 1, 1);
  const ticks: Axis["ticks"] = [];
  for (let d = new Date(startQ); d.getTime() <= end; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 3, 1))) {
    ticks.push({ at: d.getTime(), label: `${MONTHS_SHORT[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}` });
  }
  return { start: startQ, end, ticks };
}

const pct = (axis: Axis, ms: number) => ((100 * (ms - axis.start)) / (axis.end - axis.start)).toFixed(2);

const PairRow: FC<{ p: CatchupPair; axis: Axis; since: number | null; name: string }> = ({ p, axis, since, name }) => {
  const a = Number(pct(axis, p.ccAt));
  const b = Number(pct(axis, p.otherAt));
  const ccLabel = `${p.ccExact ? "" : "nejpozději "}${dayFull(p.ccAt)}`;
  return (
    <li class="cu-row">
      <div class="cu-lbl">
        <code>{p.term}</code>
        {p.title && <span>{p.title}</span>}
        <a href={topicHref(p.topic)}>{p.topicLabel}</a>
      </div>
      <div class="cu-track" role="img" aria-label={`Claude Code ${ccLabel} (v${p.ccVersion}), ${name} ${dayFull(p.otherAt)} (v${p.otherVersion}), zpoždění ${months(p.lagDays)} měs.`}>
        {since && <i class="cu-before" style={`width:${pct(axis, since)}%`} />}
        {axis.ticks.map((t) => <i class="cu-grid" style={`left:${pct(axis, t.at)}%`} />)}
        <i class={`cu-line ${toolClass(p.tool)}`} style={`left:${a}%;width:${(b - a).toFixed(2)}%`} />
        <i class="cu-dot cu-claude-code" style={`left:${a}%`} title={`Claude Code ${ccLabel}, v${p.ccVersion}`} />
        <i class={`cu-dot ${toolClass(p.tool)}`} style={`left:${b}%`} title={`${name} ${dayFull(p.otherAt)}, v${p.otherVersion}`} />
        <b class="cu-lag" style={`left:${((a + b) / 2).toFixed(2)}%`}>{months(p.lagDays)} měs.</b>
      </div>
    </li>
  );
};

/** Časová osa párů; `onlyTopic` = jen řádky jednoho tématu (stránka tématu). */
export const CatchupTimeline: FC<{ catchup: Catchup; onlyTopic?: string }> = ({ catchup, onlyTopic }) => {
  const tools = catchup.tools
    .map((t) => ({ ...t, pairs: onlyTopic ? t.pairs.filter((p) => p.topic === onlyTopic) : t.pairs }))
    .filter((t) => t.pairs.length > 0);
  if (!tools.length) return null;
  const axis = timelineAxis(tools.flatMap((t) => t.pairs), catchup.to);
  return (
    <div class="cu-timeline">
      <p class="cu-legend">
        <span><i class="cu-key cu-claude-code" />Claude Code</span>
        {tools.map((t) => <span><i class={`cu-key ${toolClass(t.tool)}`} />{t.name}</span>)}
      </p>
      <div class="cu-axis" aria-hidden="true">
        <span />
        <div class="cu-ticks">{axis.ticks.map((t) => <span class="cu-tick" style={`left:${pct(axis, t.at)}%`}>{t.label}</span>)}</div>
      </div>
      {tools.map((t) => (
        <div class="cu-group" id={onlyTopic ? undefined : t.tool}>
          <h3><span class={`cu-key ${toolClass(t.tool)}`} aria-hidden="true" />{t.name}{t.since && <span class="tp-muted"> sledujeme od {dayFull(t.since)}</span>}</h3>
          <ul class="cu-plot">{t.pairs.map((p) => <PairRow p={p} axis={axis} since={t.since} name={t.name} />)}</ul>
        </div>
      ))}
      <p class="tp-note">
        Datum u Claude Code je první zmínka v changelogu. Když to nebyla položka „Added“, funkce existovala
        nejpozději od toho dne (najetím myši se ukáže verze), zpoždění je proto spíš dolní odhad. Šrafovaně je
        doba před začátkem sledování nástroje, kdy jeho dřívější vydání neznáme.
      </p>
    </div>
  );
};

/** Stránka /novinky-cc/dohanani: shrnutí a časová osa všech ověřených párů. */
export const CcCatchupPage: FC<{ user: LayoutUser; catchup: Catchup | null }> = ({ user, catchup }) => {
  const any = catchup?.tools.some((t) => t.pairs.length > 0);
  return (
    <Layout title="Kdo koho dohání — Novinky v Claude Code" user={user} noindex>
      <section class="container-narrow tp" style="padding: 8px 0 40px">
        <p><a href="/novinky-cc/temata">← Témata vývoje</a></p>
        <h1 class="tp-h1">Kdo koho dohání</h1>
        <p class="tp-lede">
          Když se v jiném nástroji objeví jako nová funkce pojem, který Claude Code má už dřív, je to doložené
          dohánění i s datem. Počítá se jen zavedení nové funkce se stejně pojmenovanou událostí, příkazem nebo
          nastavením, každý případ ověřil jazykový model.
        </p>
        {catchup && any ? (
          <>
            <CatchupBlock catchup={catchup} standalone />
            <section class="cu-page-tl" aria-labelledby="cu-tl-h">
              <h2 id="cu-tl-h" class="tp-h2">Časová osa dohánění</h2>
              <CatchupTimeline catchup={catchup} />
            </section>
            <section class="tp-method" aria-labelledby="cu-how-h">
              <h2 id="cu-how-h" class="tp-h2">Jak se to počítá</h2>
              <p class="tp-note">
                Ze změn každého tématu se vytáhnou identifikátory (události, příkazy, klíče nastavení). Kandidát je pojem,
                který má Claude Code dřív a druhý nástroj ho poprvé zmíní u nové funkce, aspoň 3 týdny po začátku
                sledování. Obecné příkazy (/help, /config, /login…) se vynechají. Jazykový model u každého kandidáta
                přečte obě položky a rozhodne, jestli druhý nástroj funkci skutečně zavádí. „Dohání teď“ znamená dohnanou
                funkci za posledních 8 týdnů v tématu, jehož podíl na změnách nástroje roste.
              </p>
              <p class="tp-note">
                Funkce pojmenované jinak se neukážou. Claude Code sledujeme od roku 2025, ostatní nástroje kratší dobu,
                měření je proto nesouměrné. Nové pojmy bez protějšku jsou jen hrubý ukazatel náskoku: část z nich jsou
                služby Anthropicu, které jiný nástroj mít nebude.
              </p>
            </section>
          </>
        ) : (
          <p class="tp-note">Ověřené případy dohánění zatím nemáme. Přepočítávají se po každém dotřídění changelogu.</p>
        )}
      </section>
    </Layout>
  );
};
