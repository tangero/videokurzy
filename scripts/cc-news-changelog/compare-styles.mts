// Porovná kvalitu dvou článků za STEJNÝ týden (např. redakční pipeline vs. skill
// technicky-clanek). Hodnotitel dostane i zdroje (changelog týdne + volitelně text
// stránky dokumentace), aby ověřil fakta, ne jen styl.
//
//   npx tsx scripts/cc-news-changelog/compare-styles.mts <týden> <od> <do> <A.md> "<popis A>" <B.md> "<popis B>" <výstup.html> [zdroj.txt]

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { OUT_DIR, MODEL_WRITE, costLog, llmJson, readJson, compareVersions, type ChangeItem } from "./lib.ts";
import { renderMarkdown, escapeHtml as e } from "../../src/lib/markdown.ts";

const [week, from, to, aPath, aLabel, bPath, bLabel, outPath, extraPath] = process.argv.slice(2);
const A = readFileSync(aPath!, "utf8");
const B = readFileSync(bPath!, "utf8");
const extra = extraPath ? readFileSync(extraPath, "utf8").slice(0, 120000) : "";
const entries = (readJson<ChangeItem[]>(join(OUT_DIR, "items.json")) ?? [])
  .filter((i) => compareVersions(i.version, from!) >= 0 && compareVersions(i.version, to!) <= 0)
  .map((i) => `${i.id} | ${i.text}`).join("\n");

const CRITERIA = ["Přesnost vůči zdrojům", "Výběr a váha témat", "Čtivost a hlas", "Užitečnost pro čtenáře", "Jazyk a styl"];
const SYSTEM = [
  "Jsi náročný šéfredaktor českého technického webu. Porovnáváš dva články o novinkách v Claude Code",
  "za stejný týden. Máš i ZDROJE: changelog týdne a text dokumentace. Fakta ověřuj proti nim.",
  `Ohodnoť oba články 1–10 v kritériích: ${CRITERIA.join(", ")}.`,
  "Vrať JSON:",
  `{"scores": {"A": {"<kritérium>": n, ...}, "B": {...}},`,
  ` "factErrors": {"A": ["<tvrzení, které zdroje nepodporují nebo mu odporují>"], "B": [...]},`,
  ` "strengths": {"A": ["..."], "B": ["..."]}, "weaknesses": {"A": ["..."], "B": ["..."]},`,
  ` "verdict": "<3–5 vět: který je lepší pro jakého čtenáře a proč>",`,
  ` "recommendation": "<1–2 věty: co z kterého převzít do produkční pipeline>"}`,
  "Piš česky. Uvnitř textů nepoužívej znak dvojité uvozovky, použij „ “.",
].join("\n");

type Side<T> = { A: T; B: T };
const v = await llmJson<{
  scores: Side<Record<string, number>>; factErrors: Side<string[]>; strengths: Side<string[]>;
  weaknesses: Side<string[]>; verdict: string; recommendation: string;
}>({
  model: MODEL_WRITE, system: SYSTEM, promptVersion: "compare-styles-v1", maxTokens: 10000,
  user: `ČLÁNEK A (${aLabel}):\n${A}\n\nČLÁNEK B (${bLabel}):\n${B}\n\nZDROJE — CHANGELOG:\n${entries}\n\nZDROJE — DOKUMENTACE:\n${extra || "(není)"}`,
});

const avg = (s: Record<string, number>) => (Object.values(s).reduce((a, b) => a + b, 0) / Math.max(Object.values(s).length, 1)).toFixed(1);
const ul = (xs: string[] = []) => (xs.length ? `<ul>${xs.map((x) => `<li>${e(x)}</li>`).join("")}</ul>` : '<p class="mut">—</p>');
const body = (md: string) => renderMarkdown(md.replace(/^---[\s\S]*?---\s*/, ""));

const html = `<!doctype html><html lang="cs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Week ${week}: dva styly</title>
<style>
:root{--bg:#f7f6f2;--fg:#1d1d1b;--mut:#6b6a66;--card:#fff;--line:#e3e1da;--a:#7a4b1f;--b:#1f5a7a;--warn:#a3412b}
@media (prefers-color-scheme:dark){:root{--bg:#161615;--fg:#ecebe6;--mut:#a09e97;--card:#1f1f1d;--line:#34332f;--a:#e0b07a;--b:#8cc0e0;--warn:#e48a72}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.6 system-ui,-apple-system,sans-serif}
main{max-width:1280px;margin:0 auto;padding:24px 16px 64px}h1{font-size:26px;margin:0 0 4px}h2{font-size:19px;margin:0 0 10px}h3{font-size:15px;margin:10px 0 4px}
.mut{color:var(--mut)}.box{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px;margin:0 0 20px}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:20px;align-items:start}@media(max-width:900px){.cols{grid-template-columns:1fr}}
table{border-collapse:collapse;width:100%}td,th{padding:6px 8px;border-bottom:1px solid var(--line);text-align:left}td.n,th.n{text-align:center}
.tag{display:inline-block;font-size:12px;font-weight:600;padding:2px 8px;border-radius:99px;color:#fff}.ta{background:var(--a)}.tb{background:var(--b)}
.warn{color:var(--warn)}.article{overflow-wrap:anywhere}.article h1{font-size:20px}.article h2{font-size:17px}
</style></head><body><main>
<h1>Week ${week}: ${e(aLabel!)} vs. ${e(bLabel!)}</h1>
<p class="mut">Verze v${e(from!)}–v${e(to!)}. Hodnotí ${MODEL_WRITE} se zdroji (changelog týdne${extra ? " + dokumentace" : ""}). Cena hodnocení $${costLog.usd.toFixed(2)}.</p>
<section class="box"><h2>Verdikt</h2><p>${e(v.verdict)}</p><p class="mut">${e(v.recommendation)}</p></section>
<section class="box"><h2>Hodnocení 1–10</h2><table>
<tr><th>Kritérium</th><th class="n"><span class="tag ta">A</span></th><th class="n"><span class="tag tb">B</span></th></tr>
${CRITERIA.map((c) => `<tr><td>${e(c)}</td><td class="n">${v.scores.A?.[c] ?? "?"}</td><td class="n">${v.scores.B?.[c] ?? "?"}</td></tr>`).join("")}
<tr><th>Průměr</th><th class="n">${avg(v.scores.A ?? {})}</th><th class="n">${avg(v.scores.B ?? {})}</th></tr></table></section>
<section class="cols">
 <div class="box"><h2><span class="tag ta">A</span> ${e(aLabel!)}</h2><h3>Silné stránky</h3>${ul(v.strengths.A)}<h3>Slabiny</h3>${ul(v.weaknesses.A)}<h3 class="warn">Faktické chyby</h3>${ul(v.factErrors.A)}</div>
 <div class="box"><h2><span class="tag tb">B</span> ${e(bLabel!)}</h2><h3>Silné stránky</h3>${ul(v.strengths.B)}<h3>Slabiny</h3>${ul(v.weaknesses.B)}<h3 class="warn">Faktické chyby</h3>${ul(v.factErrors.B)}</div>
</section>
<section class="cols">
 <div class="box article"><p><span class="tag ta">A</span> ${e(aLabel!)}</p>${body(A)}</div>
 <div class="box article"><p><span class="tag tb">B</span> ${e(bLabel!)}</p>${body(B)}</div>
</section>
</main></body></html>`;
writeFileSync(outPath!, html);
console.log(`[hotovo] ${outPath} · A ${avg(v.scores.A ?? {})}, B ${avg(v.scores.B ?? {})} · $${costLog.usd.toFixed(3)}`);
