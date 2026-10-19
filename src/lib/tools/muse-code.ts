// Sběr změn Muse Code (Meta) pro sledování nástrojů.
//
// Zdroje (ověřeno 19. 10. 2026, viz docs/cc-news-changelog/vice-zdroju.md):
// - dev.meta.ai/docs/muse-code/changelog.md   text všech verzí (Markdown): „## 1.4.10“, oddíly
//                                             New / Improvements / Fixes / Performance, „**Security:**“
//                                             na začátku odrážky. Data u verzí NEJSOU.
// - registry.npmjs.org/@muse-code/sdk         pole `time`: čas vydání SDK; čísla verzí SDK jsou
//                                             shodná s aplikací (1.4.10 = 1.4.10), ale ne všechna
// - GitHub meta-models/muse-code-sdk          commity „remirror: 1.4.10 …“ a „(1.4.2 lockstep)“
// Datum verze = nejdřívější z npm a commitu. Verze bez něj (1.4.5, 1.4.0 …) dostane datum
// nejbližší vyšší verze s datem (vydáno nejpozději tehdy; Patrick odsouhlasil 19. 10. 2026),
// nejnovější verze bez data den, kdy ji cron poprvé uviděl (KV, aby se neposouvalo).
// Dokumentace se zatím nesnímkuje: sitemap dev.meta.ai nemá <lastmod>.

import type { drizzle } from "drizzle-orm/d1";
import { compareVersions, sha8, type ChangeType, type ChangelogEntry } from "../cc-news/changelog-source";
import { syncChangelogEntries } from "../cc-news/classify";
import type { ToolKey } from "./registry";

type Db = ReturnType<typeof drizzle>;

export const MUSE_CODE: ToolKey = "muse-code";
export const CHANGELOG_MD_URL = "https://dev.meta.ai/docs/muse-code/changelog.md";
export const NPM_URL = "https://registry.npmjs.org/@muse-code%2fsdk";
export const COMMITS_URL = "https://api.github.com/repos/meta-models/muse-code-sdk/commits?per_page=100";
export const FIRST_SEEN_KV = "tools:muse-code:first-seen";
const FETCH_TIMEOUT_MS = 15_000;

const SECTION_TYPES: Record<string, ChangeType> = {
  new: "Added",
  improvements: "Improved",
  fixes: "Fixed",
  performance: "Improved",
};

export interface MuseVersion {
  version: string;
  items: { type: ChangeType; scope: string | null; text: string }[];
}

/** Rozloží changelog.md na verze a odrážky; souhrnné oddíly („1.0.x“) a verze bez odrážek vynechá. */
export function parseMuseChangelog(md: string): MuseVersion[] {
  const out: MuseVersion[] = [];
  const heads = [...md.matchAll(/^## (\d+\.\d+\.\d+)\s*$/gm)];
  for (const [n, h] of heads.entries()) {
    const body = md.slice(h.index! + h[0].length, heads[n + 1]?.index ?? md.length).split(/^## /m)[0]!;
    let type: ChangeType = "Other";
    const items: MuseVersion["items"] = [];
    for (const line of body.split("\n")) {
      const sec = line.match(/^###\s+(.+?)\s*$/);
      if (sec) {
        type = SECTION_TYPES[sec[1]!.toLowerCase()] ?? "Other";
        continue;
      }
      const item = line.match(/^[-*]\s+(.+)$/);
      if (!item) continue;
      let text = item[1]!.trim();
      let scope: string | null = null;
      const sc = text.match(/^\*\*([A-Z][A-Za-z ]{1,30}):\*\*\s+/);
      if (sc) {
        scope = sc[1]!;
        text = text.slice(sc[0].length);
      }
      if (text.length < 8) continue;
      items.push({ type, scope, text });
    }
    if (items.length) out.push({ version: h[1]!, items });
  }
  return out;
}

interface Commit { commit: { message: string; committer: { date: string } } }

/** Data vydání z npm (`time`) a commitů repa SDK: nejdřívější výskyt každé verze. */
export function releaseDates(npmTime: Record<string, string>, commits: Commit[]): Map<string, Date> {
  const out = new Map<string, Date>();
  const put = (v: string, iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return;
    const prev = out.get(v);
    if (!prev || d < prev) out.set(v, d);
  };
  for (const [v, iso] of Object.entries(npmTime)) if (/^\d+\.\d+\.\d+$/.test(v)) put(v, iso);
  for (const c of commits) {
    const first = c.commit.message.split("\n")[0] ?? "";
    const m = first.match(/^remirror: (\d+\.\d+\.\d+)\b/) ?? first.match(/\((\d+\.\d+\.\d+) lockstep\b/);
    if (m) put(m[1]!, c.commit.committer.date);
  }
  return out;
}

/**
 * Datum každé verze z changelogu: známé datum, jinak nejbližší vyšší verze se známým
 * datem (horní mez), jinak den prvního výskytu (doplní `firstSeen`).
 */
export function resolveDates(
  versions: string[], known: Map<string, Date>, firstSeen: Record<string, string>, now: Date,
): { dates: Map<string, Date>; approx: string[]; firstSeen: Record<string, string> } {
  const dated = [...known.entries()].sort((a, b) => compareVersions(a[0], b[0]));
  const dates = new Map<string, Date>();
  const approx: string[] = [];
  const seen = { ...firstSeen };
  for (const v of versions) {
    const exact = known.get(v);
    if (exact) {
      dates.set(v, exact);
      continue;
    }
    approx.push(v);
    const upper = dated.filter(([k]) => compareVersions(k, v) > 0).map(([, d]) => d).sort((a, b) => a.getTime() - b.getTime())[0];
    if (upper) {
      dates.set(v, upper);
      continue;
    }
    seen[v] ??= now.toISOString();
    dates.set(v, new Date(seen[v]!));
  }
  return { dates, approx, firstSeen: seen };
}

export interface MuseSyncResult {
  /** Nejnovější verze v changelogu. */
  latest: string | null;
  versions: number;
  added: number;
  /** Verze bez vlastního data (datum odhadnuté jako horní mez nebo první výskyt). */
  approx: string[];
  /** Vydané verze (npm/GitHub), které changelog ještě nemá; dokumentace se zpožďuje. */
  missing: { version: string; at: Date }[];
}

export async function syncMuseCode(
  db: Db, kv: KVNamespace, opts: { token?: string; f?: typeof fetch; now?: Date } = {},
): Promise<MuseSyncResult> {
  const f = opts.f ?? fetch;
  const now = opts.now ?? new Date();
  const res = await f(CHANGELOG_MD_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`muse-code changelog fetch failed: ${res.status}`);
  const parsed = parseMuseChangelog(await res.text());
  if (!parsed.length) throw new Error("muse-code changelog: žádná verze (změnil se formát?)");

  // Zdroje dat: výpadek jednoho nevadí, obou ano (bez dat by se historie zařadila do dneška).
  const getJson = async <T>(url: string, headers: Record<string, string>): Promise<T | null> => {
    try {
      const r = await f(url, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      return r.ok ? ((await r.json()) as T) : null;
    } catch {
      return null;
    }
  };
  const npm = await getJson<{ time?: Record<string, string> }>(NPM_URL, { accept: "application/json" });
  const commits = await getJson<Commit[]>(COMMITS_URL, {
    accept: "application/vnd.github+json", "user-agent": "videokurzy",
    ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
  });
  if (!npm?.time && !Array.isArray(commits)) throw new Error("muse-code: nedostupné npm i GitHub, data verzí nejde určit");
  const known = releaseDates(npm?.time ?? {}, Array.isArray(commits) ? commits : []);

  const versions = parsed.map((p) => p.version);
  const prevSeen = (await kv.get<Record<string, string>>(FIRST_SEEN_KV, "json")) ?? {};
  const { dates, approx, firstSeen } = resolveDates(versions, known, prevSeen, now);
  if (Object.keys(firstSeen).length !== Object.keys(prevSeen).length) await kv.put(FIRST_SEEN_KV, JSON.stringify(firstSeen));

  const entries: ChangelogEntry[] = [];
  for (const p of parsed) {
    const seen = new Set<string>();
    for (const [i, it] of p.items.entries()) {
      let id = `muse-code:${p.version}#${await sha8(it.text)}`;
      if (seen.has(id)) id = `${id}-${i + 1}`;
      seen.add(id);
      entries.push({ id, version: p.version, publishedAt: dates.get(p.version)!, ord: i + 1, type: it.type, scope: it.scope, text: it.text });
    }
  }
  const added = await syncChangelogEntries(db, entries, MUSE_CODE);

  const latest = [...versions].sort(compareVersions).pop() ?? null;
  const missing = [...known.entries()]
    .filter(([v]) => latest && compareVersions(v, latest) > 0)
    .map(([version, at]) => ({ version, at }))
    .sort((a, b) => compareVersions(a.version, b.version));
  return { latest, versions: parsed.length, added, approx, missing };
}
