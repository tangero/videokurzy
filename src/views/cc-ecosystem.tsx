import type { FC } from "hono/jsx";
import { Layout } from "./layout";
import { CatchupBlock } from "./cc-catchup";
import type { Catchup } from "../lib/cc-news/catchup";
import { datesNote, type DatesNote, type EcosystemMatrix, type ToolWeekCard } from "../lib/cc-news/ecosystem";
import { isoWeekBounds } from "../lib/cc-news/changelog-source";
import { joinCs } from "./cc-catchup";
import type { ToolDates, ToolKey } from "../lib/tools/registry";
import type { TopicsOverview } from "../lib/cc-news/topics-overview";
import type { CcNewsListItem } from "./cc-news";
import { CcSectionNav } from "./cc-section-nav";

type LayoutUser = { name: string | null; email: string } | null;

/** Největší podíl v mapě dostane tolik procent barvy nástroje (čitelnost tmavého textu). */
const MAX_TINT = 40;

const dayMonth = (ms: number) => new Date(ms).toLocaleDateString("cs-CZ", { day: "numeric", month: "long", timeZone: "UTC" });
const pct = (x: number) => (x > 0 && x < 1 ? "<1 %" : `${Math.round(x).toLocaleString("cs-CZ")} %`);
const entries = (n: number) => `${n.toLocaleString("cs-CZ")} ${n === 1 ? "položka" : n >= 2 && n <= 4 ? "položky" : "položek"}`;
const releasesIn = (n: number) => `${n.toLocaleString("cs-CZ")} ${n === 1 ? "vydání" : "vydáních"}`;
/** „verze 1.4.3 a 1.4.5“ (1. pád jednotného i množného čísla zní stejně). */
const versions = (xs: string[]) => `verze ${joinCs(xs)}`;
/** Tvar podle počtu: jedna verze, nebo víc. */
const one = (xs: string[], sg: string, pl: string) => (xs.length === 1 ? sg : pl);
/** Průměr položek changelogu na vydání (celé číslo), null bez vydání. */
const perRelease = (total: number, releases: number) => (releases > 0 && total > 0 ? Math.round(total / releases) : null);
const topicHref = (key: string) => `/novinky-cc/temata/${encodeURIComponent(key)}`;

/** Text s `inline kódem` z markdownu: liché úseky mezi backticky jako <code>, zbytek jako text. */
const InlineCode: FC<{ text: string }> = ({ text }) => (
  <>{text.split("`").map((part, i) => (i % 2 === 1 ? <code>{part}</code> : part))}</>
);

/** Tempo a hlavní témata nástroje za 4 týdny (z přehledu témat). */
const Focus: FC<{ total: number; releases: number; top: { key: string; label: string }[] }> = ({ total, releases, top }) => (
  <p class="eco-focus">
    <span class="eco-pace">
      {entries(total)} changelogu{releases > 0 ? ` v ${releasesIn(releases)}` : ""} za 4 týdny
    </span>
    {top.length > 0 && (
      <>
        {" · "}
        {top.map((t, i) => (
          <>
            {i > 0 && ", "}
            <a href={topicHref(t.key)}>{t.label}</a>
          </>
        ))}
      </>
    )}
  </p>
);

/** Co z dat vydání nástroje není jisté (changelog bez dat): odvozená data a chybějící verze. */
const DatesNoteText: FC<{ name: string; note: DatesNote }> = ({ name, note }) => (
  <p class="eco-dates">
    {(note.upper.length > 0 || note.firstSeen.length > 0) && <>Changelog {name} neuvádí data vydání, bereme je z npm a GitHubu. </>}
    {note.upper.length > 0 && (
      <>
        Verze {joinCs(note.upper)} tam {one(note.upper, "datum nemá, proto ji", "data nemají, proto je")} řadíme
        k datu nejbližší novější verze: {one(note.upper, "vyšla nejpozději tehdy, mohla", "vyšly nejpozději tehdy, mohly")} i dřív.{" "}
      </>
    )}
    {note.firstSeen.length > 0 && (
      <>
        Verze {joinCs(note.firstSeen)} zatím {one(note.firstSeen, "nemá datum nikde, řadíme ji", "nemají datum nikde, řadíme je")} ke
        dni, kdy jsme {one(note.firstSeen, "ji", "je")} poprvé uviděli.{" "}
      </>
    )}
    {note.missing.length > 0 && (
      <>Novější {one(note.missing, "verzi", "verze")} {joinCs(note.missing)} changelog zatím nepopisuje, proto tu chybí.</>
    )}
  </p>
);

/** Claude Code: poslední český článek. */
const MainCard: FC<{ latest: CcNewsListItem | null; overview: TopicsOverview | null }> = ({ latest, overview }) => {
  const top = overview
    ? [...overview.topics].filter((t) => t.key !== "other" && t.share > 0).sort((a, b) => b.share - a.share).slice(0, 3)
    : [];
  return (
    <section id="claude-code" class="eco-card eco-card-main cu-claude-code" aria-labelledby="eco-h-claude-code">
      <h3 id="eco-h-claude-code"><span class="cu-key" aria-hidden="true" />Claude Code</h3>
      {overview && <Focus total={overview.total} releases={overview.releases?.["claude-code"] ?? 0} top={top} />}
      {latest ? (
        <>
          <p class="eco-week">
            Aktuální vydání{latest.publishedAt ? ` · ${dayMonth(latest.publishedAt)}` : ""}
          </p>
          <a class="eco-issue" href={`/novinky-cc/${encodeURIComponent(latest.slug)}`}>{latest.title}</a>
          {latest.points && latest.points.length > 0 && (
            <ul class="eco-points">
              {latest.points.map((p) => (
                <li><InlineCode text={p} /></li>
              ))}
            </ul>
          )}
          <a class="eco-more" href={`/novinky-cc/${encodeURIComponent(latest.slug)}`}>Celé vydání →</a>
        </>
      ) : (
        <p class="tp-muted eco-empty">Zatím žádné publikované vydání.</p>
      )}
    </section>
  );
};

/** Další nástroj: český souhrn posledního týdne s novinkami. */
const ToolCard: FC<{ card: ToolWeekCard; overview: TopicsOverview | null; dates?: ToolDates }> = ({ card, overview, dates }) => {
  const focus = overview?.tools.find((t) => t.tool === card.tool);
  // Okno 4 týdnů a nejnovější vydané verze, které changelog ještě nemá.
  const note = overview ? datesNote(dates ?? null, overview.from, overview.to, true) : null;
  const wb = card.week ? isoWeekBounds(card.week.year, card.week.week) : null;
  const weekNote = wb ? datesNote(dates ?? null, wb.start.getTime(), wb.end.getTime() + 1) : null;
  return (
    <section id={card.tool} class={`eco-card cu-${card.tool}`} aria-labelledby={`eco-h-${card.tool}`}>
      <h3 id={`eco-h-${card.tool}`}><span class="cu-key" aria-hidden="true" />{card.name}</h3>
      {focus && <Focus total={focus.total} releases={overview?.releases?.[card.tool] ?? 0} top={focus.top} />}
      {note && <DatesNoteText name={card.name} note={note} />}
      {card.week ? (
        <>
          <p class="eco-week">
            Týden {card.week.week}/{card.week.year}
            {weekNote && weekNote.upper.length + weekNote.firstSeen.length > 0 && (
              <> · {versions([...weekNote.upper, ...weekNote.firstSeen])} s odhadnutým datem</>
            )}
          </p>
          <ul class="eco-points" lang={card.pending ? "en" : undefined}>
            {card.points.map((p) => (
              <li><InlineCode text={p} /></li>
            ))}
          </ul>
          {card.pending && <p class="eco-pending">Český souhrn se připravuje, zatím názvy novinek z changelogu.</p>}
          {card.englishUrl && (
            <a class="eco-more" href={card.englishUrl} target="_blank" rel="noreferrer">Anglický přehled na vibecoding.cz ↗</a>
          )}
        </>
      ) : (
        <p class="tp-muted eco-empty">Za poslední čtyři týdny žádné novinky.</p>
      )}
    </section>
  );
};

/** Témata × nástroje: podíl tématu na změnách každého nástroje za 4 týdny. */
const Matrix: FC<{ matrix: EcosystemMatrix; overview: TopicsOverview; uncertain: Set<ToolKey> }> = ({ matrix, overview, uncertain }) => (
  <section class="eco-map" aria-labelledby="eco-map-h">
    <h2 id="eco-map-h" class="tp-h2">Kam kdo investuje</h2>
    <p class="tp-note">
      Podíl témat na změnách v changelogu každého nástroje za poslední 4 týdny
      ({dayMonth(overview.from)} až {dayMonth(overview.to - 86_400_000)}). Sytější buňka znamená větší podíl.
      Nástroje s malým počtem položek kolísají víc.
    </p>
    <div class="eco-table-wrap">
      <table class="eco-table">
        <thead>
          <tr>
            <th scope="col" class="eco-th-topic">Téma</th>
            {matrix.tools.map((t) => (
              <th scope="col" class={`cu-${t.tool}`}>
                <span class="eco-th-name">
                  <span class="cu-key" aria-hidden="true" />
                  {t.name}
                  {uncertain.has(t.tool) && <sup title="Data některých verzí jsou odhad">*</sup>}
                </span>
                <span class="eco-th-n">{entries(t.total)}</span>
                {t.releases > 0 && <span class="eco-th-n">{t.releases.toLocaleString("cs-CZ")} vydání</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.rows.map((r) => (
            <tr>
              <th scope="row">
                {r.key === "other" ? r.label : <a href={topicHref(r.key)}>{r.label}</a>}
              </th>
              {r.shares.map((x, i) => {
                const tool = matrix.tools[i]!.tool;
                if (x === null) return <td class="eco-cell eco-cell-none">·</td>;
                const tint = x > 0 ? Math.max(4, Math.round((MAX_TINT * Math.sqrt(x / matrix.max)))) : 0;
                return (
                  <td class={`eco-cell cu-${tool}`} style={tint ? `background: color-mix(in srgb, var(--cu) ${tint}%, var(--surface))` : undefined}>
                    {x > 0 ? pct(x) : "–"}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    <p class="tp-note">
      Počty jsou položky changelogu a mezi nástroji se nedají srovnávat: každý píše changelog jinak podrobně.
      Průměrný počet položek na vydání:{" "}
      {joinCs(
        matrix.tools
          .filter((t) => perRelease(t.total, t.releases) !== null)
          .map((t) => `${t.name} ${perRelease(t.total, t.releases)!.toLocaleString("cs-CZ")}`),
      )}
      . Podíly témat na tom nezávisí.
    </p>
    {uncertain.size > 0 && (
      <p class="tp-note">
        * Changelog {joinCs(matrix.tools.filter((t) => uncertain.has(t.tool)).map((t) => t.name))} neuvádí data vydání;
        u některých verzí je datum jen horní mez, podrobnosti u karty nástroje.
      </p>
    )}
    <p class="tp-note">
      Témata změnám přiřazuje jazykový model, takže jednotlivé položky mohou být zařazené nepřesně.
      Tečka znamená, že údaj chybí: nástroj za 4 týdny nemá zatříděné změny, u Claude Code se téma Ostatní nepočítá.
    </p>
  </section>
);

/** Mapa vývojářských nástrojů: týden u všech sledovaných nástrojů, témata a dohánění. Gated (řeší routa). */
export const CcEcosystemPage: FC<{
  user: LayoutUser;
  latest: CcNewsListItem | null;
  cards: ToolWeekCard[];
  overview: TopicsOverview | null;
  matrix: EcosystemMatrix | null;
  catchup: Catchup | null;
  dates?: Partial<Record<ToolKey, ToolDates>>;
}> = ({ user, latest, cards, overview, matrix, catchup, dates = {} }) => {
  // Nástroje, kterým v okně 4 týdnů chybí přesná data některých verzí (hvězdička v mapě).
  const uncertain = new Set(
    (Object.keys(dates) as ToolKey[]).filter((t) => {
      const n = overview ? datesNote(dates[t] ?? null, overview.from, overview.to) : null;
      return !!n && n.upper.length + n.firstSeen.length > 0;
    }),
  );
  return (
  <Layout title="Mapa vývojářských nástrojů — Novinky v Claude Code" user={user} noindex>
    <section class="container-narrow tp eco" style="padding: 8px 0 40px">
      <CcSectionNav current="ekosystem" />
      <h1>Mapa vývojářských nástrojů</h1>
      <p class="tp-note eco-lede">
        Co se za poslední týden změnilo v Claude Code a v dalších {cards.length} agentech pro programování,
        čemu se věnují a které funkce Claude Code přebírají. U ostatních nástrojů jde o krátký souhrn
        z jejich changelogu, celý článek píšeme jen o Claude Code.
      </p>

      <h2 class="tp-h2 eco-h2">Tento týden</h2>
      <div class="eco-cards">
        <MainCard latest={latest} overview={overview} />
        {cards.map((card) => (
          <ToolCard card={card} overview={overview} dates={dates[card.tool]} />
        ))}
      </div>

      {matrix && overview && matrix.rows.length > 0 && <Matrix matrix={matrix} overview={overview} uncertain={uncertain} />}
      {catchup && catchup.tools.length > 0 && <CatchupBlock catchup={catchup} />}
    </section>
  </Layout>
  );
};
