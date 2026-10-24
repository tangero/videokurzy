import type { FC } from "hono/jsx";
import { Layout } from "./layout";
import { CatchupBlock } from "./cc-catchup";
import type { Catchup } from "../lib/cc-news/catchup";
import type { EcosystemMatrix, ToolWeekCard } from "../lib/cc-news/ecosystem";
import type { TopicsOverview } from "../lib/cc-news/topics-overview";
import type { CcNewsListItem } from "./cc-news";

type LayoutUser = { name: string | null; email: string } | null;

/** Největší podíl v mapě dostane tolik procent barvy nástroje (čitelnost tmavého textu). */
const MAX_TINT = 40;

const dayMonth = (ms: number) => new Date(ms).toLocaleDateString("cs-CZ", { day: "numeric", month: "long", timeZone: "UTC" });
const pct = (x: number) => (x > 0 && x < 1 ? "<1 %" : `${Math.round(x).toLocaleString("cs-CZ")} %`);
const changes = (n: number) => `${n.toLocaleString("cs-CZ")} ${n === 1 ? "změna" : n >= 2 && n <= 4 ? "změny" : "změn"}`;
const topicHref = (key: string) => `/novinky-cc/temata/${encodeURIComponent(key)}`;

/** Text s `inline kódem` z markdownu: liché úseky mezi backticky jako <code>, zbytek jako text. */
const InlineCode: FC<{ text: string }> = ({ text }) => (
  <>{text.split("`").map((part, i) => (i % 2 === 1 ? <code>{part}</code> : part))}</>
);

/** Tempo a hlavní témata nástroje za 4 týdny (z přehledu témat). */
const Focus: FC<{ total: number; top: { key: string; label: string }[] }> = ({ total, top }) => (
  <p class="eco-focus">
    <span class="eco-pace">{changes(total)} za 4 týdny</span>
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

/** Claude Code: poslední český článek. */
const MainCard: FC<{ latest: CcNewsListItem | null; overview: TopicsOverview | null }> = ({ latest, overview }) => {
  const top = overview
    ? [...overview.topics].filter((t) => t.key !== "other" && t.share > 0).sort((a, b) => b.share - a.share).slice(0, 3)
    : [];
  return (
    <section id="claude-code" class="eco-card eco-card-main cu-claude-code" aria-labelledby="eco-h-claude-code">
      <h3 id="eco-h-claude-code"><span class="cu-key" aria-hidden="true" />Claude Code</h3>
      {overview && <Focus total={overview.total} top={top} />}
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
const ToolCard: FC<{ card: ToolWeekCard; overview: TopicsOverview | null }> = ({ card, overview }) => {
  const focus = overview?.tools.find((t) => t.tool === card.tool);
  return (
    <section id={card.tool} class={`eco-card cu-${card.tool}`} aria-labelledby={`eco-h-${card.tool}`}>
      <h3 id={`eco-h-${card.tool}`}><span class="cu-key" aria-hidden="true" />{card.name}</h3>
      {focus && <Focus total={focus.total} top={focus.top} />}
      {card.week ? (
        <>
          <p class="eco-week">Týden {card.week.week}/{card.week.year}</p>
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
const Matrix: FC<{ matrix: EcosystemMatrix; overview: TopicsOverview }> = ({ matrix, overview }) => (
  <section class="eco-map" aria-labelledby="eco-map-h">
    <h2 id="eco-map-h" class="tp-h2">Kam kdo investuje</h2>
    <p class="tp-note">
      Podíl témat na změnách v changelogu každého nástroje za poslední 4 týdny
      ({dayMonth(overview.from)} až {dayMonth(overview.to - 86_400_000)}). Sytější buňka znamená větší podíl.
      Sloupce se sčítají do 100 %, nástroje s malým počtem změn proto kolísají víc.
    </p>
    <div class="eco-table-wrap">
      <table class="eco-table">
        <thead>
          <tr>
            <th scope="col" class="eco-th-topic">Téma</th>
            {matrix.tools.map((t) => (
              <th scope="col" class={`cu-${t.tool}`}>
                <span class="eco-th-name"><span class="cu-key" aria-hidden="true" />{t.name}</span>
                <span class="eco-th-n">{changes(t.total)}</span>
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
      Témata změnám přiřazuje jazykový model, takže jednotlivé položky mohou být zařazené nepřesně.
      Tečka znamená, že nástroj za 4 týdny nemá zatříděné změny.
    </p>
  </section>
);

/** Mapa ekosystému: týden u všech sledovaných nástrojů, témata a dohánění. Gated (řeší routa). */
export const CcEcosystemPage: FC<{
  user: LayoutUser;
  latest: CcNewsListItem | null;
  cards: ToolWeekCard[];
  overview: TopicsOverview | null;
  matrix: EcosystemMatrix | null;
  catchup: Catchup | null;
}> = ({ user, latest, cards, overview, matrix, catchup }) => (
  <Layout title="Mapa ekosystému" user={user} noindex>
    <section class="container-narrow tp eco" style="padding: 8px 0 40px">
      <p class="eco-crumbs"><a href="/novinky-cc">Novinky v Claude Code</a> · Mapa ekosystému</p>
      <h1>Mapa ekosystému</h1>
      <p class="tp-note eco-lede">
        Co se za poslední týden změnilo v Claude Code a v dalších {cards.length} agentech pro programování,
        čemu se věnují a které funkce Claude Code přebírají. U ostatních nástrojů jde o krátký souhrn
        z jejich changelogu, celý článek píšeme jen o Claude Code.
      </p>

      <h2 class="tp-h2 eco-h2">Tento týden</h2>
      <div class="eco-cards">
        <MainCard latest={latest} overview={overview} />
        {cards.map((card) => (
          <ToolCard card={card} overview={overview} />
        ))}
      </div>

      {matrix && overview && matrix.rows.length > 0 && <Matrix matrix={matrix} overview={overview} />}
      {catchup && catchup.tools.length > 0 && <CatchupBlock catchup={catchup} />}
    </section>
  </Layout>
);
