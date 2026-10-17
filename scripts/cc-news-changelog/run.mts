// Fáze 1 experimentu „Novinky v CC ze changelogu" — lokální běh, BEZ produkce.
//
//   npx tsx scripts/cc-news-changelog/run.mts
//
// 1) stáhne releases Claude Code od 2.1.200 (gh api) + whitelist dokumentace,
// 2) Haiku roztřídí každou položku do tématu z taxonomy.ts a ohodnotí význam,
// 3) Haiku u významných položek určí, na kterou dřívější položku navazují,
// 4) Sonnet z položek týdne vybere hlavní novinky a drobnosti (ParsedDigest),
//    Haiku ověří, že každá novinka má oporu v citovaných položkách,
// 5) existující redakční vrstva (renderArticle) z toho napíše článek,
// 6) Sonnet porovná výběr s oficiálním přehledem Anthropicu (týdny 33–37),
// 7) vše skončí v HTML reportu v CC_OUT_DIR (výchozí .cc-news-out/).
//
// Nic se nezapisuje do D1/KV, neposílá e-mail ani nepublikuje.

import { join } from "node:path";
import { writeFileSync } from "node:fs";
import {
  OUT_DIR, MODEL_CLASSIFY, MODEL_WRITE, costLog, llm, llmJson, mapLimit,
  fetchReleases, fetchDocWhitelist, compareVersions, writeJson, type ChangeItem,
} from "./lib.ts";
import { TOPICS, TOPIC_KEYS, topicLabel } from "../../src/lib/cc-news/taxonomy.ts";
import {
  parseDigest, renderArticle, type ParsedDigest, type DigestFeature,
} from "../../src/lib/cc-news/editor.ts";
import { detailMarkdownUrl } from "../../src/lib/cc-news/detect.ts";
import { renderMarkdown, escapeHtml } from "../../src/lib/markdown.ts";

// Oficiální přehledy Anthropicu a jejich rozsahy verzí (z produkční cc_news_item).
const OFFICIAL_WEEKS = [
  { week: 33, from: "2.1.225", to: "2.1.233" },
  { week: 34, from: "2.1.234", to: "2.1.239" },
  { week: 35, from: "2.1.240", to: "2.1.250" },
  { week: 36, from: "2.1.251", to: "2.1.261" },
  { week: 37, from: "2.1.263", to: "2.1.269" },
];
const TIMELINE_TOPIC = "prompt_cache";
const PV = { classify: "classify-v2", follow: "follow-v2", select: "select-v2", verify: "verify-v1", judge: "judge-v1", edit: "edit-v1" };

interface Classified { id: string; topic: string; significance: 1 | 2 | 3; reason: string }
interface Follow { id: string; followsId: string | null; relation: string | null; reason: string }
type Item = ChangeItem & Partial<Classified> & { follows?: Follow };

const line = (i: Item) => `${i.id} | ${i.type}${i.scope ? ` [${i.scope}]` : ""} | ${i.text}`;

// ─── 2) Třídění ───────────────────────────────────────────────────

const CLASSIFY_SYSTEM = [
  "You classify Claude Code changelog entries. For EACH entry return one object:",
  `{"id": "<id>", "topic": "<topic key>", "significance": 1|2|3, "reason": "<max 12 words, Czech>"}`,
  "",
  "Topic = the ONE key that best matches what the entry is about. Use only these keys:",
  ...TOPICS.map((t) => `- ${t.key}: ${t.description}`),
  "",
  "Significance (for an advanced Claude Code user):",
  "3 = new user-visible capability (a new command, tool, mode, output style, panel, setting a user",
  "    would turn on), a new model, changed default behaviour, removal/breaking change",
  "2 = noticeable improvement, security hardening, or fix of a problem many users hit",
  "1 = niche/platform-specific fix, cosmetic change, wording, rare edge case",
  "",
  "Answer with a JSON array only, same order and count as the input.",
  "Never use the double-quote character inside reason; use „ “ if you must quote.",
].join("\n");

async function classify(items: Item[]): Promise<Map<string, Classified>> {
  const batches: Item[][] = [];
  for (let i = 0; i < items.length; i += 50) batches.push(items.slice(i, i + 50));
  // Dávka, která ani po opakování nevrátí platný JSON, se rozpůlí (kratší
  // odpověď = menší šance na useknutí nebo rozbitou uvozovku).
  const classifyBatch = async (batch: Item[]): Promise<Classified[]> => {
    try {
      return await llmJson<Classified[]>({ model: MODEL_CLASSIFY, system: CLASSIFY_SYSTEM, user: batch.map(line).join("\n"), promptVersion: PV.classify, maxTokens: 6000 });
    } catch (err) {
      if (batch.length <= 5) {
        console.error(`[classify] dávka ${batch[0]!.id} (${batch.length}) přeskočena: ${(err as Error).message}`);
        return [];
      }
      const half = Math.ceil(batch.length / 2);
      return [...(await classifyBatch(batch.slice(0, half))), ...(await classifyBatch(batch.slice(half)))];
    }
  };
  const results = await mapLimit(batches, 4, classifyBatch);
  const map = new Map<string, Classified>();
  for (const c of results.flat()) {
    if (!c?.id) continue;
    map.set(c.id, {
      id: c.id,
      topic: TOPIC_KEYS.has(c.topic) ? c.topic : "other",
      significance: ([1, 2, 3] as const).includes(c.significance) ? c.significance : 1,
      reason: String(c.reason ?? ""),
    });
  }
  return map;
}

// ─── 3) Návaznost ─────────────────────────────────────────────────

const FOLLOW_SYSTEM = [
  "You link Claude Code changelog entries to EARLIER entries of the same topic.",
  "You get HISTORY (earlier entries) and NEW entries. For each NEW entry decide whether it",
  "directly continues a specific earlier entry: extends the same feature, fixes/regresses it,",
  "changes its default, or adds a setting for it. Shared topic alone is NOT enough.",
  "The earlier entry may also be a NEW entry listed above it.",
  `Return a JSON array: {"id": "<new id>", "followsId": "<earlier id>" | null, "relation": "rozšiřuje"|"opravuje"|"mění"|"nastavení" | null, "reason": "<max 15 words, Czech>"}`,
  "Use null when there is no clear direct predecessor. Never invent ids.",
  "Never use the double-quote character inside reason; use „ “ if you must quote.",
].join("\n");

async function linkFollows(items: Item[]): Promise<Map<string, Follow>> {
  const significant = items.filter((i) => (i.significance ?? 1) >= 2);
  const byTopic = new Map<string, Item[]>();
  for (const i of significant) {
    if (i.topic === "other") continue;
    byTopic.set(i.topic!, [...(byTopic.get(i.topic!) ?? []), i]);
  }
  // Úlohy: téma × skupina ~6 verzí; historie = posledních 25 položek tématu před skupinou.
  const tasks: { history: Item[]; fresh: Item[] }[] = [];
  for (const list of byTopic.values()) {
    const versions = [...new Set(list.map((i) => i.version))];
    for (let v = 0; v < versions.length; v += 6) {
      const group = new Set(versions.slice(v, v + 6));
      const fresh = list.filter((i) => group.has(i.version));
      const firstIdx = list.indexOf(fresh[0]!);
      tasks.push({ history: list.slice(Math.max(0, firstIdx - 25), firstIdx), fresh });
    }
  }
  const order = new Map(items.map((i, n) => [i.id, n]));
  const results = await mapLimit(tasks, 4, async ({ history, fresh }) => {
    if (history.length === 0 && fresh.length < 2) return [] as Follow[];
    const user = `HISTORY:\n${history.map(line).join("\n") || "(none)"}\n\nNEW:\n${fresh.map(line).join("\n")}`;
    const known = new Set([...history, ...fresh].map((i) => i.id));
    try {
      const out = await llmJson<Follow[]>({ model: MODEL_CLASSIFY, system: FOLLOW_SYSTEM, user, promptVersion: PV.follow, maxTokens: 6000 });
      return out.filter(
        (f) => f?.id && (!f.followsId || (known.has(f.followsId) && order.get(f.followsId)! < order.get(f.id)!)),
      );
    } catch (err) {
      console.error(`[follow] ${fresh[0]!.topic} ${fresh[0]!.version}: ${(err as Error).message}`);
      return [] as Follow[];
    }
  });
  return new Map(results.flat().map((f) => [f.id, f]));
}

// ─── 4) Výběr novinek týdne ───────────────────────────────────────

interface SelectedFeature { title: string; version: string; lede: string; sourceIds: string[]; docLink: string | null }
interface Selection { perex: string; features: SelectedFeature[]; minorWins: { text: string; sourceIds: string[] }[] }

function selectSystem(whitelist: string[]): string {
  return [
    "You are the editor of a weekly 'What's new in Claude Code' digest, written for advanced users.",
    "From the changelog entries of one week, pick what matters, the way Anthropic's own weekly digest does:",
    "- 4–6 FEATURES: things a user can newly DO or SEE — new commands, tools, modes, output styles,",
    "  UI panels, models, settings, changed defaults. Anthropic's digest headlines are almost always",
    "  such 'Added …' items. Prefer significance 3, then 2. Merge entries about the same feature.",
    "  Security hardening, reliability work and bundles of fixes are NOT features: at most one minor win.",
    "- 8–12 MINOR WINS: smaller but useful additions/improvements, one line each.",
    "Write in English (a later step translates). Every claim must be supported by the cited entries;",
    "do not add context that is not in them. `version` = version of the main cited entry, like 'v2.1.263'.",
    "`docLink`: the single most relevant URL from the DOCS list below, or null. Never output a URL not in the list.",
    "",
    'Return JSON: {"perex": "<one sentence on the character of the week>", "features": [{"title", "version", "lede": "<2-3 sentences>", "sourceIds": ["2.1.263#4"], "docLink"}], "minorWins": [{"text", "sourceIds"}]}',
    "",
    "DOCS:",
    ...whitelist,
  ].join("\n");
}

const VERIFY_SYSTEM = [
  "You check claims against sources. For each CLAIM you get the cited changelog ENTRIES.",
  `Return a JSON array: {"n": <claim number>, "supported": true|false, "problem": "<short, empty if supported>"}`,
  "supported = every factual statement in the claim follows from the entries. Paraphrase is fine;",
  "added facts, numbers, motivations or features not in the entries are not.",
].join("\n");

async function buildDigest(
  week: (typeof OFFICIAL_WEEKS)[number], weekItems: Item[], byId: Map<string, Item>, whitelist: string[],
): Promise<{ parsed: ParsedDigest; dropped: { title: string; problem: string }[]; selection: Selection }> {
  const user = weekItems.map((i) => `${line(i)} | topic=${i.topic} | sig=${i.significance}`).join("\n");
  const selection = await llmJson<Selection>({ model: MODEL_WRITE, system: selectSystem(whitelist), user, promptVersion: PV.select, maxTokens: 10000 });

  // Deterministická kontrola: citované id existují a patří do týdne; odkaz z whitelistu.
  const inWeek = new Set(weekItems.map((i) => i.id));
  const wl = new Set(whitelist);
  const features = selection.features
    .map((f) => ({ ...f, sourceIds: (f.sourceIds ?? []).filter((id) => inWeek.has(id)), docLink: f.docLink && wl.has(f.docLink) ? f.docLink : null }))
    .filter((f) => f.sourceIds.length > 0);

  // Ověření modelem: každá novinka musí mít oporu v citovaných položkách.
  const claims = features.map((f, n) =>
    `CLAIM ${n + 1}: ${f.title}. ${f.lede}\nENTRIES:\n${f.sourceIds.map((id) => line(byId.get(id)!)).join("\n")}`,
  ).join("\n\n");
  const verdicts = await llmJson<{ n: number; supported: boolean; problem: string }[]>(
    { model: MODEL_CLASSIFY, system: VERIFY_SYSTEM, user: claims, promptVersion: PV.verify, maxTokens: 4000 },
  );
  const dropped: { title: string; problem: string }[] = [];
  const kept = features.filter((f, n) => {
    const v = verdicts.find((x) => x.n === n + 1);
    if (v && !v.supported) dropped.push({ title: f.title, problem: v.problem });
    return !v || v.supported;
  });

  const parsed: ParsedDigest = {
    weekLabel: `Week ${week.week}`,
    dateRange: null,
    perex: selection.perex,
    versionRange: `v${week.from}–v${week.to}`,
    features: kept.map<DigestFeature>((f) => ({ title: f.title, version: f.version, lede: f.lede, docLink: f.docLink })),
    minorWins: selection.minorWins.filter((w) => (w.sourceIds ?? []).some((id) => inWeek.has(id))).map((w) => w.text),
  };
  return { parsed, dropped, selection };
}

// ─── 5) Článek přes existující redakční vrstvu ────────────────────

async function writeArticle(parsed: ParsedDigest, whitelist: string[], tag: string): Promise<{ md: string; strippedLinks: string[] }> {
  const { markdown } = await renderArticle("", { CC_NEWS_LLM: "1", OPENROUTER_API_KEY: "local" }, {
    parsed,
    llm: (system, user) => llm({ model: MODEL_WRITE, system, user, promptVersion: `${PV.edit}-${tag}`, maxTokens: 8000 }),
  });
  // Pojistka: redakční prompt chce „odkaz na dokumentaci" a u vstupu bez odkazu
  // si ho umí vymyslet. Každou code.claude.com URL mimo whitelist odstraníme.
  const wl = new Set(whitelist);
  const strippedLinks: string[] = [];
  const md = markdown
    .replace(/\[([^\]]+)\]\((https:\/\/code\.claude\.com[^)\s]*)\)/g, (m, text, url) => {
      if (wl.has(url.replace(/[#?].*$/, ""))) return m;
      strippedLinks.push(url);
      return text;
    })
    .replace(/(?<!\()https:\/\/code\.claude\.com\/[^\s)<>,]*[^\s)<>,.]/g, (url) => {
      if (wl.has(url.replace(/[#?].*$/, ""))) return url;
      strippedLinks.push(url);
      return "";
    })
    .replace(/ Dokumentace: \./g, "");
  return { md, strippedLinks };
}

// ─── 6) Porovnání s oficiálním přehledem ──────────────────────────

const JUDGE_SYSTEM = [
  "Compare two selections of headline features for the same week of Claude Code releases:",
  "OFFICIAL (Anthropic's weekly digest) and OURS (generated from the changelog).",
  "Match features that describe the same change (wording may differ).",
  `Return JSON: {"matches": [{"official": <n>, "ours": <n>}], "missedOfficial": [<n>], "extraOurs": [<n>], "verdict": "<2-3 sentences in Czech: how close the selections are and what the main differences are>"}`,
].join("\n");

interface Judgement { matches: { official: number; ours: number }[]; missedOfficial: number[]; extraOurs: number[]; verdict: string }

async function judge(official: ParsedDigest, ours: ParsedDigest): Promise<Judgement> {
  const fmt = (fs: DigestFeature[]) => fs.map((f, n) => `${n + 1}. ${f.title} (${f.version ?? "?"}): ${f.lede}`).join("\n");
  const user = `OFFICIAL:\n${fmt(official.features)}\n\nOURS:\n${fmt(ours.features)}`;
  return llmJson<Judgement>({ model: MODEL_WRITE, system: JUDGE_SYSTEM, user, promptVersion: PV.judge, maxTokens: 6000 });
}

// ─── Hlavní běh ───────────────────────────────────────────────────

const t0 = Date.now();
// CC_MIN_VERSION=0.2.0 zpracuje celou historii (od dubna 2025).
const items: Item[] = await fetchReleases(process.env.CC_MIN_VERSION ?? "2.1.200");
const whitelist = await fetchDocWhitelist();
const byId = new Map(items.map((i) => [i.id, i]));
console.log(`[data] ${items.length} položek, ${new Set(items.map((i) => i.version)).size} verzí, whitelist ${whitelist.length}`);

const classified = await classify(items);
for (const i of items) Object.assign(i, classified.get(i.id) ?? { topic: "other", significance: 1, reason: "nezatříděno" });
console.log(`[classify] zatříděno ${classified.size}/${items.length} · $${costLog.usd.toFixed(3)}`);

const follows = await linkFollows(items);
for (const i of items) i.follows = follows.get(i.id);
console.log(`[follow] vazeb ${[...follows.values()].filter((f) => f.followsId).length} · $${costLog.usd.toFixed(3)}`);
writeJson(join(OUT_DIR, "items.json"), items);

const weeks = await mapLimit(OFFICIAL_WEEKS, 2, async (w) => {
  const weekItems = items.filter((i) => compareVersions(i.version, w.from) >= 0 && compareVersions(i.version, w.to) <= 0);
  const officialMd = await (await fetch(detailMarkdownUrl(`/docs/en/whats-new/2026-w${w.week}`))).text();
  const official = parseDigest(officialMd);
  const ours = await buildDigest(w, weekItems, byId, whitelist);
  const [oursArticle, officialArticle, verdict] = await Promise.all([
    writeArticle(ours.parsed, whitelist, `ours-w${w.week}`),
    writeArticle(official, whitelist, `official-w${w.week}`),
    judge(official, ours.parsed),
  ]);
  console.log(`[week ${w.week}] ${weekItems.length} položek · shoda ${verdict.matches.length}/${official.features.length} · $${costLog.usd.toFixed(3)}`);
  return { ...w, count: weekItems.length, official, ours, oursArticle, officialArticle, verdict };
});
writeJson(join(OUT_DIR, "weeks.json"), weeks);

// ─── 7) Report ────────────────────────────────────────────────────

const pct = (a: number, b: number) => (b ? Math.round((100 * a) / b) : 0);
const significant = items.filter((i) => (i.significance ?? 1) >= 2);
const allWeeks = [...new Set(items.map((i) => isoWeek(i.publishedAt)))].sort();
function isoWeek(iso: string): string {
  const d = new Date(iso);
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return `W${String(Math.ceil(((+t - +y0) / 86400000 + 1) / 7)).padStart(2, "0")}`;
}

const heat = TOPICS.map((t) => {
  const cells = allWeeks.map((w) => significant.filter((i) => i.topic === t.key && isoWeek(i.publishedAt) === w).length);
  return { t, cells, total: cells.reduce((a, b) => a + b, 0) };
}).sort((a, b) => b.total - a.total);
const maxCell = Math.max(...heat.flatMap((h) => h.cells), 1);

const timeline = items.filter((i) => i.topic === TIMELINE_TOPIC && (i.significance ?? 1) >= 2);
const chained = timeline.filter((i) => i.follows?.followsId).length;

const e = escapeHtml;
const weekSections = weeks.map((w) => {
  const matchedOff = new Set(w.verdict.matches.map((m) => m.official));
  const matchedOurs = new Set(w.verdict.matches.map((m) => m.ours));
  const list = (fs: DigestFeature[], matched: Set<number>) => `<ol>${fs.map((f, n) =>
    `<li class="${matched.has(n + 1) ? "hit" : "miss"}">${e(f.title)} <span class="v">${e(f.version ?? "")}</span></li>`).join("")}</ol>`;
  return `<section class="week" id="w${w.week}">
  <h2>Week ${w.week} <span class="v">v${w.from}–v${w.to} · ${w.count} položek changelogu</span></h2>
  <p class="score">Shoda hlavních novinek: <b>${w.verdict.matches.length} z ${w.official.features.length}</b> oficiálních
   (recall ${pct(w.verdict.matches.length, w.official.features.length)} %, přesnost ${pct(w.verdict.matches.length, w.ours.parsed.features.length)} %)</p>
  <p class="score">Z oficiálních novinek s verzí CLI: <b>${w.official.features.filter((f, n) => /^v\d/.test(f.version ?? "") && matchedOff.has(n + 1)).length} z ${w.official.features.filter((f) => /^v\d/.test(f.version ?? "")).length}</b>
   · mimo changelog CLI (Desktop, mobil, web…): ${w.official.features.filter((f) => !/^v\d/.test(f.version ?? "")).map((f) => e(f.title)).join(", ") || "—"}</p>
  <p class="verdict">${e(w.verdict.verdict)}</p>
  <div class="cols">
    <div><h3>Oficiální přehled (Anthropic)</h3>${list(w.official.features, matchedOff)}</div>
    <div><h3>Náš výběr ze changelogu</h3>${list(w.ours.parsed.features, matchedOurs)}
      ${w.ours.dropped.length ? `<p class="note">Vyřazeno kontrolou faktů: ${w.ours.dropped.map((d) => `${e(d.title)} (${e(d.problem)})`).join("; ")}</p>` : ""}</div>
  </div>
  <details><summary>Náš článek</summary><div class="article">${renderMarkdown(w.oursArticle.md.replace(/^---[\s\S]*?---\s*/, ""))}</div>
   ${w.oursArticle.strippedLinks.length ? `<p class="note">Odstraněné odkazy mimo whitelist: ${w.oursArticle.strippedLinks.map(e).join(", ")}</p>` : ""}</details>
  <details><summary>Článek z oficiálního přehledu (stejná redakční vrstva, pro srovnání stylu)</summary><div class="article">${renderMarkdown(w.officialArticle.md.replace(/^---[\s\S]*?---\s*/, ""))}</div></details>
</section>`;
}).join("\n");

const timelineHtml = timeline.map((i) => {
  const f = i.follows?.followsId ? byId.get(i.follows.followsId) : null;
  return `<li id="i-${e(i.id.replace("#", "-"))}"><span class="v">${e(i.version)} · ${e(i.publishedAt.slice(0, 10))}</span>
   <span class="sig s${i.significance}">${"●".repeat(i.significance ?? 1)}</span> ${e(i.text)}
   <div class="why">${e(i.reason ?? "")}${f ? ` · <b>${e(i.follows!.relation ?? "navazuje")}</b> <a href="#i-${e(f.id.replace("#", "-"))}">${e(f.version)}</a>: ${e(i.follows!.reason)}` : ""}</div></li>`;
}).join("");

const meanRecall = pct(weeks.reduce((a, w) => a + w.verdict.matches.length, 0), weeks.reduce((a, w) => a + w.official.features.length, 0));
const html = `<!doctype html><html lang="cs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Novinky v CC ze changelogu</title>
<style>
:root{--bg:#f7f6f2;--fg:#1d1d1b;--mut:#6b6a66;--card:#fff;--line:#e3e1da;--hit:#1f7a4d;--miss:#a3412b;--acc:#2f5d50}
@media (prefers-color-scheme:dark){:root{--bg:#161615;--fg:#ecebe6;--mut:#a09e97;--card:#1f1f1d;--line:#34332f;--hit:#5cc290;--miss:#e48a72;--acc:#8cc4b3}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 system-ui,-apple-system,sans-serif}
main{max-width:1100px;margin:0 auto;padding:24px 16px 64px}
h1{font-size:26px;margin:0 0 4px}h2{font-size:20px;margin:0 0 8px}h3{font-size:15px;margin:0 0 6px;color:var(--mut)}
.v{color:var(--mut);font-size:13px;font-weight:400}.lead{color:var(--mut);margin:0 0 20px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin:16px 0 28px}
.card,.week,.box{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px}
.card b{display:block;font-size:24px}.week,.box{margin:0 0 20px}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:20px}@media(max-width:720px){.cols{grid-template-columns:1fr}}
ol{margin:0;padding-left:20px}li.hit::marker{color:var(--hit)}li.miss{color:var(--miss)}
.score{margin:0 0 4px}.verdict{margin:0 0 12px;color:var(--mut)}.note{font-size:13px;color:var(--mut)}
details{margin-top:10px}summary{cursor:pointer;color:var(--acc)}.article{border-top:1px solid var(--line);margin-top:8px;padding-top:8px}
.heat{overflow-x:auto}table{border-collapse:collapse;font-size:12px}td,th{padding:3px 6px;text-align:center;border-bottom:1px solid var(--line)}
td.l,th.l{text-align:left;white-space:nowrap}.c{border-radius:3px;min-width:20px;display:inline-block}
.timeline{list-style:none;padding:0}.timeline li{padding:8px 0;border-bottom:1px solid var(--line)}
.why{font-size:13px;color:var(--mut)}.sig{color:var(--acc);letter-spacing:1px}.tax td{text-align:left}
</style></head><body><main>
<h1>Novinky v Claude Code ze changelogu</h1>
<p class="lead">Ukázka fáze 1: náš výběr ze changelogu proti oficiálním přehledům Anthropicu za týdny 33–37, třídění do témat a sledování navazujících změn. Lokální běh, nic se nepublikovalo.</p>
<div class="cards">
 <div class="card"><b>${meanRecall} %</b>oficiálních novinek jsme vybrali taky</div>
 <div class="card"><b>${items.length}</b>položek changelogu (v2.1.200–v${items.at(-1)!.version})</div>
 <div class="card"><b>${significant.length}</b>významných (2–3)</div>
 <div class="card"><b>${[...follows.values()].filter((f) => f.followsId).length}</b>vazeb „navazuje na"</div>
 <div class="card"><b>$${costLog.usd.toFixed(2)}</b>cena běhu (${costLog.calls} volání, ${costLog.cached} z cache)</div>
</div>
${weekSections}
<section class="box"><h2>Vývoj témat <span class="v">významné položky (2–3) po ISO týdnech</span></h2><div class="heat"><table>
<tr><th class="l">Téma</th>${allWeeks.map((w) => `<th>${w}</th>`).join("")}<th>Σ</th></tr>
${heat.map((h) => `<tr><td class="l">${e(h.t.label)}</td>${h.cells.map((c) => `<td><span class="c" style="background:color-mix(in srgb,var(--acc) ${Math.round((100 * c) / maxCell)}%,transparent)">${c || ""}</span></td>`).join("")}<td>${h.total}</td></tr>`).join("")}
</table></div></section>
<section class="box"><h2>Časová osa: ${e(topicLabel(TIMELINE_TOPIC))} <span class="v">${timeline.length} významných položek, ${chained} navazuje na dřívější</span></h2>
<ul class="timeline">${timelineHtml}</ul></section>
<section class="box"><h2>Návrh taxonomie <span class="v">k odsouhlasení</span></h2><table class="tax">
${TOPICS.map((t) => `<tr><td class="l"><b>${e(t.label)}</b></td><td>${e(t.description)}</td><td>${items.filter((i) => i.topic === t.key).length}</td></tr>`).join("")}
</table></section>
<p class="note">Modely: třídění, návaznost a kontrola faktů ${MODEL_CLASSIFY}; výběr, článek a porovnání ${MODEL_WRITE}. Verze promptů: ${Object.values(PV).join(", ")}. Vygenerováno ${new Date().toISOString()} za ${Math.round((Date.now() - t0) / 1000)} s.</p>
</main></body></html>`;
writeFileSync(join(OUT_DIR, "report.html"), html);
console.log(`[hotovo] ${join(OUT_DIR, "report.html")} · ${costLog.calls} volání, ${costLog.cached} z cache, $${costLog.usd.toFixed(3)}`);
