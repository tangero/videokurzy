// Koncept článku „Novinky v Claude Code" pro týden BEZ oficiálního přehledu.
// Lokální běh, nic nepublikuje. Předpoklad: run.mts už roztřídil položky (items.json).
//
//   npx tsx scripts/cc-news-changelog/draft-week.mts <týden> <od verze> <do verze> "<období>" <výstupní složka>
//   npx tsx scripts/cc-news-changelog/draft-week.mts 38 2.1.270 2.1.278 "12.–19. září 2026" docs/cc-news-changelog
//
// Oproti run.mts (fáze 1) obsahuje opravy z porovnání s oficiálními přehledy:
//  - druhý zdroj: rozdíly v dokumentaci (Wayback snímky před/po týdnu) → Desktop, web, mobil,
//  - pokrytí: každá položka sig 3 typu Added/Changed musí skončit v článku, nebo v `skipped` se zdůvodněním,
//  - kontrola faktů novinku nevyhazuje hned: nejdřív ji nechá přeformulovat/přecitovat,
//  - perex vzniká až po kontrole faktů (nezmíní vyřazené),
//  - poznámky editoru (<!-- -->) se z článku odstraní a ukážou na recenzní stránce.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  OUT_DIR, MODEL_CLASSIFY, MODEL_WRITE, costLog, llm, llmJson, mapLimit, readJson, writeJson,
  compareVersions, fetchDocWhitelist, sha, type ChangeItem,
} from "./lib.ts";
import { topicLabel } from "../../src/lib/cc-news/taxonomy.ts";
import { renderArticle, type ParsedDigest } from "../../src/lib/cc-news/editor.ts";
import { renderMarkdown, escapeHtml as e } from "../../src/lib/markdown.ts";

const [weekArg, from, to, dateRange, outDir] = process.argv.slice(2);
if (!weekArg || !from || !to || !dateRange || !outDir) {
  throw new Error('Použití: draft-week.mts <týden> <od> <do> "<období>" <výstupní složka>');
}
const week = Number(weekArg);
const PV = { docs: "docs-v1", page: "page-v1", select: "select-v4", place: "place-v1", verify: "verify-v1", fix: "fix-v1", perex: "perex-v1", edit: "edit-v2" };

type Item = ChangeItem & { topic?: string; significance?: 1 | 2 | 3; reason?: string; follows?: { followsId: string | null; relation: string | null; reason: string } };
interface DocsChange { id: string; page: string; text: string; evidence: string }
// Signál důležitosti: nová stránka dokumentace nebo velký nový oddíl = velké téma.
interface DocsSignal { id: string; page: string; kind: "new-page" | "large-section"; words: number }

const all = readJson<Item[]>(join(OUT_DIR, "items.json"));
if (!all) throw new Error("Chybí items.json — nejdřív spusť run.mts");
const items = all.filter((i) => compareVersions(i.version, from) >= 0 && compareVersions(i.version, to) <= 0);
const byId = new Map(all.map((i) => [i.id, i]));
const whitelist = await fetchDocWhitelist();
console.log(`[week ${week}] v${from}–v${to}: ${items.length} položek, ${new Set(items.map((i) => i.version)).size} verzí`);

// ─── Druhý zdroj: rozdíly v dokumentaci (Wayback před/po týdnu) ────

const WB_DIR = join(OUT_DIR, "wayback");
mkdirSync(WB_DIR, { recursive: true });

function pageText(html: string): string[] {
  const body = html.replace(/<(script|style|nav|header|footer)[\s\S]*?<\/\1>/gi, "");
  return body
    .replace(/<\/(p|li|h\d|td|pre|div)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#x27;|&#39;|&rsquo;/g, "’").replace(/&quot;|&ldquo;|&rdquo;/g, '"')
    .split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter((l) => l.length > 40);
}

async function wayback(page: string, ts: string): Promise<string[] | null> {
  const path = join(WB_DIR, `${page.replace(/\//g, "__")}@${ts}.json`);
  const hit = readJson<string[]>(path);
  if (hit) return hit;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`https://web.archive.org/web/${ts}id_/https://code.claude.com/docs/en/${page}`);
      if (!res.ok) throw new Error(String(res.status));
      const lines = pageText(await res.text());
      writeJson(path, lines);
      return lines;
    } catch {
      await new Promise((r) => setTimeout(r, 3000 * attempt));
    }
  }
  return null;
}

const DOCS_SYSTEM = [
  "You compare two versions of one Claude Code documentation page (BEFORE and AFTER one week).",
  "You get only the lines ADDED in AFTER, plus lines REMOVED from BEFORE for context.",
  "List NEW user-facing capabilities or behaviour changes that these additions describe.",
  "Ignore rewording, renamed headings, typo fixes, reordering, links and examples that describe",
  "something that already existed. When unsure whether it is new, leave it out.",
  `Return a JSON array: [{"text": "<one sentence in English: what is new>", "evidence": "<the added line, max 200 chars>"}]. Empty array if nothing is new.`,
  "Never use the double-quote character inside text or evidence; use single quotes.",
].join("\n");

const PAGE_SYSTEM = [
  "A NEW Claude Code documentation page appeared this week. Summarise what capability it documents",
  "in 2-3 English sentences for a release digest: what it is, who gets it (plans, availability), main limits.",
  'Return JSON: {"text": "<summary>", "evidence": "<one key sentence from the page, max 200 chars>"}. No double quotes inside texts.',
].join("\n");
const LARGE_SECTION_WORDS = 400;
const signals: DocsSignal[] = [];
const words = (lines: string[]) => lines.join(" ").split(/\s+/).filter(Boolean).length;

async function docsChanges(): Promise<DocsChange[]> {
  const pairs = readJson<{ before: Record<string, string>; after: Record<string, string>; newPages?: Record<string, string> }>(join(OUT_DIR, `wb_w${week}.json`));
  if (!pairs) {
    console.log(`[docs] chybí wb_w${week}.json (páry snímků Wayback) — rozdíly dokumentace přeskočeny`);
    return [];
  }
  // Nové stránky: celá stránka je novinka, shrnutí jako jedna položka + silný signál.
  const fresh = await mapLimit(Object.entries(pairs.newPages ?? {}), 3, async ([page, ts]) => {
    const lines = await wayback(page, ts);
    if (!lines) return null;
    const out = await llmJson<{ text: string; evidence: string }>({ model: MODEL_WRITE, system: PAGE_SYSTEM, user: `PAGE: ${page}\n\n${lines.join("\n").slice(0, 60000)}`, promptVersion: PV.page, maxTokens: 1500 });
    const id = `docs:${page}#page`;
    signals.push({ id, page, kind: "new-page", words: words(lines) });
    return { id, page, text: `NEW DOCS PAGE (${words(lines)} words): ${out.text}`, evidence: out.evidence ?? "" } as DocsChange;
  });
  const pages = Object.keys(pairs.before);
  const results = await mapLimit(pages, 3, async (page) => {
    const [a, b] = [await wayback(page, pairs.before[page]!), await wayback(page, pairs.after[page]!)];
    if (!a || !b) return [] as DocsChange[];
    const before = new Set(a);
    const after = new Set(b);
    const added = b.filter((l) => !before.has(l));
    const removed = a.filter((l) => !after.has(l));
    if (added.length === 0) return [] as DocsChange[];
    const addedWords = words(added) - words(removed);
    const user = `PAGE: ${page}\n\nADDED:\n${added.join("\n")}\n\nREMOVED:\n${removed.join("\n") || "(none)"}`;
    try {
      const out = await llmJson<{ text: string; evidence: string }[]>({ model: MODEL_CLASSIFY, system: DOCS_SYSTEM, user, promptVersion: PV.docs, maxTokens: 3000 });
      const changes = out.filter((c) => c?.text).map((c, n) => ({ id: `docs:${page}#${n + 1}`, page, text: c.text, evidence: c.evidence ?? "" }));
      if (addedWords >= LARGE_SECTION_WORDS && changes.length > 0) signals.push({ id: changes[0]!.id, page, kind: "large-section", words: addedWords });
      return changes;
    } catch (err) {
      console.error(`[docs] ${page}: ${(err as Error).message}`);
      return [] as DocsChange[];
    }
  });
  return [...fresh.filter((f): f is DocsChange => !!f), ...results.flat()];
}

const docs = await docsChanges();
const docsById = new Map(docs.map((d) => [d.id, d]));
console.log(`[docs] ${docs.length} nových schopností z ${new Set(docs.map((d) => d.page)).size} stránek dokumentace · $${costLog.usd.toFixed(3)}`);

// ─── Výběr s povinným pokrytím zásadních změn ─────────────────────

const lineOf = (id: string): string => {
  const i = byId.get(id);
  if (i) return `${i.id} | ${i.type}${i.scope ? ` [${i.scope}]` : ""} | ${i.text}`;
  const d = docsById.get(id);
  return d ? `${d.id} | DOCS ${d.page} | ${d.text} (evidence: ${d.evidence})` : `${id} | ?`;
};

// Kandidáti: jen sig ≥ 2, seřazení od nejzásadnějších (stabilnější výběr než celý týden).
const candidates = items
  .filter((i) => (i.significance ?? 1) >= 2)
  .sort((a, b) => (b.significance ?? 1) - (a.significance ?? 1) || compareVersions(a.version, b.version));
const mustPlace = items.filter((i) => i.significance === 3 && (i.type === "Added" || i.type === "Changed")).map((i) => i.id);

interface Feature { title: string; version: string; lede: string; sourceIds: string[]; docLink: string | null }
interface Selection { features: Feature[]; minorWins: { text: string; sourceIds: string[] }[]; skipped: { id: string; reason: string }[] }

const SELECT_SYSTEM = [
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
  ...whitelist,
].join("\n");

const previous = readJson<{ week: number; items: string[] }>(join(OUT_DIR, `previous-w${week}.json`));
const selectUser = [
  `MUST PLACE (significance 3, Added/Changed): ${mustPlace.join(", ") || "(none)"}`,
  "",
  `DOCS SIGNALS: ${signals.map((g) => `${g.id} (${g.kind === "new-page" ? "new page" : "large new section"}, ${g.words} words)`).join("; ") || "(none)"}`,
  "",
  `PREVIOUSLY PUBLISHED (week ${previous?.week ?? "?"}):`,
  ...(previous?.items ?? []).map((t) => `- ${t}`),
  "",
  "CHANGELOG:",
  ...candidates.map((i) => `${lineOf(i.id)} | topic=${i.topic} | sig=${i.significance}`),
  "",
  "DOCS:",
  ...docs.map((d) => lineOf(d.id)),
].join("\n");

const validIds = new Set([...items.map((i) => i.id), ...docs.map((d) => d.id)]);
const wl = new Set(whitelist);
const clean = (s: Selection): Selection => ({
  features: (s.features ?? [])
    .map((f) => ({ ...f, sourceIds: (f.sourceIds ?? []).filter((id) => validIds.has(id)), docLink: f.docLink && wl.has(f.docLink) ? f.docLink : null }))
    .filter((f) => f.sourceIds.length > 0),
  minorWins: (s.minorWins ?? []).map((w) => ({ ...w, sourceIds: (w.sourceIds ?? []).filter((id) => validIds.has(id)) })).filter((w) => w.sourceIds.length > 0),
  skipped: (s.skipped ?? []).filter((k) => validIds.has(k.id)),
});

let selection = clean(await llmJson<Selection>({ model: MODEL_WRITE, system: SELECT_SYSTEM, user: selectUser, promptVersion: PV.select, maxTokens: 12000 }));

// Pokrytí: co z MUST PLACE model nezařadil, pošleme zpět k zařazení.
for (const g of signals) if (!mustPlace.includes(g.id)) mustPlace.push(g.id);
const placed = () => new Set([...selection.features.flatMap((f) => f.sourceIds), ...selection.minorWins.flatMap((w) => w.sourceIds), ...selection.skipped.map((k) => k.id)]);
let unplaced = mustPlace.filter((id) => !placed().has(id));
if (unplaced.length > 0) {
  const PLACE_SYSTEM = [
    "These significant changelog entries are missing from the weekly digest. For EACH decide:",
    "add it as a minor win, or skip it with a short reason (e.g. niche, admin-only, covered elsewhere).",
    'Return JSON: {"minorWins": [{"text", "sourceIds"}], "skipped": [{"id", "reason"}]}. No double quotes inside texts.',
  ].join("\n");
  const extra = clean({ features: [], ...(await llmJson<Omit<Selection, "features">>({
    model: MODEL_WRITE, system: PLACE_SYSTEM, user: unplaced.map(lineOf).join("\n"), promptVersion: PV.place, maxTokens: 4000,
  })) });
  selection = { ...selection, minorWins: [...selection.minorWins, ...extra.minorWins], skipped: [...selection.skipped, ...extra.skipped] };
  unplaced = mustPlace.filter((id) => !placed().has(id));
}
console.log(`[select] ${selection.features.length} novinek, ${selection.minorWins.length} drobností, ${selection.skipped.length} vynechaných, nezařazeno ${unplaced.length} · $${costLog.usd.toFixed(3)}`);

// ─── Kontrola faktů s opravou ─────────────────────────────────────

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

async function verify(fs: Feature[], tag: string) {
  if (fs.length === 0) return [] as { n: number; supported: boolean; problem: string }[];
  const claims = fs.map((f, n) => `CLAIM ${n + 1}: ${f.title}. ${f.lede}\nENTRIES:\n${f.sourceIds.map(lineOf).join("\n")}`).join("\n\n");
  return llmJson<{ n: number; supported: boolean; problem: string }[]>({ model: MODEL_CLASSIFY, system: VERIFY_SYSTEM, user: claims, promptVersion: `${PV.verify}-${tag}`, maxTokens: 4000 });
}

const weekEntries = [...candidates.map((i) => lineOf(i.id)), ...docs.map((d) => lineOf(d.id))].join("\n");
const verdicts = await verify(selection.features, "1");
const fixedLog: { before: string; after: string; problem: string }[] = [];
const dropped: { title: string; problem: string }[] = [];
const kept: Feature[] = [];
for (const [n, f] of selection.features.entries()) {
  const v = verdicts.find((x) => x.n === n + 1);
  if (!v || v.supported) { kept.push(f); continue; }
  const fix = await llmJson<Feature & { drop?: boolean }>({
    model: MODEL_WRITE, system: FIX_SYSTEM, promptVersion: PV.fix, maxTokens: 3000,
    user: `FEATURE: ${f.title}. ${f.lede}\nCITED: ${f.sourceIds.join(", ")}\nPROBLEM: ${v.problem}\n\nWEEK ENTRIES:\n${weekEntries}`,
  });
  const repaired = fix.drop ? null : clean({ features: [fix], minorWins: [], skipped: [] }).features[0];
  const re = repaired ? (await verify([repaired], `fix-${sha(repaired.lede)}`))[0] : null;
  if (repaired && (!re || re.supported)) {
    kept.push(repaired);
    fixedLog.push({ before: f.title, after: repaired.title, problem: v.problem });
  } else {
    dropped.push({ title: f.title, problem: re?.problem || v.problem });
  }
}
console.log(`[verify] ponecháno ${kept.length}, opraveno ${fixedLog.length}, vyřazeno ${dropped.length} · $${costLog.usd.toFixed(3)}`);

// ─── Perex až po kontrole faktů ───────────────────────────────────

const PEREX_SYSTEM = [
  "Write ONE English sentence characterising this week of Claude Code releases, based ONLY on the",
  "features listed (they passed fact-checking). Mention the main lines of change. No hype.",
].join("\n");
const perex = (await llm({
  model: MODEL_WRITE, system: PEREX_SYSTEM, promptVersion: PV.perex, maxTokens: 400,
  user: kept.map((f) => `- ${f.title}: ${f.lede}`).join("\n") + `\n(${items.length} changelog entries, ${new Set(items.map((i) => i.version)).size} versions)`,
})).trim();

// ─── Článek přes existující redakční vrstvu ───────────────────────

const parsed: ParsedDigest = {
  weekLabel: `Week ${week}`,
  dateRange,
  perex,
  versionRange: `v${from}–v${to}`,
  features: kept.map((f) => ({ title: f.title, version: f.version, lede: f.lede, docLink: f.docLink })),
  minorWins: selection.minorWins.map((w) => w.text),
};
const { markdown } = await renderArticle("", { CC_NEWS_LLM: "1", OPENROUTER_API_KEY: "local" }, {
  parsed,
  llm: (system, user) => llm({ model: MODEL_WRITE, system, user, promptVersion: `${PV.edit}-w${week}`, maxTokens: 10000 }),
});

// Poznámky editoru ven z článku (na recenzní stránku), odkazy mimo whitelist pryč.
const editorNotes: string[] = [];
const strippedLinks: string[] = [];
const article = markdown
  .replace(/<!--([\s\S]*?)-->\s*/g, (_m, note: string) => { editorNotes.push(note.trim()); return ""; })
  .replace(/\[([^\]]+)\]\((https:\/\/code\.claude\.com[^)\s]*)\)/g, (m, text, url) => {
    if (wl.has(url.replace(/[#?].*$/, ""))) return m;
    strippedLinks.push(url);
    return text;
  })
  .trim() + "\n";

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, `w${week}-ze-changelogu.md`), article);

// ─── Recenzní stránka ─────────────────────────────────────────────

const src = (ids: string[]) => `<ul class="src">${ids.map((id) => {
  const i = byId.get(id);
  const d = docsById.get(id);
  return `<li><code>${e(id)}</code> ${i ? `${e(i.text)} <span class="mut">· ${e(topicLabel(i.topic ?? "other"))}, význam ${i.significance}</span>` : d ? `${e(d.text)} <span class="mut">· „${e(d.evidence)}“</span>` : ""}</li>`;
}).join("")}</ul>`;

const html = `<!doctype html><html lang="cs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Week ${week} ke schválení</title>
<style>
:root{--bg:#f7f6f2;--fg:#1d1d1b;--mut:#6b6a66;--card:#fff;--line:#e3e1da;--acc:#2f5d50;--warn:#a3412b}
@media (prefers-color-scheme:dark){:root{--bg:#161615;--fg:#ecebe6;--mut:#a09e97;--card:#1f1f1d;--line:#34332f;--acc:#8cc4b3;--warn:#e48a72}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.6 system-ui,-apple-system,sans-serif}
main{max-width:1180px;margin:0 auto;padding:24px 16px 64px}h1{font-size:26px;margin:0 0 4px}h2{font-size:19px;margin:0 0 10px}h3{font-size:15px;margin:12px 0 4px}
.mut{color:var(--mut)}.box{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px;margin:0 0 20px}
.cols{display:grid;grid-template-columns:3fr 2fr;gap:20px;align-items:start}@media(max-width:900px){.cols{grid-template-columns:1fr}}
.src{font-size:13px;padding-left:18px;margin:4px 0 10px}.src code{font-size:12px}.warn{color:var(--warn)}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:16px 0 20px}.cards .box{margin:0}.cards b{display:block;font-size:22px}
.article{overflow-wrap:anywhere}
</style></head><body><main>
<h1>Week ${week} (${e(dateRange)}): koncept ke schválení</h1>
<p class="mut">Verze v${e(from)}–v${e(to)}. Oficiální přehled od Anthropicu za tento týden nevyšel; článek vznikl z changelogu Claude Code a z rozdílů v dokumentaci. Nic nebylo publikováno.</p>
<div class="cards">
 <div class="box"><b>${items.length}</b>položek changelogu</div>
 <div class="box"><b>${docs.length}</b>novinek z dokumentace</div>
 <div class="box"><b>${kept.length}</b>hlavních novinek</div>
 <div class="box"><b>${selection.minorWins.length}</b>drobností</div>
 <div class="box"><b>$${costLog.usd.toFixed(2)}</b>cena konceptu</div>
</div>
${signals.length ? `<section class="box"><h2>Signály důležitosti z dokumentace</h2><ul>${signals.map((g) => `<li><code>${e(g.id)}</code> ${g.kind === "new-page" ? "nová stránka" : "velký nový oddíl"} (${g.words} slov) → ${selection.features.some((f) => f.sourceIds.includes(g.id)) ? "<b>hlavní novinka</b>" : selection.minorWins.some((w) => w.sourceIds.includes(g.id)) ? "drobnost" : `vynecháno: ${e(selection.skipped.find((k) => k.id === g.id)?.reason ?? "?")}`}</li>`).join("")}</ul></section>` : ""}
${editorNotes.length ? `<section class="box"><h2 class="warn">Pochybnosti editoru</h2><ul>${editorNotes.map((n) => `<li>${e(n)}</li>`).join("")}</ul></section>` : ""}
${unplaced.length ? `<section class="box"><h2 class="warn">Zásadní změny, které výběr nezařadil</h2>${src(unplaced)}</section>` : ""}
<section class="cols">
 <div class="box article">${renderMarkdown(article.replace(/^---[\s\S]*?---\s*/, ""))}</div>
 <div>
  <section class="box"><h2>Odkud je každá novinka</h2>${kept.map((f) => `<h3>${e(f.title)} <span class="mut">${e(f.version)}</span></h3>${src(f.sourceIds)}`).join("")}</section>
  <section class="box"><h2>Drobnosti</h2>${selection.minorWins.map((w) => `<h3>${e(w.text)}</h3>${src(w.sourceIds)}`).join("")}</section>
  ${fixedLog.length ? `<section class="box"><h2>Opraveno kontrolou faktů</h2><ul>${fixedLog.map((x) => `<li>${e(x.before)} → <b>${e(x.after)}</b><div class="mut">${e(x.problem)}</div></li>`).join("")}</ul></section>` : ""}
  ${dropped.length ? `<section class="box"><h2>Vyřazeno kontrolou faktů</h2><ul>${dropped.map((x) => `<li>${e(x.title)}<div class="mut">${e(x.problem)}</div></li>`).join("")}</ul></section>` : ""}
  <section class="box"><h2>Vynechané zásadní změny</h2><ul>${selection.skipped.map((k) => `<li><code>${e(k.id)}</code> ${e(byId.get(k.id)?.text ?? docsById.get(k.id)?.text ?? "")}<div class="mut">${e(k.reason)}</div></li>`).join("")}</ul></section>
  ${docs.length ? `<section class="box"><h2>Všechny novinky z dokumentace</h2>${src(docs.map((d) => d.id))}<p class="mut">Pokrytí jen z archivovaných stránek (Wayback Machine), ne z celé dokumentace.</p></section>` : ""}
  ${strippedLinks.length ? `<p class="mut">Odstraněné odkazy mimo dokumentaci: ${strippedLinks.map(e).join(", ")}</p>` : ""}
 </div>
</section>
<p class="mut">Modely: ${MODEL_CLASSIFY} (třídění, dokumentace, kontrola faktů), ${MODEL_WRITE} (výběr, opravy, článek). Prompty: ${Object.values(PV).join(", ")}. ${new Date().toISOString()}.</p>
</main></body></html>`;
writeFileSync(join(outDir, `w${week}-review.html`), html);
writeJson(join(OUT_DIR, `draft-w${week}.json`), { selection, kept, dropped, fixedLog, editorNotes, unplaced, docs, perex });
console.log(`[hotovo] ${join(outDir, `w${week}-ze-changelogu.md`)}, ${join(outDir, `w${week}-review.html`)} · ${costLog.calls} volání, $${costLog.usd.toFixed(3)}`);
