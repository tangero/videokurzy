// Snímky anglické dokumentace sledovaného nástroje (výchozí Claude Code) a jejich týdenní porovnání
// (Novinky v CC, fáze 2). Dokumentace nemá veřejnou historii, ale zachytí
// novinky, které changelog CLI nemá (Desktop, web, mobil) — a nová stránka nebo
// velký nový oddíl je signál, že jde o důležité téma (např. Projects ve W38).
//
// KV:
//   cc-docs:index                 aktuální stav {path: {lastmod, hash}}
//   cc-docs:page:<path>:<hash>    obsah stránky (.md), adresovaný obsahem
//   cc-docs:week:<YYYY-wNN>       index zmrazený na konci týdne (pondělní běh)

import type { LlmFn } from "./llm";
import { llmJson } from "./llm";
import { weekKey } from "./changelog-source";

/**
 * Odkud se dokumentace nástroje bere. `prefix` = začátek URL stránek v sitemap
 * (cesta za ním je klíč stránky), `kv` = předpona KV klíčů snímků.
 */
export interface DocsSource {
  name: string;
  sitemapUrl: string;
  prefix: string;
  kv: string;
  /** Stránky, jejichž obsah už máme jinak (changelog). */
  skip: string[];
}

export const CLAUDE_CODE_DOCS: DocsSource = {
  name: "Claude Code",
  sitemapUrl: "https://code.claude.com/sitemap.xml",
  prefix: "https://code.claude.com/docs/en/",
  kv: "cc-docs",
  skip: ["changelog"],
};

const FETCH_TIMEOUT_MS = 15_000;
// Strop stažených stránek na jeden cron (limit subrequestů workeru). Zbytek
// dožene další den — lastmod v indexu zůstane starý, takže se stránka zopakuje.
export const MAX_PAGES_PER_RUN = 80;

export interface DocsIndex {
  takenAt: string;
  pages: Record<string, { lastmod: string; hash: string }>;
}

export const docsIndexKey = (src: DocsSource = CLAUDE_CODE_DOCS) => `${src.kv}:index`;
export const DOCS_INDEX_KEY = docsIndexKey();
export const docsPageKey = (path: string, hash: string, src: DocsSource = CLAUDE_CODE_DOCS) => `${src.kv}:page:${path}:${hash}`;
export const docsWeekKey = (w: { year: number; week: number }, src: DocsSource = CLAUDE_CODE_DOCS) => `${src.kv}:week:${weekKey(w)}`;

async function sha16(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Anglické stránky dokumentace se svým lastmod ze sitemap.xml. */
export function parseSitemap(xml: string, src: DocsSource = CLAUDE_CODE_DOCS): { path: string; lastmod: string }[] {
  const prefix = src.prefix.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  return [...xml.matchAll(new RegExp(`<loc>${prefix}([^<]+)</loc>\\s*<lastmod>([^<]+)</lastmod>`, "g"))]
    .map((m) => ({ path: m[1]!, lastmod: m[2]! }));
}

/**
 * Denní snímek: stáhne jen stránky se změněným lastmod (nejvýš MAX_PAGES_PER_RUN),
 * uloží obsah a aktualizuje index. Stránky, které ze sitemap zmizely, z indexu vypadnou.
 */
export async function snapshotDocs(
  kv: KVNamespace, now: Date, src: DocsSource = CLAUDE_CODE_DOCS, maxPages = MAX_PAGES_PER_RUN,
): Promise<{ fetched: number; changed: number; pending: number }> {
  const res = await fetch(src.sitemapUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${src.name} docs sitemap fetch failed: ${res.status}`);
  const pages = parseSitemap(await res.text(), src);
  if (pages.length === 0) throw new Error(`${src.name} docs sitemap: žádné stránky (změnil se formát?)`);

  const prev = (await kv.get<DocsIndex>(docsIndexKey(src), "json")) ?? { takenAt: "", pages: {} };
  const next: DocsIndex = { takenAt: now.toISOString(), pages: {} };
  const stale = pages.filter((p) => prev.pages[p.path]?.lastmod !== p.lastmod);
  const todo = stale.slice(0, maxPages);
  const todoSet = new Set(todo.map((p) => p.path));
  let changed = 0;

  for (const p of pages) {
    if (!todoSet.has(p.path)) {
      // Nezměněná (nebo odložená) stránka: drž původní záznam.
      if (prev.pages[p.path]) next.pages[p.path] = prev.pages[p.path]!;
      continue;
    }
    const r = await fetch(`${src.prefix}${p.path}.md`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!r.ok) {
      if (prev.pages[p.path]) next.pages[p.path] = prev.pages[p.path]!;
      continue;
    }
    const md = await r.text();
    const hash = await sha16(md);
    if (prev.pages[p.path]?.hash !== hash) {
      // Bez expirace: index na obsah odkazuje, dokud se stránka nezmění, a to
      // může trvat měsíce (s TTL by se změna dlouho stabilní stránky ztratila).
      await kv.put(docsPageKey(p.path, hash, src), md);
      changed++;
    }
    next.pages[p.path] = { lastmod: p.lastmod, hash };
  }
  await kv.put(docsIndexKey(src), JSON.stringify(next));
  return { fetched: todo.length, changed, pending: stale.length - todo.length };
}

/**
 * Zmrazí aktuální index jako stav na konci týdne `week` (jen jednou). Neúplný
 * index (stránky ze sitemap, které se ještě nestáhly) nezmrazí — v příštím
 * porovnání by se chybějící stránky tvářily jako nové a dostaly signál new-page.
 */
export async function freezeWeek(kv: KVNamespace, week: { year: number; week: number }, pending = 0, src: DocsSource = CLAUDE_CODE_DOCS): Promise<boolean> {
  if (pending > 0) return false;
  const key = docsWeekKey(week, src);
  if (await kv.get(key)) return false;
  const idx = await kv.get(docsIndexKey(src));
  if (!idx) return false;
  await kv.put(key, idx);
  return true;
}

// ─── Porovnání dvou týdnů ─────────────────────────────────────────

export interface DocsChange { id: string; page: string; text: string; evidence: string }
export interface DocsSignal { id: string; page: string; kind: "new-page" | "large-section"; words: number }

/** Obsahové řádky markdownu (bez prázdných a krátkých — nadpisy a odkazy nesou málo). */
export function contentLines(md: string): string[] {
  return md
    .split("\n")
    .map((l) => l.replace(/^[>#*\-\s]+/, "").replace(/\s+/g, " ").trim())
    .filter((l) => l.length > 40 && !/^(Fetch the complete documentation index|Use this file to discover)/i.test(l));
}

const words = (lines: string[]) => lines.join(" ").split(/\s+/).filter(Boolean).length;
export const LARGE_SECTION_WORDS = 400;
// Strop změněných stránek na jeden týdenní diff (čas konzumenta fronty).
export const MAX_DIFF_PAGES = 60;
const DIFF_CONCURRENCY = 4;

async function mapLimit<T>(items: T[], limit: number, fn: (t: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]!);
  }));
}

const DOCS_SYSTEM = (name: string) => [
  `You compare two versions of one ${name} documentation page (BEFORE and AFTER one week).`,
  "You get only the lines ADDED in AFTER, plus lines REMOVED from BEFORE for context.",
  "List NEW user-facing capabilities or behaviour changes that these additions describe.",
  "Ignore rewording, renamed headings, typo fixes, reordering, links and examples that describe",
  "something that already existed. When unsure whether it is new, leave it out.",
  `Return a JSON array: [{"text": "<one sentence in English: what is new>", "evidence": "<the added line, max 200 chars>"}]. Empty array if nothing is new.`,
  "Never use the double-quote character inside text or evidence; use single quotes.",
].join("\n");

const PAGE_SYSTEM = (name: string) => [
  `A NEW ${name} documentation page appeared this week. Summarise what capability it documents`,
  "in 3-6 English sentences for a release digest: what it is and how it works, who gets it (plans,",
  "availability, rollout), prerequisites (integrations, permissions), sharing, usage limits and hard caps.",
  "Only facts stated on the page.",
  'Return JSON: {"text": "<summary>", "evidence": "<one key sentence from the page, max 200 chars>"}. No double quotes inside texts.',
].join("\n");

/**
 * Porovná index konce týdne s indexem konce týdne předchozího. Nové stránky
 * shrne `writeLlm` (signál new-page), změněné stránky projde `classifyLlm`
 * (signál large-section při ≥ 400 nových slovech). Stránka changelogu se
 * přeskakuje — její obsah už máme z CHANGELOG.md.
 */
export async function diffDocsWeeks(
  kv: KVNamespace, before: DocsIndex, after: DocsIndex, classifyLlm: LlmFn, writeLlm: LlmFn, src: DocsSource = CLAUDE_CODE_DOCS,
): Promise<{ changes: DocsChange[]; signals: DocsSignal[] }> {
  const changes: DocsChange[] = [];
  const signals: DocsSignal[] = [];
  const read = async (path: string, hash: string) => (await kv.get(docsPageKey(path, hash, src))) ?? null;

  // Nové stránky první (nesou nejsilnější signál), pak změněné; nejvýš MAX_DIFF_PAGES.
  const changed = Object.entries(after.pages)
    .filter(([path, cur]) => !src.skip.includes(path) && before.pages[path]?.hash !== cur.hash)
    .sort(([a], [b]) => Number(!!before.pages[a]) - Number(!!before.pages[b]));
  if (changed.length > MAX_DIFF_PAGES) {
    console.log(`[cc-docs] změněných stránek ${changed.length}, zpracuji ${MAX_DIFF_PAGES}: vynechány ${changed.slice(MAX_DIFF_PAGES).map(([p]) => p).join(", ")}`);
  }

  await mapLimit(changed.slice(0, MAX_DIFF_PAGES), DIFF_CONCURRENCY, async ([path, cur]) => {
    const old = before.pages[path];
    const md = await read(path, cur.hash);
    if (!md) return;
    const lines = contentLines(md);

    if (!old) {
      try {
        const out = await llmJson<{ text: string; evidence: string }>(writeLlm, PAGE_SYSTEM(src.name), `PAGE: ${path}\n\n${lines.join("\n").slice(0, 60_000)}`, 1500);
        const id = `docs:${path}#page`;
        signals.push({ id, page: path, kind: "new-page", words: words(lines) });
        changes.push({ id, page: path, text: `NEW DOCS PAGE (${words(lines)} words): ${out.text}`, evidence: out.evidence ?? "" });
      } catch (err) {
        console.error(`[cc-docs] nová stránka ${path}: ${(err as Error).message}`);
      }
      return;
    }

    const prevMd = await read(path, old.hash);
    if (!prevMd) return;
    const prevLines = contentLines(prevMd);
    const beforeSet = new Set(prevLines);
    const afterSet = new Set(lines);
    const added = lines.filter((l) => !beforeSet.has(l));
    const removed = prevLines.filter((l) => !afterSet.has(l));
    if (added.length === 0) return;
    try {
      const out = await llmJson<{ text: string; evidence: string }[]>(
        classifyLlm, DOCS_SYSTEM(src.name),
        `PAGE: ${path}\n\nADDED:\n${added.join("\n")}\n\nREMOVED:\n${removed.join("\n") || "(none)"}`, 3000,
      );
      const found = out.filter((c) => c?.text).map((c, n) => ({ id: `docs:${path}#${n + 1}`, page: path, text: c.text, evidence: c.evidence ?? "" }));
      changes.push(...found);
      const addedWords = words(added) - words(removed);
      if (addedWords >= LARGE_SECTION_WORDS && found.length > 0) signals.push({ id: found[0]!.id, page: path, kind: "large-section", words: addedWords });
    } catch (err) {
      console.error(`[cc-docs] ${path}: ${(err as Error).message}`);
    }
  });
  // Stabilní pořadí nezávislé na paralelismu.
  changes.sort((a, b) => a.id.localeCompare(b.id));
  return { changes, signals };
}
