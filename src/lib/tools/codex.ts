// Sběr změn Codex CLI (OpenAI) pro sledování nástrojů.
//
// Zdroj (ověřeno 18. 10. 2026): GitHub releases `openai/codex`, stabilní vydání
// s tagem `rust-v<verze>` (předběžná vydání, `python-v*` SDK a koncepty se
// vynechávají). CHANGELOG.md v repu jen odkazuje na stránku releases.
// Poznámky vydání mají oddíly „## New Features“, „## Bug Fixes“, „## Documentation“,
// „## Chores“ a seznam PR („## Changelog“, starší „### PRs Merged“), který se nesbírá.
// Starší vydání (do 0.59) mají místo New Features oddíl „### Highlights“.
// API vrací nejvýš 1000 vydání (10 stran po 100, včetně předběžných): historie
// proto sahá zhruba do listopadu 2025. Stahování stran: github-releases.ts.

import type { drizzle } from "drizzle-orm/d1";
import { sha8, type ChangeType, type ChangelogEntry } from "../cc-news/changelog-source";
import { releasesUrl, syncGithubReleases, type GithubRelease, type ReleasesSource, type ReleasesSyncResult } from "./github-releases";
import type { ToolKey } from "./registry";

type Db = ReturnType<typeof drizzle>;

export const CODEX: ToolKey = "codex";

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

export const CODEX_SOURCE: ReleasesSource = {
  tool: CODEX,
  repo: "openai/codex",
  version: (r) => r.tag_name.match(TAG_RE)?.[1] ?? null,
  parse: parseCodexRelease,
};

export const CODEX_RELEASES_URL = (page: number) => releasesUrl(CODEX_SOURCE.repo, page);

export function syncCodex(db: Db, opts: { token?: string; f?: typeof fetch } = {}): Promise<ReleasesSyncResult> {
  return syncGithubReleases(db, CODEX_SOURCE, opts);
}

export type { GithubRelease };
