// Sběr změn Grok Build (xAI) pro interní sledování nástrojů.
//
// Zdroje (ověřeno 17. 10. 2026, viz docs/cc-news-changelog/vice-zdroju.md):
// - x.ai/cli/stable                         číslo nejnovější verze (např. 1.0.62)
// - x.ai/cli/changelogs/<v>.external.md     changelog verze: „# 1.0.60 — 2026-10-15“,
//                                           oddíly Features / Bug Fixes / Performance / Breaking Changes;
//                                           totéž ukazuje /release_notes v CLI
// - GitHub xai-org/grok-build, crates/codegen/xai-grok-shell/CHANGELOG.md
//                                           celá historie (od 0.2.58), jen pro první naplnění;
//                                           repo se synchronizuje nepravidelně, proto ne denně
// - docs.x.ai/build/*                       dokumentace (sitemap + .md), snímky jako u Claude Code
// Stránka x.ai/changelog/build je za ochranou Cloudflare proti botům (403), z workeru nejde.

import { and, eq, gte, lte } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";
import { ccChangeItem } from "../../db/schema";
import { compareVersions, sha8, type ChangeType, type ChangelogEntry } from "../cc-news/changelog-source";
import { syncChangelogEntries } from "../cc-news/classify";
import type { DocsSource } from "../cc-news/docs-snapshot";
import type { ToolKey } from "./registry";

type Db = ReturnType<typeof drizzle>;

export const GROK_BUILD: ToolKey = "grok-build";
const STABLE_URL = "https://x.ai/cli/stable";
const VERSION_MD_URL = (v: string) => `https://x.ai/cli/changelogs/${v}.external.md`;
export const GITHUB_CHANGELOG_URL = "https://raw.githubusercontent.com/xai-org/grok-build/main/crates/codegen/xai-grok-shell/CHANGELOG.md";
const FETCH_TIMEOUT_MS = 15_000;
/** Strop stažených verzí na jeden běh (subrequesty cronu); zbytek dožene další den. */
export const MAX_VERSIONS_PER_RUN = 30;
/** O kolik patch verzí dopředu hledat, když některá chybí (přeskočené číslo). */
const PATCH_LOOKAHEAD = 3;

export const GROK_BUILD_DOCS: DocsSource = {
  name: "Grok Build",
  sitemapUrl: "https://docs.x.ai/sitemap.xml",
  prefix: "https://docs.x.ai/build/",
  kv: "tool-docs:grok-build",
  skip: [],
};

const SECTION_TYPES: Record<string, { type: ChangeType; scope?: string }> = {
  "features": { type: "Added" },
  "bug fixes": { type: "Fixed" },
  "performance": { type: "Improved" },
  // Nekompatibilní změna: třídění ji vždy povýší na význam 3.
  "breaking changes": { type: "Changed", scope: "Breaking" },
};

const VERSION_RE = /^\d+\.\d+\.\d+$/;

/**
 * Rozloží changelog Grok Build (jedna verze z CDN i celý soubor z GitHubu).
 * Verze bez data se přeskočí (bez data ji nejde zařadit do týdne).
 */
export async function parseGrokChangelog(md: string, minVersion = "0.0.0"): Promise<ChangelogEntry[]> {
  const out: ChangelogEntry[] = [];
  const heads = [...md.matchAll(/^# (\d+\.\d+\.\d+)\s+[—–-]\s+(\d{4}-\d{2}-\d{2})\s*$/gm)];
  for (const [n, h] of heads.entries()) {
    const version = h[1]!;
    if (compareVersions(version, minVersion) < 0) continue;
    const publishedAt = new Date(`${h[2]}T12:00:00Z`);
    if (Number.isNaN(publishedAt.getTime())) continue;
    const body = md.slice(h.index! + h[0].length, heads[n + 1]?.index ?? md.length);
    let section: { type: ChangeType; scope?: string } = { type: "Other" };
    let ord = 0;
    const seen = new Set<string>();
    for (const line of body.split("\n")) {
      const sec = line.match(/^##\s+(.+?)\s*$/);
      if (sec) {
        section = SECTION_TYPES[sec[1]!.toLowerCase()] ?? { type: "Other" };
        continue;
      }
      const item = line.match(/^[-*]\s+(.+)$/);
      if (!item) continue;
      const text = item[1]!.trim();
      ord++;
      let id = `grok-build:${version}#${await sha8(text)}`;
      if (seen.has(id)) id = `${id}-${ord}`;
      seen.add(id);
      out.push({ id, version, publishedAt, ord, type: section.type, scope: section.scope ?? null, text });
    }
  }
  return out.sort((a, b) => compareVersions(a.version, b.version) || a.ord - b.ord);
}

/** Kandidáti na další verzi: patch+1…+N, pak další minor a major. */
export function nextVersionCandidates(v: string): string[] {
  const [ma, mi, pa] = v.split(".").map(Number) as [number, number, number];
  return [
    ...Array.from({ length: PATCH_LOOKAHEAD }, (_, i) => `${ma}.${mi}.${pa + i + 1}`),
    `${ma}.${mi + 1}.0`,
    `${ma + 1}.0.0`,
  ];
}

/** Nejvyšší uložená verze Grok Build, nebo null. */
export async function latestStoredGrokVersion(db: Db): Promise<string | null> {
  const rows = await db.selectDistinct({ v: ccChangeItem.version }).from(ccChangeItem).where(eq(ccChangeItem.tool, GROK_BUILD));
  return rows.map((r) => r.v).sort(compareVersions).pop() ?? null;
}

export interface GrokSyncResult {
  stable: string;
  /** Uložená řada dohnala stable (podmínka pro týdenní přehled). */
  caughtUp: boolean;
  /** Nejvyšší uložená verze po běhu. */
  latest: string | null;
  added: number;
  fetchedVersions: string[];
  /** V řadě verzí chyběla verze (mezera); zaceluje se staženým souborem stable verze. */
  gap: boolean;
  backfilled: boolean;
}

/**
 * Denní synchronizace: doplní verze od poslední uložené po `stable`. Prázdná
 * tabulka se nejdřív naplní historií z GitHubu. Mezera v řadě (verze, kterou
 * nelze najít) se hlásí jako `gap` — invariant „žádný zdroj se neztratil“.
 */
export async function syncGrokBuild(db: Db, f: typeof fetch = fetch): Promise<GrokSyncResult> {
  const get = async (url: string): Promise<string | null> => {
    const res = await f(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`grok-build fetch ${url} failed: ${res.status}`);
    return res.text();
  };

  const stable = (await get(STABLE_URL))?.trim() ?? "";
  if (!VERSION_RE.test(stable)) throw new Error(`grok-build: neplatná stable verze „${stable.slice(0, 40)}“`);

  let added = 0;
  let backfilled = false;
  let latest = await latestStoredGrokVersion(db);
  if (!latest) {
    const md = await get(GITHUB_CHANGELOG_URL);
    if (md) {
      const entries = await parseGrokChangelog(md);
      added += await syncChangelogEntries(db, entries, GROK_BUILD);
      latest = entries.map((e) => e.version).sort(compareVersions).pop() ?? null;
      backfilled = true;
    }
  }

  const fetchedVersions: string[] = [];
  const collected: ChangelogEntry[] = [];
  let gap = false;
  let fetches = 0;
  const take = async (ver: string): Promise<boolean> => {
    const md = await get(VERSION_MD_URL(ver));
    fetches++;
    if (md === null) return false;
    collected.push(...await parseGrokChangelog(md));
    fetchedVersions.push(ver);
    latest = ver;
    return true;
  };
  // Bez historie začni od stable (nic staršího stejně neumíme dohledat).
  if (!latest) await take(stable);
  // Dál po řadě; i za stable, protože x.ai/cli/stable se za vydáním zpožďuje.
  while (latest && fetches < MAX_VERSIONS_PER_RUN) {
    let found = false;
    for (const cand of nextVersionCandidates(latest)) {
      if (fetches >= MAX_VERSIONS_PER_RUN) break;
      if (await take(cand)) { found = true; break; }
    }
    if (found) continue;
    if (compareVersions(latest, stable) < 0 && fetches < MAX_VERSIONS_PER_RUN) {
      // Mezera v řadě: soubor stable verze obsahuje i předchozí verze, zacelí většinu.
      gap = true;
      if (await take(stable)) continue;
    }
    break;
  }
  // Soubory verzí se překrývají (soubor obsahuje i starší verze): každá položka jednou.
  const unique = [...new Map(collected.map((e) => [e.id, e])).values()];
  added += await syncChangelogEntries(db, unique, GROK_BUILD);
  const caughtUp = !!latest && compareVersions(latest, stable) >= 0;
  return { stable, caughtUp, latest, added, fetchedVersions, gap, backfilled };
}

/** Položky Grok Build vydané v intervalu (pro týdenní přehled). */
export async function grokEntriesBetween(db: Db, start: Date, end: Date) {
  return db.select().from(ccChangeItem)
    .where(and(eq(ccChangeItem.tool, GROK_BUILD), gte(ccChangeItem.publishedAt, start), lte(ccChangeItem.publishedAt, end)));
}
