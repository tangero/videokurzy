// Porovná publikovaný článek (z oficiálního přehledu Anthropicu) s článkem
// vygenerovaným ze changelogu za stejné období. Vstup: publikovaný markdown
// (stažený z produkčního KV jen pro čtení) + weeks.json z run.mts.
//
//   npx tsx scripts/cc-news-changelog/compare-article.mts 37 docs/cc-news-changelog/w37-publikovany.md docs/cc-news-changelog

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { OUT_DIR, MODEL_WRITE, costLog, llmJson, readJson, compareVersions, type ChangeItem } from "./lib.ts";
import { renderMarkdown, escapeHtml as e } from "../../src/lib/markdown.ts";

const [weekArg, publishedPath, outDir] = process.argv.slice(2);
const week = Number(weekArg);
const published = readFileSync(publishedPath!, "utf8");
const weeks = readJson<{ week: number; from: string; to: string; count: number; oursArticle: { md: string } }[]>(join(OUT_DIR, "weeks.json"));
const w = weeks?.find((x) => x.week === week);
if (!w) throw new Error(`weeks.json nemá týden ${week} — nejdřív spusť run.mts`);
const ours = w.oursArticle.md;
// Položky changelogu za týden — aby hodnotitel nehádal, co v changelogu je.
const entries = (readJson<ChangeItem[]>(join(OUT_DIR, "items.json")) ?? [])
  .filter((i) => compareVersions(i.version, w.from) >= 0 && compareVersions(i.version, w.to) <= 0)
  .map((i) => `${i.id} | ${i.text}`)
  .join("\n");

const SYSTEM = [
  "Porovnáváš dva české články o novinkách v Claude Code za STEJNÝ týden.",
  "A = publikovaný článek (vznikl z oficiálního týdenního přehledu Anthropicu).",
  "B = článek vygenerovaný z kompletního changelogu Claude Code.",
  "Dostaneš i CHANGELOG — všechny položky changelogu CLI za tento týden. U onlyA v `why` VŽDY uveď,",
  "zda novinka v CHANGELOGU je (s id položky, pak jde o redakční volbu B) nebo není (pak ji B mít nemohl).",
  "Nehádej: rozhoduj jen podle CHANGELOGU.",
  "Vrať JSON:",
  `{"shared": ["<novinka v obou>"], "onlyA": [{"item": "<novinka jen v A>", "why": "<proč ji B nemá, např. není v changelogu CLI (Desktop)>"}],`,
  ` "onlyB": [{"item": "<novinka jen v B>", "worth": "<stojí čtenáři za zmínku? krátce>"}],`,
  ` "conflicts": ["<tvrzení, ve kterém si A a B věcně odporují>"],`,
  ` "quality": "<3–4 věty: čtivost, hloubka, přesnost, co je lepší v A a co v B>",`,
  ` "recommendation": "<1–2 věty: je B použitelný jako náhrada A?>"}`,
  "Piš česky, věcně, bez uvozovek uvnitř textů (použij „ “).",
].join("\n");

const verdict = await llmJson<{
  shared: string[]; onlyA: { item: string; why: string }[]; onlyB: { item: string; worth: string }[];
  conflicts: string[]; quality: string; recommendation: string;
}>({ model: MODEL_WRITE, system: SYSTEM, user: `ČLÁNEK A:\n${published}\n\nČLÁNEK B:\n${ours}\n\nCHANGELOG:\n${entries}`, promptVersion: "compare-article-v3", maxTokens: 10000 });

const body = (md: string) => renderMarkdown(md.replace(/^---[\s\S]*?---\s*/, ""));
const ul = (xs: string[]) => (xs.length ? `<ul>${xs.map((x) => `<li>${e(x)}</li>`).join("")}</ul>` : "<p class=\"mut\">—</p>");

const html = `<!doctype html><html lang="cs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Porovnání Week ${week}</title>
<style>
:root{--bg:#f7f6f2;--fg:#1d1d1b;--mut:#6b6a66;--card:#fff;--line:#e3e1da;--acc:#2f5d50;--a:#7a4b1f;--b:#1f5a7a}
@media (prefers-color-scheme:dark){:root{--bg:#161615;--fg:#ecebe6;--mut:#a09e97;--card:#1f1f1d;--line:#34332f;--acc:#8cc4b3;--a:#e0b07a;--b:#8cc0e0}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.6 system-ui,-apple-system,sans-serif}
main{max-width:1280px;margin:0 auto;padding:24px 16px 64px}
h1{font-size:26px;margin:0 0 4px}h2{font-size:19px;margin:0 0 10px}.mut{color:var(--mut)}
.box{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px;margin:0 0 20px}
.grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px}@media(max-width:900px){.grid{grid-template-columns:1fr}}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:20px;align-items:start}@media(max-width:900px){.cols{grid-template-columns:1fr}}
.tag{display:inline-block;font-size:12px;font-weight:600;padding:2px 8px;border-radius:99px;color:#fff}.ta{background:var(--a)}.tb{background:var(--b)}
.article h1{font-size:20px}.article h2{font-size:17px}.article{overflow-wrap:anywhere}
ul{padding-left:20px;margin:0}li{margin:0 0 4px}.why{color:var(--mut);font-size:13px}
</style></head><body><main>
<h1>Week ${week}: publikovaný článek vs. článek ze changelogu</h1>
<p class="mut">Stejné období: verze v${w.from}–v${w.to} (${w.count} položek changelogu). <span class="tag ta">A</span> publikovaný článek z oficiálního přehledu Anthropicu (kurzy.vibecoding.cz/novinky-cc/2026-w${week}-novinky) · <span class="tag tb">B</span> náš článek ze changelogu. Hodnocení: ${MODEL_WRITE}.</p>

<section class="box"><h2>Verdikt</h2><p>${e(verdict.recommendation)}</p><p class="mut">${e(verdict.quality)}</p></section>

<section class="grid">
 <div class="box"><h2>V obou</h2>${ul(verdict.shared)}</div>
 <div class="box"><h2><span class="tag ta">A</span> jen v publikovaném</h2>${verdict.onlyA.length ? `<ul>${verdict.onlyA.map((x) => `<li>${e(x.item)}<div class="why">${e(x.why)}</div></li>`).join("")}</ul>` : '<p class="mut">—</p>'}</div>
 <div class="box"><h2><span class="tag tb">B</span> jen v našem</h2>${verdict.onlyB.length ? `<ul>${verdict.onlyB.map((x) => `<li>${e(x.item)}<div class="why">${e(x.worth)}</div></li>`).join("")}</ul>` : '<p class="mut">—</p>'}</div>
</section>
${verdict.conflicts.length ? `<section class="box"><h2>Věcné rozpory</h2>${ul(verdict.conflicts)}</section>` : ""}

<section class="cols">
 <div class="box article"><p><span class="tag ta">A</span> publikovaný článek</p>${body(published)}</div>
 <div class="box article"><p><span class="tag tb">B</span> článek ze changelogu</p>${body(ours)}</div>
</section>
</main></body></html>`;

writeFileSync(join(outDir!, `w${week}-porovnani.html`), html);
writeFileSync(join(outDir!, `w${week}-ze-changelogu.md`), ours);
console.log(`[hotovo] ${join(outDir!, `w${week}-porovnani.html`)} · $${costLog.usd.toFixed(3)}`);
