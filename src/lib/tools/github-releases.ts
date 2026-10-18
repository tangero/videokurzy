// Společný sběr změn nástrojů z GitHub releases (Codex CLI, Antigravity CLI).
// Strany se stahují od nejnovějšího vydání, dokud se nenarazí na uloženou verzi
// nebo na konec, který API vydá (nejvýš 1000 vydání). Parsování poznámek je
// specifické pro nástroj.

import { eq } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";
import { ccChangeItem } from "../../db/schema";
import { compareVersions, type ChangelogEntry } from "../cc-news/changelog-source";
import { syncChangelogEntries } from "../cc-news/classify";
import type { ToolKey } from "./registry";

type Db = ReturnType<typeof drizzle>;

const FETCH_TIMEOUT_MS = 15_000;
/** Strop stran na jeden běh; první naplnění projde všech 10 stran, které API vydá. */
export const MAX_PAGES = 10;

export interface GithubRelease {
  tag_name: string;
  prerelease: boolean;
  draft: boolean;
  published_at: string | null;
  body: string | null;
}

export const releasesUrl = (repo: string, page: number) => `https://api.github.com/repos/${repo}/releases?per_page=100&page=${page}`;

export interface ReleasesSource {
  tool: ToolKey;
  repo: string; // „openai/codex“
  /** Verze ze stabilního tagu, jinak null (předběžná vydání, jiné balíčky). */
  version: (r: GithubRelease) => string | null;
  parse: (r: GithubRelease) => Promise<ChangelogEntry[]>;
}

export interface ReleasesSyncResult {
  /** Nejnovější stabilní verze podle GitHubu. */
  newest: string | null;
  latest: string | null;
  added: number;
  pages: number;
  /** Seznam vydání se podařilo projít od nejnovějšího (podmínka pro týdenní přehled). */
  caughtUp: boolean;
  backfilled: boolean;
}

export async function latestStoredVersion(db: Db, tool: ToolKey): Promise<string | null> {
  const rows = await db.selectDistinct({ v: ccChangeItem.version }).from(ccChangeItem).where(eq(ccChangeItem.tool, tool));
  return rows.map((r) => r.v).sort(compareVersions).pop() ?? null;
}

/**
 * Denní synchronizace z GitHub releases. `token` je volitelný: bez něj platí
 * limit 60 požadavků za hodinu na IP, který sdílí i ostatní.
 */
export async function syncGithubReleases(db: Db, src: ReleasesSource, opts: { token?: string; f?: typeof fetch } = {}): Promise<ReleasesSyncResult> {
  const f = opts.f ?? fetch;
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "user-agent": "kurzy.vibecoding.cz cc-news",
    "x-github-api-version": "2022-11-28",
  };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  const stored = await latestStoredVersion(db, src.tool);
  const collected: ChangelogEntry[] = [];
  let newest: string | null = null;
  let pages = 0;
  let reachedStored = false;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await f(releasesUrl(src.repo, page), { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`${src.tool} releases page ${page} failed: ${res.status}`);
    const list = (await res.json()) as GithubRelease[];
    pages++;
    if (!Array.isArray(list) || list.length === 0) break;
    for (const r of list) {
      const v = r.prerelease || r.draft ? null : src.version(r);
      if (!v) continue;
      if (!newest || compareVersions(v, newest) > 0) newest = v;
      if (stored && compareVersions(v, stored) <= 0) {
        reachedStored = true;
        continue;
      }
      collected.push(...(await src.parse(r)));
    }
    if (reachedStored) break;
  }
  const added = await syncChangelogEntries(db, collected, src.tool);
  const latest = await latestStoredVersion(db, src.tool);
  return {
    newest, latest, added, pages,
    // Uložená verze může zaostávat za nejnovější, když vydání nemá žádnou položku
    // produktu (jen seznam PR); rozhoduje, že se seznam od nejnovějšího prošel.
    caughtUp: newest !== null,
    backfilled: !stored,
  };
}
