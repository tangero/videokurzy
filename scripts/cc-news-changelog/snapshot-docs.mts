// Snímek anglické dokumentace Claude Code (code.claude.com/docs/en/*) jako .md.
// Dokumentace nemá veřejnou historii — novinky mimo changelog (Desktop, web,
// mobil) zjistíme jen porovnáním dvou snímků. Každý týden bez snímku je ztracený.
//
//   npx tsx scripts/cc-news-changelog/snapshot-docs.mts [cílová složka]
//
// Výstup: <složka>/<YYYY-MM-DD>/<stránka>.md + index.json {path, lastmod, hash, bytes}.

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mapLimit } from "./lib.ts";

const root = process.argv[2] ?? join(process.cwd(), ".cc-news-out", "snapshots");
const day = new Date().toISOString().slice(0, 10);
const dir = join(root, day);
mkdirSync(dir, { recursive: true });

const sitemap = await (await fetch("https://code.claude.com/sitemap.xml")).text();
const pages = [...sitemap.matchAll(/<loc>https:\/\/code\.claude\.com\/docs\/en\/([^<]+)<\/loc>\s*<lastmod>([^<]+)<\/lastmod>/g)]
  .map((m) => ({ path: m[1]!, lastmod: m[2]! }));

const index = await mapLimit(pages, 6, async (p) => {
  const res = await fetch(`https://code.claude.com/docs/en/${p.path}.md`);
  if (!res.ok) return { ...p, error: res.status };
  const md = await res.text();
  const file = `${p.path.replace(/\//g, "__")}.md`;
  writeFileSync(join(dir, file), md);
  return { ...p, file, bytes: md.length, hash: createHash("sha256").update(md).digest("hex").slice(0, 16) };
});

writeFileSync(join(dir, "index.json"), JSON.stringify({ takenAt: new Date().toISOString(), pages: index }, null, 2));
const failed = index.filter((p) => "error" in p);
console.log(`[snapshot] ${dir}: ${index.length - failed.length}/${pages.length} stránek` + (failed.length ? `, chyby: ${failed.map((f) => f.path).join(", ")}` : ""));
