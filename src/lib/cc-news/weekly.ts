// Týdenní článek „Novinky v Claude Code" ze changelogu a dokumentace
// (fáze 2, od Week 38/2026, kdy Anthropic přestal vydávat oficiální přehledy).
//
// Postup (ověřený lokálně na týdnech 33–38, viz docs/cc-news-changelog/):
//  1. položky týdne z cc_change_item (dotřídí nezatříděné, doplní návaznosti),
//  2. rozdíly v dokumentaci mezi koncem minulého a tohoto týdne + signály
//     důležitosti (nová stránka / velký nový oddíl = velké téma),
//  3. výběr 4–6 hlavních novinek a 8–12 drobností; každá zásadní změna (význam 3,
//     Added/Changed) i každý signál musí skončit v článku, nebo mít důvod vynechání,
//  4. kontrola faktů: nedoloženou novinku nejdřív přeformuluje/přecituje, vyřadí
//     až po druhém neúspěchu,
//  5. článek ve stylu „Technický článek" (redakční pravidla skillu technicky-clanek),
//  6. deterministické kontroly: čísla verzí jen z citovaných položek, odkazy jen na
//     existující stránky dokumentace, poznámky editoru (<!-- -->) ven z článku.
//
// Nic nepublikuje: výsledek jde do prepareDraftAndApproval jako dosud.

import { and, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";
import { ccChangeItem, ccNewsItem } from "../../db/schema";
import { classifyPending, linkFollowsForVersions } from "./classify";
import { compareVersions, isoWeek, isoWeekBounds, parseVersionRange, weekFromSourceId } from "./changelog-source";
import { DOCS_INDEX_KEY, diffDocsWeeks, docsWeekKey, type DocsChange, type DocsIndex, type DocsSignal } from "./docs-snapshot";
import { publishedKvKey } from "./draft";
import { classifyModel, llmJson, openRouterLlm, writeModel, type LlmEnv, type LlmFn } from "./llm";
import { topicLabel } from "./taxonomy";

type Db = ReturnType<typeof drizzle>;
type Row = typeof ccChangeItem.$inferSelect;

export interface WeeklyEnv extends LlmEnv {
  KV: KVNamespace;
}

export interface WeeklyLlms {
  classify: LlmFn;
  write: LlmFn;
}

export interface WeeklyReview {
  weekLabel: string;
  versionRange: string;
  entries: number;
  docsChanges: number;
  signals: DocsSignal[];
  features: { title: string; version: string; sourceIds: string[] }[];
  skipped: { id: string; reason: string }[];
  fixed: { title: string; problem: string }[];
  dropped: { title: string; problem: string }[];
  editorNotes: string[];
  versionIssues: string[];
  strippedLinks: string[];
}

export const reviewKvKey = (itemId: string) => `cc-news:review:${itemId}`;

const MONTHS = ["ledna", "února", "března", "dubna", "května", "června", "července", "srpna", "září", "října", "listopadu", "prosince"];

/** „14.–20. září 2026", „28. září – 4. října 2026". */
export function czechDateRange(a: Date, b: Date): string {
  const d = (x: Date) => x.getUTCDate();
  const m = (x: Date) => MONTHS[x.getUTCMonth()]!;
  if (a.getUTCMonth() === b.getUTCMonth()) return `${d(a)}.–${d(b)}. ${m(b)} ${b.getUTCFullYear()}`;
  return `${d(a)}. ${m(a)} – ${d(b)}. ${m(b)} ${b.getUTCFullYear()}`;
}

/** Z markdownu odstraní HTML komentáře (poznámky editoru) a vrátí je zvlášť. */
export function extractEditorNotes(md: string): { markdown: string; notes: string[] } {
  const notes: string[] = [];
  const markdown = md.replace(/<!--([\s\S]*?)-->\s*/g, (_m, n: string) => {
    notes.push(n.trim());
    return "";
  });
  return { markdown, notes };
}

/** Čísla verzí v textu (2.1.274, v2.1.274), která nejsou mezi povolenými. */
export function versionViolations(md: string, allowed: Set<string>): string[] {
  const found = [...md.matchAll(/\bv?(\d+\.\d+\.\d+)\b/g)].map((m) => m[1]!);
  return [...new Set(found.filter((v) => !allowed.has(v)))];
}

/** Odkazy na code.claude.com mimo existující stránky dokumentace převede na prostý text. */
export function stripUnknownDocLinks(md: string, known: Set<string>): { markdown: string; stripped: string[] } {
  const stripped: string[] = [];
  const markdown = md.replace(/\[([^\]]+)\]\((https:\/\/code\.claude\.com\/[^)\s]*)\)/g, (m, text: string, url: string) => {
    const path = url.replace(/[#?].*$/, "").replace(/^https:\/\/code\.claude\.com\/docs\/en\//, "");
    if (known.has(path)) return m;
    stripped.push(url);
    return text;
  });
  return { markdown, stripped };
}

// ─── Prompty ──────────────────────────────────────────────────────

const SELECT_SYSTEM = (docLinks: string[]) => [
  "You are the editor of a weekly 'What's new in Claude Code' digest for advanced users.",
  "Input: CHANGELOG entries of one week (significance 3 first) and DOCS entries — new capabilities",
  "found by diffing the documentation (mostly Desktop app, web, mobile, which the CLI changelog lacks).",
  "- 4–6 FEATURES: things a user can newly DO or SEE — new commands, tools, modes, output styles,",
  "  UI panels, models, settings, changed defaults. Merge entries about the same feature and cite them all.",
  "  DOCS entries are first-class: a notable Desktop/web capability deserves a feature.",
  "  Security hardening, reliability work and bundles of fixes are NOT features.",
  "- 8–12 MINOR WINS: smaller useful additions, one line each.",
  "- DOCS SIGNALS mark major topics: a NEW documentation page or a large new section means the product",
  "  team considers it important. Each signal MUST become a feature (merge with related entries), unless",
  "  it only repeats something listed under PREVIOUSLY PUBLISHED — then skip it with that reason.",
  "- Do not repeat topics from PREVIOUSLY PUBLISHED unless there is a substantial new development.",
  "- SKIPPED: every id listed under MUST PLACE that is in neither features nor minor wins, with a short reason.",
  "Write in English. Every claim must follow from the cited entries — no added context.",
  "`version` = version of the main cited changelog entry ('v2.1.274'), or 'Desktop'/'web' for DOCS-only features.",
  "`docLink`: the most relevant URL from DOCS LINKS, or null. Never output a URL not in that list.",
  'Return JSON: {"features": [{"title", "version", "lede": "<2-3 sentences>", "sourceIds": [...], "docLink"}], "minorWins": [{"text", "sourceIds"}], "skipped": [{"id", "reason"}]}',
  "Never use the double-quote character inside texts; use single quotes.",
  "",
  "DOCS LINKS:",
  ...docLinks,
].join("\n");

const PLACE_SYSTEM = [
  "These significant changelog entries are missing from the weekly digest. For EACH decide:",
  "add it as a minor win, or skip it with a short reason (e.g. niche, admin-only, covered elsewhere).",
  'Return JSON: {"minorWins": [{"text", "sourceIds"}], "skipped": [{"id", "reason"}]}. No double quotes inside texts.',
].join("\n");

const VERIFY_SYSTEM = [
  "You check claims against sources. For each CLAIM you get the cited ENTRIES.",
  `Return a JSON array: {"n": <claim number>, "supported": true|false, "problem": "<short, empty if supported>"}`,
  "supported = every factual statement follows from the entries. Paraphrase is fine; added facts,",
  "numbers, motivations or features not in the entries are not. No double quotes inside problem.",
].join("\n");

const FIX_SYSTEM = [
  "A digest feature failed fact-checking. Rewrite it so that every statement follows from entries.",
  "You may drop unsupported parts, re-cite: choose sourceIds from WEEK ENTRIES (only ids listed there).",
  'Return JSON: {"title", "version", "lede", "sourceIds": [...]} or {"drop": true} if nothing supported is left.',
  "No double quotes inside texts.",
].join("\n");

/**
 * Redakční pravidla ze skillu „Technický článek" (technicky-clanek), schválená pro
 * produkci, upravená podle redakční odezvy na W38 (bez rétorické výplně, podmínky
 * hlavní novinky, praktické detaily, závěr podle typu čtenáře).
 */
export const WRITER_SYSTEM = [
  "Jsi Patrick Zandl a píšeš pro předplatitele videokurzů týdenní článek „Novinky v Claude Code“.",
  "Čtenář je pokročilý uživatel Claude Code; nevysvětluj základy nástroje. Text má dočíst do konce,",
  "protože mu odpovídá na otázku, kterou má, a protože za ním slyší člověka s názorem.",
  "",
  "VSTUP: hlavní novinky a drobnosti týdne s citovanými položkami changelogu a dokumentace.",
  "Fakta ber VÝHRADNĚ z citovaných položek. Nic nedomýšlej: žádná čísla, ceny, limity, tarify,",
  "názvy nastavení ani verze, které ve vstupu nejsou.",
  "",
  "STRUKTURA (v tomto pořadí):",
  "- PEREX: jeden odstavec kurzívou. Otevírá problémem nebo napětím, které týden řeší, a shrnuje",
  "  nejdůležitější témata. Žádná řečnická otázka, na kterou si text sám odpoví. Zpravodajské",
  "  zdůvodnění (období, verze, počet vydání) patří do druhého odstavce.",
  "- Sekce oddělené řádkem `---`, nadpisy `## ` mířené na čtenáře (ne absolutní tvrzení).",
  "- Každý odstavec s jednou tezí začíná tučným lead-inem (**Takto.**). Odrážky jen pro výčet podmínek.",
  "- 1) HLAVNÍ TÉMA týdne nejobšírněji: co to je, jak funguje, k čemu se hodí, a PODMÍNKY, pokud jsou",
  "  ve vstupu: dostupnost a tarify, předpoklady (integrace, oprávnění), omezení (sdílení, prostředí),",
  "  čerpání limitů a pevné stropy.",
  "- 2) „Změny pro každodenní práci“: ostatní hlavní novinky.",
  "- 3) „Technické poznámky“: kratší odstavce k integracím, nástrojům a drobnostem podle oblastí.",
  "- 4) „Co si z toho odnést“ rozdělené podle čtenářů: uživatel terminálu, uživatel paralelních",
  "  sezení, správce integrací a firemních nasazení. Co má každý vyzkoušet nebo zkontrolovat.",
  "- Na konci kurzívou poznámka o zdrojích a období: changelog Claude Code (verze od–do, data)",
  "  a dokumentace; u funkcí v betě upozorni, že se dostupnost může měnit.",
  "",
  "HLAS:",
  "- Vykej čtenáři. Názor v první osobě je povolený jen tam, kde ho nesou fakta ze vstupu",
  "  (např. praktický dopad změny). Žádné nedoložené soudy a spekulace o motivech firmy",
  "  („tohle bude velké“, „ústupek konkurenci“, „důležitější, než vypadá“).",
  "- NIKDY si nevymýšlej osobní zkušenosti, zážitky ani zvyky autora („dosud jsem ručně…“, „denně mi",
  "  chybělo…“, „mně to končí u tří“).",
  "- Přiznej nejistotu („zjednodušeně řečeno“, „možná“), skepsi dej do závorky, suchý humor ano,",
  "  ironie na účet čtenáře nikdy. Marketingové superlativy (revoluční, průlomový, game changer) zakázané.",
  "- Věty začínej podmětem a přísudkem; střídej krátké a dlouhé, nikdy tři dlouhé za sebou.",
  "- Řečnická otázka s odpovědí je dobrý prostředek. Verzálky pro důraz jen výjimečně.",
  "",
  "JAZYK:",
  "- Spisovná, ale konverzační čeština. Anglicismy nahraď českými ekvivalenty, kde existují; ponech",
  "  zavedené IT termíny (token, commit, hooks, runtime, pull request, sandbox…). Žargon glosuj v závorce",
  "  při prvním použití, zkratku zaveď dřív, než ji použiješ podruhé.",
  "- Pomlčka uvnitř věty je krátká s mezerami ( - ). NIKDY em dash (—).",
  "- Zakázaný negativní paralelismus („není to A, je to B“, „nejde o A, jde o B“, „ne A, ale B“): řekni rovnou B.",
  "- Bez klišé: „V dnešní době“, „Je důležité zdůraznit“, „Klíčovou roli hraje“, „Závěrem lze konstatovat“,",
  "  řetězení „Nicméně / Kromě toho / V neposlední řadě“, pravidlo tří, „představuje“ místo „je“.",
  "- Praktické detaily ze vstupu zachovej: klávesové zkratky, názvy nastavení a proměnných, kterými",
  "  čtenář funkci zapne, vypne nebo vrátí původní chování. Neuváděj ale konfiguraci samoúčelně.",
  "  Verze uváděj jen ty, které jsou u citovaných položek.",
  "- Odkazy jen na URL dokumentace uvedené ve vstupu (pole docLink); žádné jiné nevymýšlej.",
  "",
  'VÝSTUP: JSON {"title": "<český nadpis, výstižný, bez „Week N“>", "excerpt": "<1–2 věty pro výpis článků>",',
  ' "summaryPoints": ["<4–6 vět, co je nového>"], "body": "<markdown článku BEZ nadpisu, začíná perexem>"}.',
  "Uvnitř textových hodnot nepoužívej dvojité uvozovky; v češtině piš „ “.",
].join("\n");

const VERSION_FIX_SYSTEM = [
  "Opravuješ čísla verzí v českém článku. Dostaneš článek (ARTICLE), seznam CHYBNÝCH verzí (WRONG VERSIONS,",
  "nejsou u žádné citované položky) a pro každou novinku její skutečné verze (FEATURE VERSIONS). Chybnou verzi nahraď správnou podle",
  "novinky, ke které patří, nebo ji odstraň. Jinak text NEMĚŇ. Vrať jen opravený markdown.",
].join("\n");

// ─── Uložený výběr a psaní ────────────────────────────────────────

/**
 * Ověřený výběr týdne (po kontrole faktů). Ukládá se do KV, aby z něj šlo napsat
 * článek v jiném jazyce bez nového výběru. `sources` = citované položky ve tvaru
 * „id | typ [platforma] | text“, jak je viděla kontrola faktů.
 */
export interface WeekSelection {
  v: 1;
  tool: "claude-code";
  itemId: string;
  week: { year: number; week: number };
  weekLabel: string;
  range: { from: string; to: string };
  from: string;
  to: string;
  releases: number;
  entries: number;
  features: { title: string; lede: string; docLink: string | null; versions: string[]; sources: string[] }[];
  minorWins: { text: string; versions: string[] }[];
  topics: string[];
  allowedVersions: string[];
  knownPages: string[];
}

export const selectionKvKey = (itemId: string) => `cc-news:selection:${itemId}`;

/** Jazyková varianta autora: prompty a vstup pro model. */
export interface WriterLang {
  system: string;
  versionFixSystem: string;
  user: (sel: WeekSelection) => string;
  incomplete: (missing: string) => string;
}

export interface WrittenArticle {
  title: string;
  excerpt: string;
  summaryPoints: string[];
  body: string;
  editorNotes: string[];
  versionIssues: string[];
  strippedLinks: string[];
}

/** Hodnota front matteru v dvojitých uvozovkách, na jeden řádek, bez em dashe. */
export const yamlQuote = (s: string) =>
  `"${s.trim().replace(/\s*\n\s*/g, " ").replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/—/g, "-")}"`;

/**
 * Napíše článek z uloženého výběru a projde ho kontrolami v kódu: verze jen
 * z citovaných položek (jedna opravná iterace), poznámky editoru ven, em dash
 * pryč, odkazy jen na existující stránky dokumentace.
 */
export async function writeWeeklyArticle(llm: LlmFn, sel: WeekSelection, lang: WriterLang): Promise<WrittenArticle> {
  type Written = { title: string; excerpt: string; summaryPoints: string[]; body: string };
  const valid = (w: Partial<Written> | null): w is Written =>
    !!w && typeof w.title === "string" && w.title.trim().length > 0 && typeof w.body === "string" && w.body.trim().length > 200 &&
    typeof w.excerpt === "string" && Array.isArray(w.summaryPoints) && w.summaryPoints.every((p) => typeof p === "string");
  const userMsg = lang.user(sel);
  let written = await llmJson<Partial<Written>>(llm, lang.system, userMsg, 12000);
  // Opakování s vyšší teplotou (při teplotě 0 by vrátil totéž) a s tím, co chybělo.
  if (!valid(written)) {
    written = await llmJson<Partial<Written>>(llm, lang.system, `${userMsg}\n\n${lang.incomplete("title, excerpt, summaryPoints, body (min. 200)")}`, 12000, 1);
  }
  if (!valid(written)) throw new Error("cc-news weekly: writer nevrátil úplný článek (title, excerpt, summaryPoints, body)");

  // Oprava verzí jde PŘED úklid, aby úklid (poznámky editoru, em dash) platil
  // i pro text, který vrátí opravné volání.
  let body = written.body.trim();
  const allowedVersions = new Set(sel.allowedVersions);
  let versionIssues = versionViolations(body, allowedVersions);
  if (versionIssues.length > 0) {
    const fixedBody = (await llm(
      lang.versionFixSystem,
      `WRONG VERSIONS: ${versionIssues.join(", ")}\n\nFEATURE VERSIONS:\n${sel.features.map((f) => `- ${f.title}: ${f.versions.join(", ")}`).join("\n")}\n\nARTICLE:\n${body}`,
      { maxTokens: 12000 },
    )).trim().replace(/^```(?:markdown)?\n|\n```$/g, "");
    // Opravu přijmi jen jako celý článek (ne úvodní komentář nebo useknutý text).
    if (fixedBody.length > body.length * 0.8) body = fixedBody;
    versionIssues = versionViolations(body, allowedVersions);
  }
  // Titulek, perex a shrnutí se neopravují, jen se chybné verze ukážou v revizi.
  versionIssues = [...new Set([...versionIssues, ...versionViolations([written.title, written.excerpt, ...written.summaryPoints].join("\n"), allowedVersions)])];
  const extracted = extractEditorNotes(body);
  body = extracted.markdown.replace(/—/g, " - ");
  const known = new Set(sel.knownPages);
  const linkCheck = known.size > 0 ? stripUnknownDocLinks(body, known) : { markdown: body, stripped: [] };
  return {
    title: written.title.trim().replace(/—/g, "-"),
    excerpt: written.excerpt.trim(),
    summaryPoints: written.summaryPoints.map((p) => p.trim()),
    body: linkCheck.markdown,
    editorNotes: extracted.notes,
    versionIssues,
    strippedLinks: linkCheck.stripped,
  };
}

const CZECH_WRITER: WriterLang = {
  system: WRITER_SYSTEM,
  versionFixSystem: VERSION_FIX_SYSTEM,
  user: (sel) => [
    `TÝDEN: ${sel.weekLabel}, ${czechDateRange(new Date(sel.from), new Date(sel.to))}; verze ${sel.range.from} až ${sel.range.to} (${sel.releases} vydání, ${sel.entries} položek changelogu).`,
    "",
    "HLAVNÍ NOVINKY (v pořadí důležitosti):",
    ...sel.features.map((f, n) => [
      `${n + 1}. ${f.title} | verze: ${f.versions.join(", ")} | docLink: ${f.docLink ?? "-"}`,
      `   ${f.lede}`,
      ...f.sources.map((l) => `   - ${l}`),
    ].join("\n")),
    "",
    "DROBNOSTI:",
    ...sel.minorWins.map((w) => `- ${w.text} | verze: ${w.versions.join(", ") || "-"}`),
    "",
    "TÉMATA (pro kontext, ne pro výčet): " + sel.topics.map(topicLabel).join(", "),
  ].join("\n"),
  incomplete: (missing) => `PŘEDCHOZÍ ODPOVĚĎ BYLA NEÚPLNÁ. Vrať JSON se všemi poli: ${missing}.`,
};

// ─── Stavba článku ────────────────────────────────────────────────

interface Feature { title: string; version: string; lede: string; sourceIds: string[]; docLink: string | null }
interface Selection { features: Feature[]; minorWins: { text: string; sourceIds: string[] }[]; skipped: { id: string; reason: string }[] }

async function loadWeekRows(db: Db, versions: string[]): Promise<Row[]> {
  const rows: Row[] = [];
  for (let i = 0; i < versions.length; i += 90) {
    rows.push(...await db.select().from(ccChangeItem).where(inArray(ccChangeItem.version, versions.slice(i, i + 90))));
  }
  return rows.sort((a, b) => compareVersions(a.version, b.version) || a.ord - b.ord);
}

/** Témata posledního vydaného článku (aby se neopakovala). */
async function previousTopics(db: Db, kv: KVNamespace, itemId: string): Promise<string[]> {
  const rows = await db
    .select({ id: ccNewsItem.id, sourceId: ccNewsItem.sourceId, publishedAt: ccNewsItem.publishedAt })
    .from(ccNewsItem)
    .where(and(eq(ccNewsItem.status, "published"), ne(ccNewsItem.id, itemId)))
    .orderBy(desc(ccNewsItem.publishedAt))
    .limit(1);
  const prev = rows[0];
  if (!prev) return [];
  const md = (await kv.get(publishedKvKey(prev.id))) ?? "";
  // Body jen ze summary_points (ne categories z front matteru), nadpisy jen z těla.
  const fm = md.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
  const pointsBlock = fm.match(/^summary_points:\n((?:- .*\n?)+)/m)?.[1] ?? "";
  const points = [...pointsBlock.matchAll(/^- (.+)$/gm)].map((m) => m[1]!.replace(/^"|"$/g, ""));
  const body = md.replace(/^---[\s\S]*?\n---\n?/, "");
  const heads = [...body.matchAll(/^##? (.+)$/gm)].map((m) => m[1]!);
  return [...points, ...heads].slice(0, 20);
}

export interface WeeklyArticle {
  markdown: string;
  weekLabel: string;
  versionRange: string;
  review: WeeklyReview;
}

/**
 * Sestaví článek pro vydání `/changelog/<rok>-w<týden>`. Rozsah verzí bere
 * z `versionRange` řádku (nastavený při vytvoření vydání).
 */
export async function buildChangelogArticle(
  db: Db, env: WeeklyEnv, itemId: string, now: Date,
  llms: WeeklyLlms = { classify: openRouterLlm(env, classifyModel(env)), write: openRouterLlm(env, writeModel(env)) },
): Promise<WeeklyArticle> {
  const [item] = await db.select().from(ccNewsItem).where(eq(ccNewsItem.id, itemId)).limit(1);
  if (!item) throw new Error(`cc-news weekly: vydání ${itemId} neexistuje`);
  const week = weekFromSourceId(item.sourceId);
  const range = parseVersionRange(item.versionRange);
  if (!week || !range) throw new Error(`cc-news weekly: vydání ${itemId} nemá týden nebo rozsah verzí`);
  const weekLabel = `Week ${week.week}`;

  // 1) Položky týdne: dotřídit, doplnit návaznosti.
  const allVersions = (await db.selectDistinct({ v: ccChangeItem.version }).from(ccChangeItem)).map((r) => r.v);
  const versions = allVersions
    .filter((v) => compareVersions(v, range.from) >= 0 && compareVersions(v, range.to) <= 0)
    .sort(compareVersions);
  if (versions.length === 0) throw new Error(`cc-news weekly: v ${item.versionRange} nejsou žádné položky`);
  const unclassified = await db.select({ id: ccChangeItem.id }).from(ccChangeItem)
    .where(and(inArray(ccChangeItem.version, versions.slice(0, 90)), isNull(ccChangeItem.classifiedAt))).limit(1);
  // Jen verze tohoto týdne: globální backlog by konzumenta zdržel před psaním.
  if (unclassified.length > 0) await classifyPending(db, env, now, 1000, llms.classify, versions);
  await linkFollowsForVersions(db, env, versions, llms.classify);
  const rows = await loadWeekRows(db, versions);
  const byId = new Map(rows.map((r) => [r.id, r]));

  // 2) Dokumentace: konec minulého týdne vs. konec tohoto.
  // Předchozí ISO týden (rok může mít 53 týdnů, proto ne „week − 1 / 52").
  const prevWeek = isoWeek(new Date(isoWeekBounds(week.year, week.week).start.getTime() - 86_400_000));
  const [afterIdx, beforeIdx, currentIdx] = await Promise.all([
    env.KV.get<DocsIndex>(docsWeekKey(week), "json"),
    env.KV.get<DocsIndex>(docsWeekKey(prevWeek), "json"),
    env.KV.get<DocsIndex>(DOCS_INDEX_KEY, "json"),
  ]);
  let docs: DocsChange[] = [];
  let signals: DocsSignal[] = [];
  if (afterIdx && beforeIdx) {
    ({ changes: docs, signals } = await diffDocsWeeks(env.KV, beforeIdx, afterIdx, llms.classify, llms.write));
  } else {
    console.log(`[cc-news] ${weekLabel}: chybí týdenní snímky dokumentace, článek jen ze changelogu`);
  }
  const docsById = new Map(docs.map((d) => [d.id, d]));
  const knownPages = new Set(Object.keys((afterIdx ?? currentIdx)?.pages ?? {}));
  const docLinks = [...knownPages].map((p) => `https://code.claude.com/docs/en/${p}`);

  const lineOf = (id: string): string => {
    const r = byId.get(id);
    if (r) return `${r.id} | ${r.type}${r.scope ? ` [${r.scope}]` : ""} | ${r.text}`;
    const d = docsById.get(id);
    return d ? `${d.id} | DOCS ${d.page} | ${d.text} (evidence: ${d.evidence})` : `${id} | ?`;
  };

  // 3) Výběr s povinným pokrytím.
  const candidates = rows
    .filter((r) => (r.significance ?? 1) >= 2)
    .sort((a, b) => (b.significance ?? 1) - (a.significance ?? 1) || compareVersions(a.version, b.version));
  const mustPlace = [
    ...rows.filter((r) => r.significance === 3 && (r.type === "Added" || r.type === "Changed")).map((r) => r.id),
    ...signals.map((s) => s.id),
  ];
  const previous = await previousTopics(db, env.KV, itemId);
  const validIds = new Set([...rows.map((r) => r.id), ...docs.map((d) => d.id)]);
  const docLinkSet = new Set(docLinks);
  const clean = (s: Partial<Selection>): Selection => ({
    features: (s.features ?? [])
      .map((f) => ({ ...f, sourceIds: (f.sourceIds ?? []).filter((id) => validIds.has(id)), docLink: f.docLink && docLinkSet.has(f.docLink) ? f.docLink : null }))
      .filter((f) => f.sourceIds.length > 0),
    minorWins: (s.minorWins ?? []).map((w) => ({ ...w, sourceIds: (w.sourceIds ?? []).filter((id) => validIds.has(id)) })).filter((w) => w.sourceIds.length > 0),
    skipped: (s.skipped ?? []).filter((k) => validIds.has(k.id)),
  });

  const selectUser = [
    `MUST PLACE (significance 3, Added/Changed, and docs signals): ${mustPlace.join(", ") || "(none)"}`,
    "",
    `DOCS SIGNALS: ${signals.map((g) => `${g.id} (${g.kind === "new-page" ? "new page" : "large new section"}, ${g.words} words)`).join("; ") || "(none)"}`,
    "",
    "PREVIOUSLY PUBLISHED:",
    ...(previous.length ? previous.map((t) => `- ${t}`) : ["(none)"]),
    "",
    "CHANGELOG:",
    ...candidates.map((r) => `${lineOf(r.id)} | topic=${r.topic} | sig=${r.significance}`),
    "",
    "DOCS:",
    ...docs.map((d) => lineOf(d.id)),
  ].join("\n");
  let selection = clean(await llmJson<Selection>(llms.write, SELECT_SYSTEM(docLinks), selectUser, 12000));

  const placed = () => new Set([...selection.features.flatMap((f) => f.sourceIds), ...selection.minorWins.flatMap((w) => w.sourceIds), ...selection.skipped.map((k) => k.id)]);
  const unplaced = mustPlace.filter((id) => !placed().has(id));
  if (unplaced.length > 0) {
    const extra = clean(await llmJson<Partial<Selection>>(llms.write, PLACE_SYSTEM, unplaced.map(lineOf).join("\n"), 4000));
    selection = { ...selection, minorWins: [...selection.minorWins, ...extra.minorWins], skipped: [...selection.skipped, ...extra.skipped] };
    // Co model nezařadil ani napodruhé, musí být vidět v revizi.
    const still = mustPlace.filter((id) => !placed().has(id));
    selection.skipped.push(...still.map((id) => ({ id, reason: "model neumístil" })));
  }

  // 4) Kontrola faktů s opravou.
  type Verdict = { n: unknown; supported: unknown; problem: string };
  const verify = async (fs: Feature[]): Promise<Verdict[]> => {
    if (fs.length === 0) return [];
    const out = await llmJson<Verdict[] | Verdict>(
      llms.classify, VERIFY_SYSTEM,
      fs.map((f, n) => `CLAIM ${n + 1}: ${f.title}. ${f.lede}\nENTRIES:\n${f.sourceIds.map(lineOf).join("\n")}`).join("\n\n"), 4000,
    );
    // U jediného claimu model občas vrátí objekt místo pole.
    return Array.isArray(out) ? out : [out];
  };
  const weekEntries = [...candidates.map((r) => lineOf(r.id)), ...docs.map((d) => lineOf(d.id))].join("\n");
  // Model občas vrátí n nebo supported jako řetězec — sjednotit, jinak by find() nic nenašel
  // a nedoložená novinka by prošla jako ověřená.
  const norm = (v: Verdict) =>
    ({ n: Number(v.n), supported: v.supported === true || String(v.supported) === "true", problem: v.problem ?? "" });
  const verdicts = (await verify(selection.features)).map(norm);
  const kept: Feature[] = [];
  const fixed: { title: string; problem: string }[] = [];
  const dropped: { title: string; problem: string }[] = [];
  for (const [n, f] of selection.features.entries()) {
    const v = verdicts.find((x) => x.n === n + 1);
    // Chybějící verdikt = neověřeno, ne „v pořádku“.
    if (v?.supported) { kept.push(f); continue; }
    const problem = v?.problem || "kontrola faktů nevrátila verdikt";
    const fix = await llmJson<Feature & { drop?: boolean }>(llms.write, FIX_SYSTEM,
      `FEATURE: ${f.title}. ${f.lede}\nCITED: ${f.sourceIds.join(", ")}\nPROBLEM: ${problem}\n\nWEEK ENTRIES:\n${weekEntries}`, 3000);
    const repaired = fix.drop ? null : clean({ features: [fix] }).features[0];
    const reRaw = repaired ? (await verify([repaired]))[0] : null;
    const re = reRaw ? norm(reRaw) : null;
    if (repaired && re?.supported) {
      kept.push(repaired);
      fixed.push({ title: repaired.title, problem });
    } else {
      dropped.push({ title: f.title, problem: re?.problem || problem });
    }
  }

  // 5) Ověřený výběr se uloží: z téhož výběru píše i jiný jazyk (english.ts).
  const dates = rows.map((r) => r.publishedAt);
  const featureVersions = (f: { sourceIds: string[] }) =>
    [...new Set(f.sourceIds.map((id) => byId.get(id)?.version).filter((v): v is string => !!v))];
  const sel: WeekSelection = {
    v: 1,
    tool: "claude-code",
    itemId,
    week,
    weekLabel,
    range,
    from: new Date(Math.min(...dates.map(Number))).toISOString(),
    to: new Date(Math.max(...dates.map(Number))).toISOString(),
    releases: versions.length,
    entries: rows.length,
    features: kept.map((f) => ({
      title: f.title, lede: f.lede, docLink: f.docLink,
      versions: featureVersions(f).length ? featureVersions(f) : [f.version],
      sources: f.sourceIds.map(lineOf),
    })),
    minorWins: selection.minorWins.map((w) => ({ text: w.text, versions: featureVersions(w) })),
    topics: [...new Set(kept.flatMap((f) => f.sourceIds.map((id) => byId.get(id)?.topic).filter((t): t is string => !!t)))],
    allowedVersions: [...new Set([...versions, range.from, range.to])],
    knownPages: [...knownPages],
  };
  await env.KV.put(selectionKvKey(itemId), JSON.stringify(sel));

  // 6) Článek a deterministické kontroly.
  const written = await writeWeeklyArticle(llms.write, sel, CZECH_WRITER);
  const versionRange = `v${range.from}–v${range.to}`;
  const markdown = [
    "---",
    "author: Patrick Zandl",
    "categories:",
    "- AI",
    "- Claude Code",
    "- Anthropic",
    "- Vývojářské nástroje",
    "layout: post",
    `title: ${yamlQuote(written.title)}`,
    `post_excerpt: ${yamlQuote(written.excerpt)}`,
    "summary_points:",
    ...written.summaryPoints.map((p) => `- ${yamlQuote(p)}`),
    "---",
    "",
    `# ${written.title}`,
    "",
    written.body,
    "",
  ].join("\n");

  return {
    markdown,
    weekLabel,
    versionRange,
    review: {
      weekLabel, versionRange, entries: rows.length, docsChanges: docs.length, signals,
      features: kept.map((f) => ({ title: f.title, version: f.version, sourceIds: f.sourceIds })),
      skipped: selection.skipped, fixed, dropped,
      editorNotes: written.editorNotes, versionIssues: written.versionIssues, strippedLinks: written.strippedLinks,
    },
  };
}
