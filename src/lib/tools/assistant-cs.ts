// Český týdenní zápis osobního AI asistenta (Grok Bot; později Dots, Duet, Muse)
// pro vibecoding.cz/novinky/<tool>/<rok>-w<NN>/.
//
// Píše se z položek changelogu týdne (cc_change_item, tool = asistent), ne z výběru
// Novinek v CC: asistenti nemají taxonomii témat CC (topic zůstává NULL), oblasti
// (areas) přiřadí model z pevného seznamu nástroje a kód je ověří. Každý bod cituje
// ID položek changelogu; kód kontroluje citace, pokrytí všech položek a model
// (classifyModel) ověří fakta proti citovaným položkám (vzor selectAndVerify ve weekly.ts).
// Z ověřených bodů pak vzniká redakční článek ve stylu Novinek v CC (od 26. 10. 2026,
// rozhodnutí Patricka; vzor writeWeeklyArticle). Obecný popis asistenta do článku
// nepatří, je v pevné hlavičce stránky (ASSISTANTS[tool].about na webu).
// Výsledek je PR do repa webu se souborem podle kontraktu docs/novinky-asistentu.md
// (vibecoding-site); při automatickém vydávání se sám sloučí po úspěšném buildu
// (fronta cc-news.en-merge s itemId `assistant-<tool>-<rok>-w<NN>`).

import { and, eq, gte, lte } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";
import { ccChangeItem } from "../../db/schema";
import { compareVersions, isoWeek, isoWeekBounds } from "../cc-news/changelog-source";
import {
  DEFAULT_REPO, fileOnDefaultBranch, openSitePullRequest, publicationDate, type GhFetch, type SitePr,
} from "../cc-news/english";
import { classifyModel, llmJson, openRouterLlm, writeModel, type LlmEnv, type LlmFn } from "../cc-news/llm";
import { czechDateRange, extractEditorNotes, inputMentions, versionViolations, yamlQuote } from "../cc-news/weekly";
import { GROK_BOT_CHANGELOG_URL, toolReleasesKvKey, type AssistantRelease } from "./grok-bot";
import { isAssistantTool, toolName, type ToolKey } from "./registry";

type Db = ReturnType<typeof drizzle>;
type Row = typeof ccChangeItem.$inferSelect;
type Week = { year: number; week: number };

export interface AssistantArea { key: string; label: string }

/**
 * Oblasti změn asistenta pro pole `areas` zápisu. JEDINÉ místo pravdy v pipeline,
 * MUSÍ se shodovat s `ASSISTANTS[<tool>].areas` v vibecoding-site
 * `src/lib/assistant-updates.ts`: neznámý klíč schéma webu odmítne a build PR spadne.
 * Při změně upravit obě strany.
 */
export const ASSISTANT_AREAS: Partial<Record<ToolKey, AssistantArea[]>> = {
  "grok-bot": [
    { key: "schvalovani", label: "Schvalování a Auto-review" },
    { key: "tymy", label: "Týmy a Team Bots" },
    { key: "konektory", label: "Konektory a pluginy" },
    { key: "komunikace", label: "E-mail, Slack a X" },
    { key: "pocitac", label: "Cloudový počítač a prohlížeč" },
    { key: "rutiny", label: "Rutiny a automatizace" },
    { key: "vystupy", label: "Pages, soubory a média" },
    { key: "ucet", label: "Účet, nastavení a Vault" },
    { key: "mobil", label: "Mobilní aplikace" },
  ],
};

/** Oficiální changelog asistenta (pole source_url zápisu). */
export const ASSISTANT_SOURCE_URL: Partial<Record<ToolKey, string>> = {
  "grok-bot": GROK_BOT_CHANGELOG_URL,
};

export const MAX_HIGHLIGHTS = 5;

export type Section = "new" | "improved" | "fixed";
const SECTIONS: Section[] = ["new", "improved", "fixed"];
const SECTION_LABELS: Record<Section, string> = { new: "nové", improved: "vylepšené", fixed: "opravené" };
/** Typ položky changelogu → oddíl zápisu; Other (oddíl na stránce nešel určit) rozhodne model. */
const SECTION_OF_TYPE: Record<string, Section | undefined> = { Added: "new", Improved: "improved", Fixed: "fixed" };

export interface NoteBullet { text: string; sources: string[]; area: string | null }

export interface AssistantNote {
  v: 1;
  tool: ToolKey;
  week: Week;
  builtAt: string;
  headline: string;
  summary: string;
  highlights: string[];
  main: string;
  sections: Record<Section, NoteBullet[]>;
  areas: string[];
  counts: Record<Section, number>;
  /** Rozsah skutečných verzí týdne (bez syntetických verzí bloků bez čísla), např. 0.75.0–0.75.5. */
  versions: string | null;
  /** Redakční článek z ověřených bodů: nadpis za dvojtečkou a markdown bez h1, začíná perexem. */
  article: { title: string; body: string };
  review: {
    /** Body vyřazené kontrolou faktů. */
    dropped: { text: string; problem: string }[];
    /** Opravené po kontrole faktů. */
    fixed: number;
    /** Položky changelogu, které nepokrývá žádný bod (vidět v PR). */
    uncovered: string[];
    /** Neznámé oblasti od modelu (zahozené). */
    badAreas: string[];
    /** Verze v článku, které v týdnu nejsou. */
    versionIssues: string[];
    /** Poznámky editoru a zmínky o vstupu modelu vyňaté z článku. */
    editorNotes: string[];
    /** Odstraněné odkazy (článek smí odkazovat jen na changelog). */
    strippedLinks: string[];
  };
}

const pad = (n: number) => String(n).padStart(2, "0");
export const assistantWeekLabel = (w: Week) => `${w.year}-w${pad(w.week)}`;

/** Cesta souboru podle kontraktu: src/content/novinky/<tool>/<rok>-w<NN>.md. */
export function assistantNotePath(tool: ToolKey, w: Week): string {
  return `src/content/novinky/${tool}/${assistantWeekLabel(w)}.md`;
}

/** Adresa zápisu na webu. */
export function assistantNoteUrl(tool: ToolKey, w: Week): string {
  return `https://www.vibecoding.cz/novinky/${tool}/${assistantWeekLabel(w)}/`;
}

/** itemId řetězce slučování PR (cc-news.en-merge) pro zápis asistenta. */
export const ASSISTANT_MERGE_PREFIX = "assistant-";
export const assistantMergeId = (tool: ToolKey, w: Week) => `${ASSISTANT_MERGE_PREFIX}${tool}-${assistantWeekLabel(w)}`;
export function parseAssistantMergeId(id: string): { tool: ToolKey; week: Week } | null {
  const m = id.match(/^assistant-([a-z0-9-]+)-(\d{4})-w(\d{2})$/);
  if (!m || !isAssistantTool(m[1]!)) return null;
  return { tool: m[1] as ToolKey, week: { year: Number(m[2]), week: Number(m[3]) } };
}

/** Napsaný zápis (markdown + poznámka): retry fronty i ostrý běh po náhledu ho použijí znovu. */
export const assistantMdKvKey = (tool: ToolKey, w: Week) => `tools:assistant-md:${tool}:${assistantWeekLabel(w)}`;
/** sha souboru, který generátor naposledy zapsal na větev PR (pozná ruční úpravy). */
export const assistantShaKvKey = (tool: ToolKey, w: Week) => `tools:assistant-sha:${tool}:${assistantWeekLabel(w)}`;
/** Týden je vyřízený (PR otevřen, prázdný týden, už vydaný): cron ho znovu nezařadí. */
export const assistantDoneKvKey = (tool: ToolKey, w: Week) => `tools:assistant-week:${tool}:${assistantWeekLabel(w)}`;
const MD_TTL_SEC = 60 * 24 * 60 * 60;
/** Verze formátu uloženého markdownu: starší (seznam bodů místo článku) se napíše znovu. */
const MD_FORMAT = 2;

// ─── Psaní ────────────────────────────────────────────────────────

const line = (r: Pick<Row, "id" | "type" | "scope" | "text">) => `${r.id} | ${r.type}${r.scope ? ` [${r.scope}]` : ""} | ${r.text}`;

export const WRITER_SYSTEM_CS = (name: string, areas: AssistantArea[]) => [
  `Píšeš český týdenní zápis změn osobního AI asistenta ${name} pro web vibecoding.cz (sekce Novinky).`,
  `Čtenář ${name} používá nebo zvažuje a chce rychle vědět, co se za týden změnilo. Není to článek ani recenze.`,
  "",
  "VSTUP: vydání týdne a jejich položky changelogu ve tvaru `ID | TYP [štítek] | text`, anglicky.",
  "TYP Added = nové, Improved = vylepšené, Fixed = opravené, Other = oddíl nešel určit (urči ho sám).",
  "Štítek [Teams] nebo [Enterprise] znamená, že změna platí jen pro týmy nebo firemní tarif: v textu to řekni.",
  "Fakta ber VÝHRADNĚ z položek. Nic nedomýšlej: žádná čísla, ceny, limity, tarify, data, verze ani názvy",
  "funkcí, které v položkách nejsou. Žádné srovnání s jinými nástroji, žádné hodnocení ani doporučení.",
  "",
  "VÝSTUP (JSON):",
  '{"headline": "<3–8 slov: hlavní změny týdne, bez názvu nástroje a čísla týdne>",',
  ' "summary": "<1–2 věty: co se v týdnu změnilo nejvíc>",',
  ` "highlights": [{"text": "<jedna věta, nejvýš 20 slov>", "sources": ["<ID>", …]}],  // 1 až ${MAX_HIGHLIGHTS}, nejdůležitější první`,
  ' "main": {"text": "<odstavec 2–4 věty o nejvýznamnější změně týdne: co umí a k čemu je>", "sources": ["<ID>", …]},',
  ' "items": [{"section": "new"|"improved"|"fixed", "text": "<jedna až dvě věty>", "sources": ["<ID>", …], "area": "<klíč oblasti>"}]}',
  "",
  "PRAVIDLA PRO items:",
  "- KAŽDÁ položka changelogu musí být citovaná aspoň v jednom bodu items. Nic nevynechávej.",
  "- Bod obvykle odpovídá jedné položce. Sloučit smíš jen položky, které popisují totéž; pak je cituj všechny.",
  "- section podle TYPu položky (Added → new, Improved → improved, Fixed → fixed); u Other podle obsahu.",
  "- area = právě jeden klíč z tohoto seznamu (jiné klíče nejsou povolené):",
  ...areas.map((a) => `  - ${a.key}: ${a.label}`),
  "",
  "JAZYK: spisovná věcná čeština, oznamovací způsob, střízlivě, bez marketingových superlativů. Anglicismy",
  "nahraď českými ekvivalenty, kde existují; zavedené IT termíny ponech. Názvy funkcí, nastavení a tlačítek",
  "z changelogu (Vault, Auto-review, Team Bot, Settings → Computer) ponech v původním znění. Pomlčka je krátká",
  "s mezerami ( - ), nikdy em dash (—). Nepiš o „vstupu“, „položkách“ ani o tom, co v nich chybí.",
  "Uvnitř textů nepoužívej dvojité uvozovky; v češtině piš „ “.",
].join("\n");

const VERIFY_SYSTEM_CS = [
  "Kontroluješ české tvrzení proti anglickým zdrojům. Ke každému CLAIM dostaneš citované ENTRIES.",
  'Vrať JSON pole: {"n": <číslo claimu>, "supported": true|false, "problem": "<krátce česky, prázdné když supported>"}',
  "supported = každé věcné tvrzení plyne ze zdrojů. Parafráze a překlad jsou v pořádku; přidaná fakta, čísla,",
  "tarify, motivace nebo funkce, které ve zdrojích nejsou, ne. Uvnitř problem nepoužívej dvojité uvozovky.",
].join("\n");

const FIX_SYSTEM_CS = [
  "České body zápisu neprošly kontrolou faktů. Každý přepiš tak, aby každé tvrzení plynulo z citovaných ENTRIES:",
  "nedoložené části vypusť, nic nepřidávej. Zachovej styl (věcná čeština, krátká pomlčka, žádné dvojité uvozovky).",
  'Vrať JSON pole: {"n": <číslo bodu>, "text": "<opravený text>"} nebo {"n": <číslo>, "drop": true}, když nic nezbude.',
].join("\n");

const MISSING_BATCH = 30;

const MISSING_SYSTEM_CS = (areas: AssistantArea[]) => [
  "Tyto položky changelogu chybí v českém týdenním zápisu. Ke každé napiš bod (jedna až dvě věty česky,",
  "jen fakta z položky) se section new|improved|fixed podle typu a area z povolených klíčů:",
  areas.map((a) => a.key).join(", "),
  'Vrať JSON {"items": [{"section", "text", "sources": ["<ID>"], "area"}]}. Uvnitř textů žádné dvojité uvozovky.',
].join("\n");

/**
 * Redakční pravidla ze skillu „Technický článek“ jako WRITER_SYSTEM Novinek v CC
 * (weekly.ts), upravená pro asistenta podle schváleného prototypu (Grok Bot, týden 42).
 */
export const ARTICLE_SYSTEM_CS = (name: string) => [
  `Jsi Patrick Zandl a píšeš pro vibecoding.cz týdenní článek o změnách osobního AI asistenta ${name}.`,
  `Čtenář ${name} používá nebo zvažuje. Text má dočíst do konce, protože mu odpovídá na otázku, kterou má,`,
  "a protože za ním slyší člověka s názorem.",
  "",
  "VSTUP: ověřené české body týdne po oddílech (nové, vylepšené, opravené) a oblastech, u každého",
  "anglická položka changelogu, ze které vychází. Fakta ber VÝHRADNĚ z bodů a jejich položek.",
  "Nic nedomýšlej: žádná čísla, ceny, limity, tarify, data, verze ani názvy funkcí, které tam nejsou.",
  "",
  "STRUKTURA (v tomto pořadí):",
  "- PEREX: jeden odstavec kurzívou. Otevírá problémem nebo napětím, které týden řeší, a shrnuje",
  "  nejdůležitější témata. Zpravodajské zdůvodnění (období, verze, počet položek) patří do druhého odstavce.",
  `- NEPIŠ obecné představení nástroje (co je ${name}, kdo ho vyvíjí, co umí obecně). To má stránka v pevné`,
  "  hlavičce. Článek začíná rovnou tím, co přinesl týden.",
  "- Sekce oddělené řádkem `---`, nadpisy `## ` mířené na čtenáře (ne absolutní tvrzení). Sekce skládej",
  "  podle témat týdne, ne podle oddílů changelogu. Nejdůležitější téma první a nejobšírněji.",
  "- Každý odstavec s jednou tezí začíná tučným lead-inem (**Takto.**). Odrážky jen pro výčet podmínek.",
  "- U nové funkce napiš, co to je a k čemu se hodí. Štítek [Teams] nebo [Enterprise] znamená, že změna",
  "  platí jen pro týmy nebo firemní tarif: v textu to řekni (klidně vlastní sekce pro správce).",
  "- Drobné opravy nevypisuj jednotlivě: shrň je do jednoho odstavce v sekci s drobnostmi.",
  "- Poslední sekce „Co si z toho odnést“: co má běžný uživatel vyzkoušet a na co si dát pozor,",
  "  případně co má zkontrolovat správce týmu.",
  "- Poznámku o zdrojích NEPIŠ, doplní ji redakce.",
  "- Délka podle týdne: zhruba 400 slov u malého týdne, nejvýš 1500 slov u velkého.",
  "",
  "HLAS:",
  "- Vykej čtenáři. Názor v první osobě je vítaný tam, kde ho nesou fakta z bodů (praktický dopad,",
  "  riziko, co bych zkusil nejdřív). Žádné spekulace o motivech firmy.",
  "- NIKDY si nevymýšlej osobní zkušenosti, zážitky ani zvyky autora („včera jsem zkoušel…“, „mně Bot…“).",
  "- Přiznej nejistotu („zjednodušeně řečeno“, „možná“), skepsi dej do závorky, suchý humor ano,",
  "  ironie na účet čtenáře nikdy. Marketingové superlativy (revoluční, průlomový, game changer) zakázané.",
  "- Věty začínej podmětem a přísudkem; střídej krátké a dlouhé, nikdy tři dlouhé za sebou.",
  "",
  "JAZYK:",
  "- Spisovná, ale konverzační čeština. Anglicismy nahraď českými ekvivalenty, kde existují; zavedené IT",
  "  termíny ponech. Názvy funkcí, nastavení a tlačítek (Vault, Auto-review, Team Bot, Secure Form) ponech",
  "  v původním znění a při prvním použití je vysvětli.",
  "- Pomlčka uvnitř věty je krátká s mezerami ( - ). NIKDY em dash (—).",
  "- Zakázaný negativní paralelismus („není to A, je to B“, „nejde o A, jde o B“, „ne A, ale B“): řekni rovnou B.",
  "- Bez klišé: „V dnešní době“, „Je důležité zdůraznit“, „Klíčovou roli hraje“, „Závěrem lze konstatovat“,",
  "  řetězení „Nicméně / Kromě toho / V neposlední řadě“, pravidlo tří, „představuje“ místo „je“.",
  "- Verze uváděj jen ty, které jsou ve vstupu. Žádné odkazy, odkaz na changelog doplní redakce.",
  "- Čtenář vstup nevidí: nikdy nepiš o „vstupu“, „bodech“, „podkladech“ ani o tom, co v nich chybí.",
  "",
  'VÝSTUP: JSON {"title": "<nadpis za dvojtečkou: výstižný, 3–9 slov, bez názvu nástroje a čísla týdne>",',
  ' "body": "<markdown článku BEZ nadpisu, začíná perexem kurzívou>"}.',
  "Uvnitř textových hodnot nepoužívej dvojité uvozovky; v češtině piš „ “.",
].join("\n");

interface RawClaim { text?: unknown; sources?: unknown }
interface RawItem extends RawClaim { section?: unknown; area?: unknown }
interface RawNote { headline?: unknown; summary?: unknown; highlights?: unknown; main?: unknown; items?: unknown }

export interface AssistantLlms { write: LlmFn; verify: LlmFn }

const str = (v: unknown) => (typeof v === "string" ? v : "");
/** Em dash pryč, mezery sjednotit. */
export const tidy = (s: string) => s.replace(/\s*—\s*/g, " - ").replace(/\s+/g, " ").trim();

/** Vstup pro model: vydání týdne (název, další verze) a jejich položky. */
export function writerUserMessage(tool: ToolKey, week: Week, rows: Row[], releases: AssistantRelease[]): string {
  const byVersion = new Map<string, Row[]>();
  for (const r of rows) byVersion.set(r.version, [...(byVersion.get(r.version) ?? []), r]);
  const meta = new Map(releases.map((r) => [r.version, r]));
  const blocks = [...byVersion.entries()].sort(([a], [b]) => compareVersions(a, b)).map(([v, rs]) => {
    const m = meta.get(v);
    const head = `VYDÁNÍ ${m?.synthetic ? "(bez čísla verze)" : v}, ${rs[0]!.publishedAt.toISOString().slice(0, 10)}` +
      (m?.title ? `: ${m.title}` : "") + (m?.alsoIncludes.length ? ` (zahrnuje i ${m.alsoIncludes.join(", ")})` : "");
    return [head, ...rs.sort((a, b) => a.ord - b.ord).map(line)].join("\n");
  });
  return `NÁSTROJ: ${toolName(tool)}, týden ${week.week}/${week.year}\n\n${blocks.join("\n\n")}`;
}

/** Rozsah skutečných verzí týdne včetně „Also includes“; syntetické verze (4 složky) vynechá. */
export function versionRange(rows: Pick<Row, "version">[], releases: AssistantRelease[]): string | null {
  const meta = new Map(releases.map((r) => [r.version, r]));
  const vs = new Set<string>();
  for (const v of new Set(rows.map((r) => r.version))) {
    const m = meta.get(v);
    if (m?.synthetic || v.split(".").length !== 3) continue;
    vs.add(v);
    for (const a of m?.alsoIncludes ?? []) vs.add(a);
  }
  const sorted = [...vs].sort(compareVersions);
  if (sorted.length === 0) return null;
  return sorted.length === 1 ? sorted[0]! : `${sorted[0]}–${sorted[sorted.length - 1]}`;
}

/** Verze týdne, které smí článek zmínit (skutečné verze a jejich „Also includes“). */
function weekVersions(rows: Pick<Row, "version">[], releases: AssistantRelease[]): Set<string> {
  const meta = new Map(releases.map((r) => [r.version, r]));
  return new Set([...new Set(rows.map((r) => r.version))].flatMap((v) => [v, ...(meta.get(v)?.alsoIncludes ?? [])]));
}

/** Markdownové odkazy mimo povolené adresy převede na prostý text. */
export function keepOnlyLinks(md: string, allowed: Set<string>): { markdown: string; stripped: string[] } {
  const stripped: string[] = [];
  const markdown = md.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (m, text: string, url: string) => {
    if (allowed.has(url.replace(/\/$/, ""))) return m;
    stripped.push(url);
    return text;
  });
  return { markdown, stripped };
}

type Fact = NoteBullet & { section: Section };

/** Vstup pro článek: týden, ověřené body po oddílech a oblastech s anglickou položkou. */
export function articleUserMessage(
  tool: ToolKey, week: Week, rows: Row[], releases: AssistantRelease[],
  facts: { summary: string; main: string; highlights: string[]; items: Fact[]; counts: Record<Section, number> },
): string {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const areaLabel = new Map((ASSISTANT_AREAS[tool] ?? []).map((a) => [a.key, a.label]));
  const { start, end } = isoWeekBounds(week.year, week.week);
  const versions = versionRange(rows, releases);
  return [
    `NÁSTROJ: ${toolName(tool)}, týden ${week.week}/${week.year} (${czechDateRange(start, end)})` +
      `${versions ? `, verze ${versions}` : ""}; položek changelogu ${rows.length}` +
      ` (nové ${facts.counts.new}, vylepšené ${facts.counts.improved}, opravené ${facts.counts.fixed}).`,
    "",
    `SHRNUTÍ: ${facts.summary}`,
    `HLAVNÍ ZMĚNA: ${facts.main}`,
    "NEJDŮLEŽITĚJŠÍ:",
    ...facts.highlights.map((h) => `- ${h}`),
    "",
    ...SECTIONS.flatMap((sec) => {
      const its = facts.items.filter((i) => i.section === sec);
      return its.length ? [
        `BODY – ${SECTION_LABELS[sec]}:`,
        ...its.flatMap((i) => [
          `- [${i.area ? areaLabel.get(i.area) ?? i.area : "bez oblasti"}] ${i.text}`,
          ...i.sources.map((id) => `    EN: ${line(byId.get(id)!)}`),
        ]),
        "",
      ] : [];
    }),
  ].join("\n").trim();
}

/**
 * Napíše redakční článek z ověřených bodů (jeden opakovaný pokus) a projde ho
 * kontrolami v kódu jako writeWeeklyArticle: poznámky editoru a zmínky o vstupu
 * do revize, em dash pryč, odkazy jen na changelog, verze jen z týdne.
 */
export async function writeAssistantArticle(
  llm: LlmFn, tool: ToolKey, week: Week, rows: Row[], releases: AssistantRelease[],
  facts: Parameters<typeof articleUserMessage>[4],
): Promise<{ title: string; body: string; versionIssues: string[]; editorNotes: string[]; strippedLinks: string[] }> {
  type Written = { title?: unknown; body?: unknown };
  const valid = (w: Written) => tidy(str(w.title)).length > 0 && str(w.body).trim().length > 200;
  const user = articleUserMessage(tool, week, rows, releases, facts);
  // Bez záchrany useknutého JSON: neúplný článek se má napsat znovu.
  let written = await llmJson<Written>(llm, ARTICLE_SYSTEM_CS(toolName(tool)), user, 12000);
  if (!valid(written)) {
    written = await llmJson<Written>(llm, ARTICLE_SYSTEM_CS(toolName(tool)),
      `${user}\n\nPŘEDCHOZÍ ODPOVĚĎ BYLA NEÚPLNÁ. Vrať JSON se všemi poli: title, body (celý článek).`, 12000, 1);
  }
  if (!valid(written)) throw new Error(`assistant-cs ${tool} ${assistantWeekLabel(week)}: model nevrátil úplný článek`);

  const name = toolName(tool);
  const title = tidy(str(written.title)).replace(new RegExp(`^${name}[,:]?\\s*`, "i"), "").replace(/[.\s]+$/, "");
  // Na tělo ne tidy(): sloučilo by řádky markdownu. Nadpis h1 má stránka sama.
  const extracted = extractEditorNotes(str(written.body).trim());
  const noH1 = extracted.markdown.replace(/^#\s+[^\n]*\n+/, "").replace(/[ \t]*—[ \t]*/g, " - ").trim();
  const links = keepOnlyLinks(noH1, new Set([ASSISTANT_SOURCE_URL[tool] ?? ""].filter(Boolean)));
  const allowed = weekVersions(rows, releases);
  return {
    title,
    body: links.markdown,
    versionIssues: versionViolations(`${title}\n${links.markdown}`, allowed),
    editorNotes: [...extracted.notes, ...inputMentions(links.markdown).map((x) => `⚠️ zmínka o vstupu modelu: ${x.slice(0, 200)}`)],
    strippedLinks: links.stripped,
  };
}

/**
 * Napíše zápis týdne a projde ho kontrolami v kódu a kontrolou faktů. Bez položek
 * vrátí null (týden bez změn se nezapisuje). Síťové chyby modelu propaguje.
 */
export async function writeAssistantNote(
  tool: ToolKey, week: Week, rows: Row[], releases: AssistantRelease[], llms: AssistantLlms, now: Date,
): Promise<AssistantNote | null> {
  if (rows.length === 0) return null;
  const areas = ASSISTANT_AREAS[tool];
  if (!areas) throw new Error(`assistant-cs: nástroj ${tool} nemá seznam oblastí (ASSISTANT_AREAS)`);
  const areaKeys = new Set(areas.map((a) => a.key));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const badAreas: string[] = [];
  const cite = (v: unknown) => (Array.isArray(v) ? [...new Set(v.map(String).filter((id) => byId.has(id)))] : []);
  const toItem = (raw: RawItem): NoteBullet & { section: Section } | null => {
    const sources = cite(raw.sources);
    const text = tidy(str(raw.text));
    if (!text || sources.length === 0) return null;
    // Oddíl drží typ položky; model rozhoduje jen u Other (a u sloučení různých typů).
    const known = [...new Set(sources.map((id) => SECTION_OF_TYPE[byId.get(id)!.type]).filter((s): s is Section => !!s))];
    const asked = SECTIONS.includes(raw.section as Section) ? (raw.section as Section) : null;
    const section = known.length === 1 ? known[0]! : asked && (known.length === 0 || known.includes(asked)) ? asked : known[0] ?? "improved";
    const area = str(raw.area);
    if (area && !areaKeys.has(area)) badAreas.push(area);
    return { section, text, sources, area: areaKeys.has(area) ? area : null };
  };

  // 1) Napsání se strukturní kontrolou (jeden opakovaný pokus).
  const user = writerUserMessage(tool, week, rows, releases);
  let raw: RawNote = {};
  let problem = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    raw = await llmJson<RawNote>(llms.write, WRITER_SYSTEM_CS(toolName(tool), areas),
      problem ? `${user}\n\nPŘEDCHOZÍ ODPOVĚĎ BYLA NEÚPLNÁ: ${problem}. Vrať celý JSON znovu.` : user, 12000, attempt,
      // Týden se stovkou položek přeteče limit tokenů v items; useknuté body doplní krok 2.
      { salvageTruncated: true });
    const hl = Array.isArray(raw.highlights) ? raw.highlights as RawClaim[] : [];
    const main = (raw.main ?? {}) as RawClaim;
    const missing = [
      !tidy(str(raw.headline)) && "headline",
      !tidy(str(raw.summary)) && "summary",
      !hl.some((h) => tidy(str(h?.text)) && cite(h?.sources).length) && "highlights (aspoň 1 s citací)",
      !(tidy(str(main.text)) && cite(main.sources).length) && "main (text s citací)",
      !Array.isArray(raw.items) && "items",
    ].filter(Boolean);
    if (missing.length === 0) { problem = ""; break; }
    problem = `chybí ${missing.join(", ")}`;
  }
  if (problem) throw new Error(`assistant-cs ${tool} ${assistantWeekLabel(week)}: model nevrátil úplný zápis (${problem})`);

  let items = (raw.items as RawItem[]).map(toItem).filter((x): x is NonNullable<typeof x> => !!x);
  let highlights = (raw.highlights as RawClaim[])
    .map((h) => ({ text: tidy(str(h?.text)), sources: cite(h?.sources) }))
    .filter((h) => h.text && h.sources.length).slice(0, MAX_HIGHLIGHTS);
  let main = { text: tidy(str((raw.main as RawClaim).text)), sources: cite((raw.main as RawClaim).sources) };
  let summary = { text: tidy(str(raw.summary)), sources: [...new Set([...main.sources, ...highlights.flatMap((h) => h.sources)])] };

  // 2) Pokrytí: každá položka changelogu v některém bodu. Chybějící doplňujícími voláními
  // po dávkách (useknutý zápis jich může vynechat desítky; jedna odpověď by přetekla).
  const covered = () => new Set(items.flatMap((i) => i.sources));
  const missingIds = rows.map((r) => r.id).filter((id) => !covered().has(id));
  for (let i = 0; i < missingIds.length; i += MISSING_BATCH) {
    const batch = missingIds.slice(i, i + MISSING_BATCH);
    const extra = await llmJson<{ items?: RawItem[] }>(llms.write, MISSING_SYSTEM_CS(areas), batch.map((id) => line(byId.get(id)!)).join("\n"), 6000, 0,
      { salvageTruncated: true });
    items.push(...(extra.items ?? []).map(toItem).filter((x): x is NonNullable<typeof x> => !!x));
  }

  // 3) Kontrola faktů všech bodů (chybějící verdikt = neověřeno), jedna opravná iterace.
  type Claim = { text: string; sources: string[] };
  type Verdict = { n: unknown; supported: unknown; problem?: unknown };
  const verify = async (claims: Claim[]): Promise<{ supported: boolean; problem: string }[]> => {
    if (claims.length === 0) return [];
    const out = await llmJson<Verdict[] | Verdict>(llms.verify, VERIFY_SYSTEM_CS,
      claims.map((c, n) => `CLAIM ${n + 1}: ${c.text}\nENTRIES:\n${c.sources.map((id) => line(byId.get(id)!)).join("\n")}`).join("\n\n"), 6000);
    const list = (Array.isArray(out) ? out : [out]).map((v) => ({
      n: Number(v?.n), supported: v?.supported === true || String(v?.supported) === "true", problem: str(v?.problem),
    }));
    return claims.map((_, i) => {
      const v = list.find((x) => x.n === i + 1);
      return v ? { supported: v.supported, problem: v.problem } : { supported: false, problem: "kontrola faktů nevrátila verdikt" };
    });
  };
  const fix = async (claims: (Claim & { problem: string })[]): Promise<(string | null)[]> => {
    const out = await llmJson<{ n: unknown; text?: unknown; drop?: unknown }[] | { n: unknown; text?: unknown; drop?: unknown }>(llms.write, FIX_SYSTEM_CS,
      claims.map((c, n) => `BOD ${n + 1}: ${c.text}\nPROBLÉM: ${c.problem}\nENTRIES:\n${c.sources.map((id) => line(byId.get(id)!)).join("\n")}`).join("\n\n"), 6000);
    const list = Array.isArray(out) ? out : [out];
    return claims.map((_, i) => {
      const f = list.find((x) => Number(x?.n) === i + 1);
      return f && f.drop !== true && tidy(str(f.text)) ? tidy(str(f.text)) : null;
    });
  };
  const claims: Claim[] = [summary, main, ...highlights, ...items];
  const verdicts = await verify(claims);
  const failedIdx = verdicts.flatMap((v, i) => (v.supported ? [] : [i]));
  const dropped: { text: string; problem: string }[] = [];
  let fixedCount = 0;
  if (failedIdx.length > 0) {
    const failed = failedIdx.map((i) => ({ ...claims[i]!, problem: verdicts[i]!.problem }));
    const rewritten = await fix(failed);
    const toRecheck = failedIdx.flatMap((i, k) => (rewritten[k] ? [{ i, text: rewritten[k]! }] : []));
    const re = await verify(toRecheck.map((r) => ({ text: r.text, sources: claims[r.i]!.sources })));
    const recheck = new Map(toRecheck.map((r, k) => [r.i, { text: r.text, ...re[k]! }]));
    for (const [k, i] of failedIdx.entries()) {
      const r = recheck.get(i);
      if (r?.supported) { claims[i]!.text = r.text; fixedCount++; continue; }
      dropped.push({ text: failed[k]!.text, problem: r?.problem || failed[k]!.problem });
      (claims[i] as Claim & { dropped?: boolean }).dropped = true;
    }
  }
  const alive = <T extends Claim>(c: T) => !(c as Claim & { dropped?: boolean }).dropped;
  if (!alive(summary)) throw new Error(`assistant-cs ${tool} ${assistantWeekLabel(week)}: shrnutí neprošlo kontrolou faktů`);
  if (!alive(main)) throw new Error(`assistant-cs ${tool} ${assistantWeekLabel(week)}: hlavní změna neprošla kontrolou faktů`);
  highlights = highlights.filter(alive);
  if (highlights.length === 0) throw new Error(`assistant-cs ${tool} ${assistantWeekLabel(week)}: žádný bod highlights neprošel kontrolou faktů`);
  items = items.filter(alive);
  const uncovered = rows.map((r) => r.id).filter((id) => !covered().has(id));

  // 4) Oddíly, oblasti a počty položek changelogu (podle oddílu, kam položka padla).
  const sections: Record<Section, NoteBullet[]> = { new: [], improved: [], fixed: [] };
  for (const it of items) sections[it.section].push({ text: it.text, sources: it.sources, area: it.area });
  const sectionOfRow = new Map<string, Section>();
  for (const it of items) for (const id of it.sources) if (!sectionOfRow.has(id)) sectionOfRow.set(id, it.section);
  const counts: Record<Section, number> = { new: 0, improved: 0, fixed: 0 };
  for (const r of rows) {
    const s = SECTION_OF_TYPE[r.type] ?? sectionOfRow.get(r.id);
    if (s) counts[s]++;
  }
  const areaCount = new Map<string, number>();
  for (const it of items) if (it.area) areaCount.set(it.area, (areaCount.get(it.area) ?? 0) + it.sources.length);
  const areaOrder = areas.map((a) => a.key);
  const usedAreas = [...areaCount.entries()]
    .sort((a, b) => b[1] - a[1] || areaOrder.indexOf(a[0]) - areaOrder.indexOf(b[0])).map(([k]) => k);

  const name = toolName(tool);
  const headline = tidy(str(raw.headline)).replace(new RegExp(`^${name}[,:]?\\s*`, "i"), "").replace(/[.\s]+$/, "");

  // 5) Redakční článek z ověřených bodů.
  const article = await writeAssistantArticle(llms.write, tool, week, rows, releases,
    { summary: summary.text, main: main.text, highlights: highlights.map((h) => h.text), items, counts });
  return {
    v: 1, tool, week, builtAt: now.toISOString(),
    headline, summary: summary.text, highlights: highlights.map((h) => h.text), main: main.text,
    sections, areas: usedAreas, counts, versions: versionRange(rows, releases),
    article: { title: article.title, body: article.body },
    review: {
      dropped, fixed: fixedCount, uncovered, badAreas: [...new Set(badAreas)],
      versionIssues: article.versionIssues, editorNotes: article.editorNotes, strippedLinks: article.strippedLinks,
    },
  };
}

// ─── Soubor ───────────────────────────────────────────────────────

/** Ověří kontrakt souboru (docs/novinky-asistentu.md webu); porušení = chyba, PR by spadl na buildu. */
export function validateAssistantNote(note: AssistantNote): void {
  const allowed = new Set((ASSISTANT_AREAS[note.tool] ?? []).map((a) => a.key));
  const bad = note.areas.filter((a) => !allowed.has(a));
  if (bad.length) throw new Error(`assistant-cs: neznámé oblasti ${bad.join(", ")}`);
  if (note.highlights.length < 1 || note.highlights.length > MAX_HIGHLIGHTS) throw new Error(`assistant-cs: highlights musí mít 1–${MAX_HIGHLIGHTS} bodů`);
  if (!note.headline || !note.summary || !note.main) throw new Error("assistant-cs: chybí headline, summary nebo hlavní změna");
  if (!note.article.title || note.article.body.trim().length <= 200) throw new Error("assistant-cs: chybí článek (title, body)");
  if (/^#\s/m.test(note.article.body)) throw new Error("assistant-cs: článek nesmí mít nadpis h1, ten dává stránka");
  if (!ASSISTANT_SOURCE_URL[note.tool]) throw new Error(`assistant-cs: nástroj ${note.tool} nemá source_url`);
}

/** Poznámka o zdrojích na konec článku (verze a období z dat, ne od modelu). */
export function articleSourceNote(note: Pick<AssistantNote, "tool" | "week" | "versions">): string {
  const { start, end } = isoWeekBounds(note.week.year, note.week.week);
  const v = note.versions ? `, verze ${note.versions}` : "";
  return `*Zdroj: [changelog ${toolName(note.tool)}](${ASSISTANT_SOURCE_URL[note.tool]})${v} (týden ${czechDateRange(start, end)}). ` +
    "Funkce a limity platí k tomuto vydání a mohou se měnit z týdne na týden.*";
}

/**
 * Markdown souboru s frontmatterem podle kontraktu, tělo = redakční článek.
 * summary a highlights (rubrika, popis stránky) zůstávají z ověřených bodů.
 */
export function assistantNoteMarkdown(note: AssistantNote, date: Date = publicationDate(note)): string {
  validateAssistantNote(note);
  const w = note.week;
  const yamlList = (key: string, xs: string[]) => (xs.length ? [`${key}:`, ...xs.map((x) => `  - ${x}`)] : []);
  const body = [note.article.body.trim(), "", articleSourceNote(note), ""];
  return [
    "---",
    `title: ${yamlQuote(`${toolName(note.tool)} v týdnu ${w.week}: ${note.article.title || note.headline}`)}`,
    `date: ${date.toISOString().slice(0, 10)}`,
    `tool: ${note.tool}`,
    `week: ${w.year}-W${pad(w.week)}`,
    ...(note.versions ? [`versions: ${yamlQuote(note.versions)}`] : []),
    `summary: ${yamlQuote(note.summary)}`,
    "highlights:",
    ...note.highlights.map((h) => `  - ${yamlQuote(h)}`),
    ...yamlList("areas", note.areas),
    // Vždy všechny tři klíče (0 je platná hodnota): schéma webu je může vyžadovat.
    "counts:", ...SECTIONS.map((s) => `  ${s}: ${note.counts[s]}`),
    `source_url: ${ASSISTANT_SOURCE_URL[note.tool]}`,
    "---",
    "",
    ...body,
  ].join("\n").replace(/\n+$/, "\n");
}

// ─── Celý krok ────────────────────────────────────────────────────

export interface AssistantEnv extends LlmEnv {
  KV: KVNamespace;
  VIBECODING_SITE_GITHUB_TOKEN?: string;
  VIBECODING_SITE_REPO?: string;
}

export type AssistantOutcome =
  | { kind: "empty" }
  | { kind: "already-published"; path: string }
  | { kind: "edited-on-branch"; path: string; branch: string }
  | { kind: "no-token"; markdown: string; path: string; review: AssistantNote["review"] }
  | { kind: "pr"; pr: SitePr; review: AssistantNote["review"] };

/** Položky asistenta vydané v ISO týdnu. */
export async function assistantWeekRows(db: Db, tool: ToolKey, w: Week): Promise<Row[]> {
  const { start, end } = isoWeekBounds(w.year, w.week);
  return (await db.select().from(ccChangeItem)
    .where(and(eq(ccChangeItem.tool, tool), gte(ccChangeItem.publishedAt, start), lte(ccChangeItem.publishedAt, end))))
    .sort((a, b) => compareVersions(a.version, b.version) || a.ord - b.ord);
}

/**
 * Uzavřené ISO týdny s položkami asistenta od verze `fromVersion` (první naplnění
 * webu), nejstarší první, nejvýš do `lastClosed` včetně.
 */
export async function assistantBackfillWeeks(db: Db, tool: ToolKey, fromVersion: string, lastClosed: Week): Promise<Week[]> {
  const rows = await db.selectDistinct({ v: ccChangeItem.version, at: ccChangeItem.publishedAt }).from(ccChangeItem).where(eq(ccChangeItem.tool, tool));
  const limit = isoWeekBounds(lastClosed.year, lastClosed.week).end.getTime();
  const weeks = new Map<string, Week>();
  for (const r of rows) {
    if (compareVersions(r.v, fromVersion) < 0 || r.at.getTime() > limit) continue;
    const w = isoWeek(r.at);
    weeks.set(assistantWeekLabel(w), w);
  }
  return [...weeks.values()].sort((a, b) => a.year - b.year || a.week - b.week);
}

/**
 * Napíše zápis týdne a otevře PR do repa webu.
 * - Týden bez položek nic nezapisuje (`empty`).
 * - Bez tokenu nebo s `dryRun` jen vrátí markdown (náhled nanečisto).
 * - Zápis, který už je na výchozí větvi webu, se bez `force` nepřepisuje.
 * - Napsaný markdown se ukládá a znovu použije (retry fronty, ostrý běh po náhledu);
 *   `force` napíše nový text.
 */
export async function publishAssistantWeek(
  db: Db, env: AssistantEnv, tool: ToolKey, week: Week,
  opts: { llms?: AssistantLlms; fetch?: GhFetch; dryRun?: boolean; force?: boolean; now?: Date } = {},
): Promise<AssistantOutcome> {
  if (!isAssistantTool(tool)) throw new Error(`assistant-cs: ${tool} není osobní asistent`);
  const path = assistantNotePath(tool, week);
  const token = opts.dryRun ? undefined : env.VIBECODING_SITE_GITHUB_TOKEN;
  const repo = env.VIBECODING_SITE_REPO || DEFAULT_REPO;
  if (token && !opts.force && (await fileOnDefaultBranch(token, repo, path, opts.fetch))) return { kind: "already-published", path };

  type Cached = { format?: number; markdown: string; review: AssistantNote["review"] };
  let cached = opts.force ? null : await env.KV.get<Cached>(assistantMdKvKey(tool, week), "json");
  if (cached?.format !== MD_FORMAT) cached = null;
  if (!cached) {
    const rows = await assistantWeekRows(db, tool, week);
    if (rows.length === 0) return { kind: "empty" };
    const releases = (await env.KV.get<AssistantRelease[]>(toolReleasesKvKey(tool), "json")) ?? [];
    const llms = opts.llms ?? { write: openRouterLlm(env, writeModel(env)), verify: openRouterLlm(env, classifyModel(env)) };
    const note = await writeAssistantNote(tool, week, rows, releases, llms, opts.now ?? new Date());
    if (!note) return { kind: "empty" };
    cached = { format: MD_FORMAT, markdown: assistantNoteMarkdown(note), review: note.review };
    await env.KV.put(assistantMdKvKey(tool, week), JSON.stringify(cached), { expirationTtl: MD_TTL_SEC });
  }
  if (!token) return { kind: "no-token", markdown: cached.markdown, path, review: cached.review };

  const name = toolName(tool);
  const label = `${week.year}-W${pad(week.week)}`;
  const r = cached.review;
  const pr = await openSitePullRequest(
    token, repo, { path, content: cached.markdown },
    {
      branch: `novinky/${tool}-${assistantWeekLabel(week)}`,
      title: `Novinky ${name} ${label}`,
      body: [
        `Český týdenní článek o změnách ${name} za ${label} (\`${path}\`), napsaný z oficiálního changelogu (${ASSISTANT_SOURCE_URL[tool]}).`,
        "",
        "Kontroly v kódu:",
        ...(r.uncovered.length ? [`- ⚠️ položky changelogu bez ověřeného bodu (článek o nich neví): ${r.uncovered.join(", ")}`] : []),
        ...(r.dropped.length ? [`- ⚠️ vyřazeno kontrolou faktů: ${r.dropped.map((d) => `${d.text} (${d.problem})`).join(" / ")}`] : []),
        ...(r.fixed ? [`- opraveno po kontrole faktů: ${r.fixed}`] : []),
        ...(r.badAreas.length ? [`- zahozené neznámé oblasti: ${r.badAreas.join(", ")}`] : []),
        ...(r.versionIssues.length ? [`- ⚠️ verze v článku, které v týdnu nejsou: ${r.versionIssues.join(", ")}`] : []),
        ...(r.editorNotes.length ? [`- ⚠️ poznámky vyňaté z článku: ${r.editorNotes.join(" / ")}`] : []),
        ...(r.strippedLinks.length ? [`- odstraněné odkazy: ${r.strippedLinks.join(", ")}`] : []),
        ...(!r.uncovered.length && !r.dropped.length && !r.fixed && !r.badAreas.length && !r.versionIssues.length && !r.editorNotes.length
          ? ["- bez nálezů (pokrytí, fakta, oblasti, verze)"] : []),
        "",
        "Vydání = sloučení tohoto PR.",
        "",
        "🤖 Generated by videokurzy (tools.assistant-week)",
      ].join("\n"),
    },
    opts.fetch,
    { lastWrittenSha: await env.KV.get(assistantShaKvKey(tool, week)), overwrite: opts.force },
  );
  if ("edited" in pr) return { kind: "edited-on-branch", path: pr.path, branch: pr.branch };
  if (pr.sha) await env.KV.put(assistantShaKvKey(tool, week), pr.sha, { expirationTtl: MD_TTL_SEC });
  return { kind: "pr", pr, review: cached.review };
}
