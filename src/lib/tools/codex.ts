// Sběr změn Codex CLI (OpenAI) pro sledování nástrojů.
//
// Zdroj (ověřeno 18. 10. 2026): GitHub releases `openai/codex`, stabilní vydání
// s tagem `rust-v<verze>` (předběžná vydání, `python-v*` SDK a koncepty se
// vynechávají). CHANGELOG.md v repu jen odkazuje na stránku releases.
// Poznámky vydání mají oddíly „## New Features“, „## Bug Fixes“, „## Documentation“,
// „## Chores“ a seznam PR („## Changelog“, starší „### PRs Merged“), který se nesbírá.
// Starší vydání (do 0.59) mají místo New Features oddíl „### Highlights“.
// API vrací nejvýš 1000 vydání (10 stran po 100, včetně předběžných): historie
// proto sahá zhruba do listopadu 2025.

import { eq } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";
import { ccChangeItem } from "../../db/schema";
import { compareVersions, sha8, type ChangeType, type ChangelogEntry } from "../cc-news/changelog-source";
import { syncChangelogEntries } from "../cc-news/classify";
import type { ToolKey } from "./registry";

type Db = ReturnType<typeof drizzle>;

export const CODEX: ToolKey = "codex";
export const CODEX_RELEASES_URL = (page: number) => `https://api.github.com/repos/openai/codex/releases?per_page=100&page=${page}`;
const FETCH_TIMEOUT_MS = 15_000;
/** Strop stran na jeden běh; první naplnění projde všech 10 stran, které API vydá. */
export const MAX_PAGES = 10;

type Section = { type: ChangeType; scope?: string } | null;

const SECTION_TYPES: Record<string, Section> = {
  "new features": { type: "Added" },
  "features": { type: "Added" },
  "highlights": { type: "Added" },
  "bug fixes": { type: "Fixed" },
  "fixes": { type: "Fixed" },
  "improvements": { type: "Improved" },
  "performance": { type: "Improved" },
  "chores": { type: "Changed" },
  // Nekompatibilní změna: třídění ji vždy povýší na význam 3.
  "breaking changes": { type: "Changed", scope: "Breaking" },
  // Seznam PR a dokumentace repozitáře nejsou změny produktu.
  "changelog": null,
  "prs merged": null,
  "documentation": null,
};

const TAG_RE = /^rust-v(\d+\.\d+\.\d+)$/;

export interface GithubRelease {
  tag_name: string;
  prerelease: boolean;
  draft: boolean;
  published_at: string | null;
  body: string | null;
}

/** Text položky bez odkazů na PR na konci („(#123, #456)“, „— @autor“). */
export function cleanItem(text: string): string {
  return text
    .replace(/\s+[—–-]\s+@[\w.-]+\s*$/, "")
    .replace(/\s*\((?:(?:PR\s+)?#\d+(?:,\s*)?)+\)\s*$/, "")
    .trim();
}

/** Položky jednoho stabilního vydání; ostatní vydání a neznámé oddíly vrátí []. */
export async function parseCodexRelease(r: GithubRelease): Promise<ChangelogEntry[]> {
  const m = r.tag_name.match(TAG_RE);
  if (!m || r.prerelease || r.draft || !r.published_at || !r.body) return [];
  const version = m[1]!;
  const publishedAt = new Date(r.published_at);
  if (Number.isNaN(publishedAt.getTime())) return [];
  const out: ChangelogEntry[] = [];
  let section: Section = null;
  let ord = 0;
  const seen = new Set<string>();
  // Odsazení se mezi vydáními liší (celé tělo odsazené, položky o mezeru dovnitř):
  // první odrážka oddílu určí úroveň položek, hlouběji odsazené jsou rozpis.
  let base = -1;
  for (const line of r.body.replace(/\r\n/g, "\n").split("\n")) {
    const sec = line.match(/^\s*#{2,4}\s+(.+?)\s*$/);
    if (sec) {
      const key = sec[1]!.toLowerCase().replace(/[^a-z ]/g, "").trim();
      section = SECTION_TYPES[key] ?? null;
      base = -1;
      continue;
    }
    const item = line.match(/^(\s*)[-*]\s+(.+)$/);
    if (!item || !section) continue;
    const depth = item[1]!.length;
    if (base < 0) base = depth;
    if (depth > base + 1) continue;
    const text = cleanItem(item[2]!);
    if (text.length < 8) continue;
    ord++;
    let id = `codex:${version}#${await sha8(text)}`;
    if (seen.has(id)) id = `${id}-${ord}`;
    seen.add(id);
    out.push({ id, version, publishedAt, ord, type: section.type, scope: section.scope ?? null, text });
  }
  return out;
}

export async function latestStoredCodexVersion(db: Db): Promise<string | null> {
  const rows = await db.selectDistinct({ v: ccChangeItem.version }).from(ccChangeItem).where(eq(ccChangeItem.tool, CODEX));
  return rows.map((r) => r.v).sort(compareVersions).pop() ?? null;
}

export interface CodexSyncResult {
  /** Nejnovější stabilní verze podle GitHubu. */
  newest: string | null;
  latest: string | null;
  added: number;
  pages: number;
  /** Seznam vydání se podařilo projít od nejnovějšího (podmínka pro týdenní přehled). */
  caughtUp: boolean;
  backfilled: boolean;
}

/**
 * Denní synchronizace: stáhne strany vydání od nejnovějšího, dokud nenarazí na
 * uloženou verzi (nebo na konec, který API vydá). `token` je volitelný: bez něj
 * platí limit 60 požadavků za hodinu na IP, který sdílí i ostatní.
 */
export async function syncCodex(db: Db, opts: { token?: string; f?: typeof fetch } = {}): Promise<CodexSyncResult> {
  const f = opts.f ?? fetch;
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "user-agent": "kurzy.vibecoding.cz cc-news",
    "x-github-api-version": "2022-11-28",
  };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  const stored = await latestStoredCodexVersion(db);
  const collected: ChangelogEntry[] = [];
  let newest: string | null = null;
  let pages = 0;
  let reachedStored = false;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await f(CODEX_RELEASES_URL(page), { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`codex releases page ${page} failed: ${res.status}`);
    const list = (await res.json()) as GithubRelease[];
    pages++;
    if (!Array.isArray(list) || list.length === 0) break;
    for (const r of list) {
      const v = r.tag_name.match(TAG_RE)?.[1];
      if (!v || r.prerelease || r.draft) continue;
      if (!newest || compareVersions(v, newest) > 0) newest = v;
      if (stored && compareVersions(v, stored) <= 0) {
        reachedStored = true;
        continue;
      }
      collected.push(...(await parseCodexRelease(r)));
    }
    if (reachedStored) break;
  }
  const added = await syncChangelogEntries(db, collected, CODEX);
  const latest = await latestStoredCodexVersion(db);
  return {
    newest, latest, added, pages,
    // Uložená verze může zaostávat za nejnovější, když vydání nemá žádnou položku
    // produktu (jen seznam PR); rozhoduje, že se seznam od nejnovějšího prošel.
    caughtUp: newest !== null,
    backfilled: !stored,
  };
}
