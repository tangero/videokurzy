// Zdroj „Novinky v Claude Code" od týdne 38/2026: changelog Claude Code.
//
// Oficiální týdenní přehledy (whats-new RSS) Anthropic od Week 37 nevydává.
// Položky bereme z CHANGELOG.md na GitHubu (úplný — GitHub releases některé
// verze nemají, např. 2.1.243), datum vydání každé verze ze stránky changelogu
// v dokumentaci (`<Update label="2.1.243" description="August 25, 2026">`).
//
// ID položky = `<verze>#<sha8(text)>`, ne pořadí řádku: Anthropic staré záznamy
// občas upravuje a vsunutý řádek by posunul indexy a rozhodil témata i vazby.

export const CHANGELOG_MD_URL = "https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md";
export const DOCS_CHANGELOG_URL = "https://code.claude.com/docs/en/changelog.md";
const FETCH_TIMEOUT_MS = 20_000;

export type ChangeType = "Added" | "Fixed" | "Improved" | "Changed" | "Removed" | "Deprecated" | "Other";

export interface ChangelogEntry {
  id: string;          // „2.1.274#1a2b3c4d"
  version: string;     // „2.1.274"
  publishedAt: Date;   // datum vydání verze (poledne UTC)
  ord: number;         // pořadí řádku ve verzi (1…)
  type: ChangeType;
  scope: string | null; // „VSCode", „Windows", „Self-hosted runner"…
  text: string;
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export async function sha8(s: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(digest)].slice(0, 4).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Rozloží řádek changelogu na platformu (prefix) a typ změny. */
export function parseEntryLine(line: string): { type: ChangeType; scope: string | null; text: string } {
  let text = line.replace(/^-\s+/, "").trim();
  let scope: string | null = null;
  const bracket = text.match(/^\[([^\]]+)\]\s*/);
  if (bracket) {
    scope = bracket[1]!;
    text = text.slice(bracket[0].length);
  } else {
    const colon = text.match(/^(Windows|macOS|Linux|Self-hosted runner|VS ?Code|JetBrains|Desktop|SDK|Agent SDK):\s*/i);
    if (colon) {
      scope = colon[1]!;
      text = text.slice(colon[0].length);
    }
  }
  const t = text.match(/^(Added|Fixed|Improved|Changed|Removed|Deprecated)\b/)?.[1] as ChangeType | undefined;
  return { type: t ?? "Other", scope, text };
}

/** Datum vydání každé verze z původních `<Update>` značek i nového Markdownu. */
export function parseReleaseDates(docsChangelogMd: string): Map<string, Date> {
  const dates = new Map<string, Date>();
  const add = (version: string, rawDate: string) => {
    const d = new Date(`${rawDate} 12:00 UTC`);
    if (!Number.isNaN(+d)) dates.set(version, d);
  };
  for (const m of docsChangelogMd.matchAll(/<Update label="([\d.]+)" description="([^"]+)"/g)) {
    add(m[1]!, m[2]!);
  }
  for (const m of docsChangelogMd.matchAll(/^\*\*(\d+\.\d+\.\d+)\*\*[ \t]*\r?\n(?:[ \t]*\r?\n)+([A-Za-z]+ \d{1,2}, \d{4})[ \t]*\r?$/gm)) {
    add(m[1]!, m[2]!);
  }
  return dates;
}

/**
 * Položky changelogu od `minVersion` výš (nejstarší první). Verze bez data
 * v dokumentaci se přeskočí — bez data ji neumíme zařadit do týdne.
 */
export async function parseChangelog(
  changelogMd: string,
  dates: Map<string, Date>,
  minVersion = "0.0.0",
): Promise<ChangelogEntry[]> {
  const out: ChangelogEntry[] = [];
  for (const m of changelogMd.matchAll(/^## (\d+\.\d+\.\d+)\s*\n([\s\S]*?)(?=^## |(?![\s\S]))/gm)) {
    const version = m[1]!;
    if (compareVersions(version, minVersion) < 0) continue;
    const publishedAt = dates.get(version);
    if (!publishedAt) continue;
    const lines = m[2]!.split("\n").filter((l) => /^-\s+/.test(l));
    const seen = new Set<string>();
    for (const [i, l] of lines.entries()) {
      const p = parseEntryLine(l);
      let id = `${version}#${await sha8(p.text)}`;
      // Stejný text dvakrát v jedné verzi (vzácné) → odliš pořadím.
      if (seen.has(id)) id = `${id}-${i + 1}`;
      seen.add(id);
      out.push({ id, version, publishedAt, ord: i + 1, ...p });
    }
  }
  return out.sort((a, b) => compareVersions(a.version, b.version) || a.ord - b.ord);
}

export async function fetchChangelog(minVersion = "0.0.0"): Promise<ChangelogEntry[]> {
  const get = async (url: string) => {
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`changelog fetch ${url} failed: ${res.status}`);
    return res.text();
  };
  const [md, docs] = await Promise.all([get(CHANGELOG_MD_URL), get(DOCS_CHANGELOG_URL)]);
  const versions = [...new Set(
    [...md.matchAll(/^## (\d+\.\d+\.\d+)[ \t]*$/gm)].map((m) => m[1]!),
  )];
  if (versions.length === 0) {
    throw new Error("cc-news changelog: v GitHub CHANGELOG.md nebyly rozpoznány žádné verze");
  }
  const dates = parseReleaseDates(docs);
  const missing = versions.filter((version) =>
    compareVersions(version, minVersion) >= 0 && !dates.has(version));
  if (missing.length > 0) {
    const shown = missing.slice(0, 5).join(", ");
    const rest = missing.length > 5 ? ` a dalších ${missing.length - 5} verzí` : "";
    throw new Error(
      `cc-news changelog: dokumentace neposkytla datum pro ${shown}${rest}; ` +
      "synchronizace byla přerušena, aby nevzniklo neúplné vydání",
    );
  }
  return parseChangelog(md, dates, minVersion);
}

// ─── Týdny ────────────────────────────────────────────────────────

/** ISO týden (pondělí–neděle, UTC) jako { year, week }. */
export function isoWeek(d: Date): { year: number; week: number } {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return { year: t.getUTCFullYear(), week: Math.ceil(((+t - +y0) / 86_400_000 + 1) / 7) };
}

/** Pondělí 00:00 a neděle 23:59:59.999 UTC daného ISO týdne. */
export function isoWeekBounds(year: number, week: number): { start: Date; end: Date } {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const start = new Date(jan4);
  start.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() || 7) - 1) + (week - 1) * 7);
  const end = new Date(start.getTime() + 7 * 86_400_000 - 1);
  return { start, end };
}

/** Poslední UZAVŘENÝ ISO týden vzhledem k `now` (minulý týden). */
export function lastClosedWeek(now: Date): { year: number; week: number } {
  return isoWeek(new Date(now.getTime() - 7 * 86_400_000));
}

export const weekKey = (w: { year: number; week: number }) => `${w.year}-w${String(w.week).padStart(2, "0")}`;
export const changelogSourceId = (w: { year: number; week: number }) => `/changelog/${weekKey(w)}`;

/** Rok a týden ze sourceId (`/changelog/2026-w38`, `/docs/en/whats-new/2026-w38`). */
export function weekFromSourceId(sourceId: string): { year: number; week: number } | null {
  const m = sourceId.match(/(\d{4})-w(\d{1,2})$/i);
  return m ? { year: Number(m[1]), week: Number(m[2]) } : null;
}

/** Krajní verze z `versionRange` („v2.1.270–v2.1.278", „v2.1.166 → v2.1.176"). */
export function parseVersionRange(range: string | null): { from: string; to: string } | null {
  const vs = [...(range ?? "").matchAll(/(\d+\.\d+\.\d+)/g)].map((m) => m[1]!);
  if (vs.length === 0) return null;
  return { from: vs[0]!, to: vs[vs.length - 1]! };
}

/** Kolik dní před začátkem týdne se ještě přiberou nepopsané verze (sobotní vydání). */
export const ORPHAN_DAYS = 3;

/**
 * Rozsah verzí pro článek za týden: verze vydané do konce týdne, novější než
 * konec posledního vydání (aby žádná verze nezůstala nepopsaná — např. 2.1.270
 * vyšla v sobotu po oficiálním W37). Z doby před týdnem se berou jen verze
 * nejvýš ORPHAN_DAYS před jeho začátkem, takže po delší pauze se nesloučí
 * několik týdnů do jednoho článku (zpětné týdny se tvoří zvlášť).
 * Bez nových verzí vrací null.
 */
export function weekVersionRange(
  entries: Pick<ChangelogEntry, "version" | "publishedAt">[],
  lastPublishedTo: string | null,
  weekStart: Date,
  weekEnd: Date,
): { from: string; to: string; versions: string[] } | null {
  const notBefore = new Date(weekStart.getTime() - ORPHAN_DAYS * 86_400_000);
  const versions = [...new Set(
    entries
      .filter((e) => e.publishedAt <= weekEnd && e.publishedAt >= notBefore)
      .filter((e) => !lastPublishedTo || compareVersions(e.version, lastPublishedTo) > 0)
      .map((e) => e.version),
  )].sort(compareVersions);
  if (versions.length === 0) return null;
  return { from: versions[0]!, to: versions[versions.length - 1]!, versions };
}
