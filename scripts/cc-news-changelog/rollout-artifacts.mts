// Připraví soubory pro nasazení „Novinky v CC" fáze 2 (nic nezapisuje do produkce):
//
//  1) backfill D1: celá historie changelogu s tématy, významem a návaznostmi
//     z lokálního běhu (run.mts s CC_MIN_VERSION=0.2.0) → SQL po 500 řádcích,
//     ID přepočtená na produkční schéma <verze>#<sha8(text)>,
//  2) seed KV: dnešní lokální snímek dokumentace (snapshot-docs.mts) jako
//     cc-docs:index + výchozí týden pro první porovnání + obsah stránek.
//
//   CC_OUT_DIR=<výstup run.mts> npx tsx scripts/cc-news-changelog/rollout-artifacts.mts <snímek-dir> <týden-baseline, např. 2026-w41> <cíl>

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { OUT_DIR, readJson } from "./lib.ts";
import { fetchChangelog } from "../../src/lib/cc-news/changelog-source.ts";
import { CLASSIFY_PROMPT_VERSION } from "../../src/lib/cc-news/classify.ts";

const [snapshotDir, baselineWeek, target] = process.argv.slice(2);
if (!snapshotDir || !baselineWeek || !target) throw new Error("Použití: rollout-artifacts.mts <snímek-dir> <2026-w41> <cíl>");

// ─── 1) Backfill D1 ───────────────────────────────────────────────

type Local = { id: string; version: string; topic?: string; significance?: number; reason?: string; follows?: { followsId: string | null; relation: string | null; reason: string } };
const local = readJson<Local[]>(join(OUT_DIR, "items.json"));
if (!local) throw new Error(`Chybí ${join(OUT_DIR, "items.json")}`);
const localByKey = new Map(local.map((l) => [l.id, l])); // „verze#pořadí"

const entries = await fetchChangelog("0.0.0");
const prodIdByKey = new Map(entries.map((e) => [`${e.version}#${e.ord}`, e.id]));
const sq = (v: string | number | null | undefined) =>
  v === null || v === undefined ? "NULL" : typeof v === "number" ? String(v) : `'${v.replace(/'/g, "''")}'`;

const now = Math.floor(Date.now() / 1000);
const rows = entries.map((e) => {
  const l = localByKey.get(`${e.version}#${e.ord}`);
  const followsId = l?.follows?.followsId ? prodIdByKey.get(l.follows.followsId) ?? null : null;
  const classified = l?.topic && l.reason !== "nezatříděno";
  return `INSERT OR IGNORE INTO cc_change_item (id, version, publishedAt, ord, type, scope, text, topic, significance, reason, followsId, relation, followReason, classifiedAt, promptVersion) VALUES (${[
    sq(e.id), sq(e.version), Math.floor(+e.publishedAt / 1000), e.ord, sq(e.type), sq(e.scope), sq(e.text),
    sq(classified ? l!.topic : null), classified ? l!.significance ?? 1 : "NULL", sq(classified ? l!.reason : null),
    sq(followsId), sq(followsId ? l!.follows!.relation : null), sq(followsId ? l!.follows!.reason : null),
    classified ? now : "NULL", sq(classified ? CLASSIFY_PROMPT_VERSION : null),
  ].join(", ")});`;
});
const d1Dir = join(target, "d1");
mkdirSync(d1Dir, { recursive: true });
for (let i = 0; i < rows.length; i += 500) {
  writeFileSync(join(d1Dir, `${String(i / 500 + 1).padStart(3, "0")}.sql`), rows.slice(i, i + 500).join("\n") + "\n");
}
const classified = entries.filter((e) => { const l = localByKey.get(`${e.version}#${e.ord}`); return l?.topic && l.reason !== "nezatříděno"; }).length;
const linked = entries.filter((e) => {
  const f = localByKey.get(`${e.version}#${e.ord}`)?.follows?.followsId;
  return !!(f && prodIdByKey.get(f));
}).length;
console.log(`[d1] ${rows.length} položek (${classified} zatříděných, ${linked} s návazností) → ${d1Dir} (${Math.ceil(rows.length / 500)} souborů)`);

// ─── 2) Seed KV ───────────────────────────────────────────────────

const idx = JSON.parse(readFileSync(join(snapshotDir, "index.json"), "utf8")) as {
  takenAt: string; pages: { path: string; lastmod: string; hash?: string; file?: string }[];
};
const pages: Record<string, { lastmod: string; hash: string }> = {};
const kv: { key: string; value: string }[] = [];
for (const p of idx.pages) {
  if (!p.hash || !p.file) continue;
  pages[p.path] = { lastmod: p.lastmod, hash: p.hash };
  kv.push({ key: `cc-docs:page:${p.path}:${p.hash}`, value: readFileSync(join(snapshotDir, p.file), "utf8") });
}
const index = JSON.stringify({ takenAt: idx.takenAt, pages });
kv.push({ key: "cc-docs:index", value: index });
kv.push({ key: `cc-docs:week:${baselineWeek}`, value: index });
writeFileSync(join(target, "kv-docs-seed.json"), JSON.stringify(kv));
console.log(`[kv] ${Object.keys(pages).length} stránek + index + cc-docs:week:${baselineWeek} → ${join(target, "kv-docs-seed.json")}`);
console.log(`[kontrola] souborů ve snímku: ${readdirSync(snapshotDir).length - 1}`);
