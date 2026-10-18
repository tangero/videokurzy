// Sběr změn Antigravity CLI (Google, příkaz `agy`) pro sledování nástrojů.
//
// Zdroj (ověřeno 18. 10. 2026): GitHub releases `google-antigravity/antigravity-cli`,
// tagy `<verze>` (1.4.1), historie od 1.0.4 (1. 6. 2026), vydání skoro denně.
// Poznámky jsou jen odrážky bez oddílů; typ určuje první slovo
// (Added / Improved / Fixed / Changed / Removed / Deprecated).
// Oficiální stránka antigravity.google/changelog (karty 2.0 / CLI / SDK / IDE)
// se vykresluje v prohlížeči, proto ji nesbíráme.

import type { drizzle } from "drizzle-orm/d1";
import { sha8, type ChangeType, type ChangelogEntry } from "../cc-news/changelog-source";
import { syncGithubReleases, type GithubRelease, type ReleasesSource, type ReleasesSyncResult } from "./github-releases";
import type { ToolKey } from "./registry";

type Db = ReturnType<typeof drizzle>;

export const ANTIGRAVITY: ToolKey = "antigravity";
const TAG_RE = /^v?(\d+\.\d+\.\d+)$/;

const VERB_TYPES: Record<string, ChangeType> = {
  added: "Added", add: "Added", new: "Added", introduced: "Added",
  improved: "Improved", improve: "Improved", hardened: "Improved", reduced: "Improved", enriched: "Improved", optimized: "Improved", sped: "Improved",
  enabled: "Added", supported: "Added",
  fixed: "Fixed", fix: "Fixed",
  changed: "Changed", updated: "Changed", renamed: "Changed",
  removed: "Removed", deprecated: "Deprecated",
};

export async function parseAntigravityRelease(r: GithubRelease): Promise<ChangelogEntry[]> {
  const m = r.tag_name.match(TAG_RE);
  if (!m || r.prerelease || r.draft || !r.published_at || !r.body) return [];
  const version = m[1]!;
  const publishedAt = new Date(r.published_at);
  if (Number.isNaN(publishedAt.getTime())) return [];
  const out: ChangelogEntry[] = [];
  const seen = new Set<string>();
  let ord = 0;
  for (const line of r.body.replace(/\r\n/g, "\n").split("\n")) {
    // Jen odrážky první úrovně (odsazené jsou rozpis nadřazené položky).
    const item = line.match(/^[-*]\s+(.+)$/);
    if (!item) continue;
    const text = item[1]!.trim();
    if (text.length < 8) continue;
    const verb = text.match(/^[A-Za-z]+/)?.[0]?.toLowerCase() ?? "";
    ord++;
    let id = `antigravity:${version}#${await sha8(text)}`;
    if (seen.has(id)) id = `${id}-${ord}`;
    seen.add(id);
    out.push({ id, version, publishedAt, ord, type: VERB_TYPES[verb] ?? "Other", scope: null, text });
  }
  return out;
}

export const ANTIGRAVITY_SOURCE: ReleasesSource = {
  tool: ANTIGRAVITY,
  repo: "google-antigravity/antigravity-cli",
  version: (r) => r.tag_name.match(TAG_RE)?.[1] ?? null,
  parse: parseAntigravityRelease,
};

export function syncAntigravity(db: Db, opts: { token?: string; f?: typeof fetch } = {}): Promise<ReleasesSyncResult> {
  return syncGithubReleases(db, ANTIGRAVITY_SOURCE, opts);
}
