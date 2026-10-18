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
/**
 * REST vrací u každého vydání i seznam binárek (`assets`), 99 % objemu: u Codexu
 * má strana po 25 vydáních 13 MB a strana po 100 se useknula nebo skončila 504
 * (18. 10. 2026). S tokenem se proto stahuje přes GraphQL jen potřebná pole
 * (100 vydání ≈ 120 kB), bez tokenu REST po malých stranách. API vydá nejvýš
 * 1000 vydání.
 */
export const MAX_RELEASES = 1000;
export const PER_PAGE = 10;
export const MAX_PAGES = MAX_RELEASES / PER_PAGE;
const GQL_PAGE = 100;
const PAGE_ATTEMPTS = 3;

export interface GithubRelease {
  tag_name: string;
  prerelease: boolean;
  draft: boolean;
  published_at: string | null;
  body: string | null;
}

export const releasesUrl = (repo: string, page: number) => `https://api.github.com/repos/${repo}/releases?per_page=${PER_PAGE}&page=${page}`;

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

/** Jeden požadavek s JSON odpovědí; chyba serveru, výpadek spojení nebo useknutý JSON se zkusí znovu. */
async function fetchJson<T>(f: typeof fetch, url: string, init: RequestInit, label: string): Promise<T> {
  let last: unknown;
  for (let attempt = 1; attempt <= PAGE_ATTEMPTS; attempt++) {
    try {
      const res = await f(url, { ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      // 4xx (limit, oprávnění) se opakováním nespraví.
      if (!res.ok && res.status < 500) throw new Error(`${label} failed: ${res.status}`, { cause: "final" });
      if (!res.ok) throw new Error(`${label} failed: ${res.status}`);
      return JSON.parse(await res.text()) as T;
    } catch (e) {
      if (e instanceof Error && e.cause === "final") throw e;
      last = e;
    }
  }
  throw last instanceof Error ? last : new Error(`${label} failed`);
}

const RELEASES_QUERY = `query($owner: String!, $name: String!, $after: String) {
  repository(owner: $owner, name: $name) {
    releases(first: ${GQL_PAGE}, after: $after, orderBy: {field: CREATED_AT, direction: DESC}) {
      pageInfo { hasNextPage endCursor }
      nodes { tagName isPrerelease isDraft publishedAt description }
    }
  }
}`;

interface GqlReleases {
  data?: { repository?: { releases?: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: { tagName: string; isPrerelease: boolean; isDraft: boolean; publishedAt: string | null; description: string | null }[];
  } } };
  errors?: { message: string }[];
}

/** Strany vydání od nejnovějšího; s tokenem GraphQL, jinak (nebo když GraphQL token odmítne) REST. */
async function* releasePages(f: typeof fetch, src: ReleasesSource, headers: Record<string, string>): AsyncGenerator<GithubRelease[]> {
  if (headers.authorization) {
    const [owner, name] = src.repo.split("/");
    let after: string | null = null;
    let first = true;
    for (let fetched = 0; fetched < MAX_RELEASES; fetched += GQL_PAGE) {
      let body: GqlReleases;
      try {
        body = await fetchJson<GqlReleases>(f, "https://api.github.com/graphql", {
          method: "POST", headers, body: JSON.stringify({ query: RELEASES_QUERY, variables: { owner, name, after } }),
        }, `${src.tool} releases graphql`);
      } catch (e) {
        // Token bez práva na GraphQL: dál bez tokenu přes REST, jen na první straně.
        if (first && e instanceof Error && /failed: 40[13]$/.test(e.message)) break;
        throw e;
      }
      const rel = body.data?.repository?.releases;
      // GraphQL hlásí odepřený přístup i odpovědí 200 s `errors`.
      if (!rel && first) break;
      if (!rel) throw new Error(`${src.tool} releases graphql: ${body.errors?.[0]?.message ?? "no data"}`);
      first = false;
      yield rel.nodes.map((n) => ({ tag_name: n.tagName, prerelease: n.isPrerelease, draft: n.isDraft, published_at: n.publishedAt, body: n.description }));
      if (!rel.pageInfo.hasNextPage || !rel.pageInfo.endCursor) return;
      after = rel.pageInfo.endCursor;
    }
    if (!first) return;
    delete headers.authorization;
  }
  for (let page = 1; page <= MAX_PAGES; page++) {
    yield await fetchJson<GithubRelease[]>(f, releasesUrl(src.repo, page), { headers }, `${src.tool} releases page ${page}`);
  }
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
  for await (const list of releasePages(f, src, headers)) {
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
