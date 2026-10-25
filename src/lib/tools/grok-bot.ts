// Sběr změn Grok Bot (hostovaný „AI teammate“ xAI, osobní asistent, ne coding agent).
//
// Zdroje (ověřeno 25. 10. 2026, viz docs/cc-news-changelog/vice-zdroju.md):
// - x.ai/changelog/bot   changelog; z workeru 403 (ochrana Cloudflare proti botům).
//                        Ochranu neobcházíme: stránku čteme přes Exa contents API
//                        (POST api.exa.ai/contents, secret EXA_API_KEY), které vrací
//                        text stránky jako markdown.
// - docs.x.ai/grok-bot/* dokumentace (sitemap + .md), snímky jako u Grok Build.
//
// Tvar textu z Exa (25. 10. 2026, výpis v tests/lib/fixtures/grok-bot-changelog.ts):
//   Latest v0.75.5· Oct 23, 2026· RSS
//   October 23, 2026 Oct 23, 2026        ← začátek bloku (vydání)
//   v0.75.5                              ← verze; u části bloků chybí
//   ## Vault, email forwarding, …        ← název vydání (volitelný)
//   Also includes 0.75.3 and 0.75.4      ← další verze v bloku (volitelné)
//   ### New / ### Improved / ### Fixed   ← oddíly; Exa část nadpisů vynechá
//   - položka … Teams                    ← koncové „Teams“/„Enterprise“ = scope
// Skupiny položek oddělené prázdným řádkem bez nadpisu jsou další oddíly v pořadí
// New → Improved → Fixed (ověřeno na textu položek, např. v0.68.0).

import type { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { ccChangeItem } from "../../db/schema";
import { compareVersions, sha8, type ChangeType, type ChangelogEntry } from "../cc-news/changelog-source";
import { syncChangelogEntries } from "../cc-news/classify";
import type { DocsSource } from "../cc-news/docs-snapshot";
import type { ToolKey } from "./registry";

type Db = ReturnType<typeof drizzle>;

export const GROK_BOT: ToolKey = "grok-bot";
export const GROK_BOT_CHANGELOG_URL = "https://x.ai/changelog/bot";
const EXA_CONTENTS_URL = "https://api.exa.ai/contents";
const FETCH_TIMEOUT_MS = 60_000;
/** Starší kopie stránky z cache Exa nepoužít (cron běží denně, vydání bývají i v neděli). */
const EXA_MAX_AGE_HOURS = 6;
/** Od této verze se changelog ukládá (první naplnění webu, asi 3 týdny před spuštěním). */
export const GROK_BOT_MIN_VERSION = "0.68.0";

export const GROK_BOT_DOCS: DocsSource = {
  name: "Grok Bot",
  sitemapUrl: "https://docs.x.ai/sitemap.xml",
  prefix: "https://docs.x.ai/grok-bot/",
  kv: "tool-docs:grok-bot",
  skip: [],
};

/** Metadata vydání (název, další verze v bloku) pro český zápis. KV `tools:releases:<tool>`. */
export interface AssistantRelease {
  /** Verze bloku; u bloku bez verze syntetická `<předchozí verze>.<n>` (viz parseGrokBotChangelog). */
  version: string;
  synthetic: boolean;
  date: string;
  title: string | null;
  alsoIncludes: string[];
  items: number;
}
export const toolReleasesKvKey = (tool: ToolKey) => `tools:releases:${tool}`;

export interface GrokBotParse {
  /** Verze z hlavičky „Latest v0.75.5“ (null, když hlavička chybí). */
  latest: string | null;
  releases: AssistantRelease[];
  entries: ChangelogEntry[];
  /** Neprázdné řádky uvnitř bloků, které parser nerozpoznal (nesmí se ztratit potichu). */
  unparsed: string[];
  /** Nejstarší blok v textu: mohl být useknutý limitem délky, nevrací se. */
  truncatedTail: { version: string; date: string } | null;
}

const MONTHS: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
};
const DATE_RE = /^(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})\b/;
const VERSION_LINE_RE = /^v(\d+\.\d+\.\d+)\s*$/;
const LATEST_RE = /^Latest\s+v(\d+\.\d+\.\d+)/m;
const SECTION_RE = /^#{2,4}\s+(New|Improved|Fixed)\s*$/i;
const TITLE_RE = /^#{1,3}\s+(.+?)\s*$/;
const ALSO_RE = /^Also includes\s+(.+)$/i;
const ITEM_RE = /^[-*]\s+(.+)$/;
/** Koncové štítky položek na stránce (odznaky tarifu); ve výpisu Exa jako poslední slovo. */
export const SCOPE_TAGS = ["Teams", "Enterprise"] as const;
const SCOPE_RE = new RegExp(`\\s+(${SCOPE_TAGS.join("|")})\\s*$`);

const SECTION_ORDER: ChangeType[] = ["Added", "Improved", "Fixed"];
const SECTION_TYPE: Record<string, ChangeType> = { new: "Added", improved: "Improved", fixed: "Fixed" };

interface RawBlock {
  date: Date;
  dateText: string;
  version: string | null;
  title: string | null;
  alsoIncludes: string[];
  /** Skupiny položek v pořadí na stránce; type null = oddíl bez nadpisu. */
  groups: { type: ChangeType | null; labelled: boolean; items: string[] }[];
}

/** Odstraní koncový štítek Teams/Enterprise a vrátí ho jako scope. */
export function splitScope(text: string): { text: string; scope: string | null } {
  const m = text.match(SCOPE_RE);
  if (!m) return { text: text.trim(), scope: null };
  return { text: text.slice(0, m.index).trim(), scope: m[1]! };
}

/**
 * Typy skupin bloku. Nadpis platí pro svou skupinu; skupina bez nadpisu za
 * skupinou s typem je další oddíl v pořadí New → Improved → Fixed. Blok úplně bez
 * nadpisů: tři skupiny = New, Improved, Fixed; jiný počet nejde určit → Other.
 */
function resolveGroupTypes(groups: RawBlock["groups"]): ChangeType[] {
  if (!groups.some((g) => g.labelled)) {
    return groups.length === 3 ? [...SECTION_ORDER] : groups.map(() => "Other");
  }
  const out: ChangeType[] = [];
  let prev: ChangeType | null = null;
  for (const g of groups) {
    let t: ChangeType;
    if (g.labelled && g.type) t = g.type;
    else if (prev && SECTION_ORDER.includes(prev)) t = SECTION_ORDER[SECTION_ORDER.indexOf(prev) + 1] ?? "Other";
    else t = "Other";
    out.push(t);
    prev = t;
  }
  return out;
}

const parseVersions = (s: string) => [...s.matchAll(/\d+\.\d+\.\d+/g)].map((m) => m[0]);

/**
 * Rozloží text changelogu Grok Bot (výstup Exa). Nic nezahazuje potichu:
 * - text bez jediného bloku s datem a položkami = chyba (rozbitá extrakce, ne prázdný týden);
 * - hlavička „Latest vX“ musí odpovídat nejvyšší verzi v textu;
 * - blok s datem bez položek = chyba;
 * - nerozpoznané řádky se vrátí v `unparsed`, stejně jako verze bez data (řádek verze
 *   uprostřed bloku): bez data ji nejde zařadit do týdne, její položky se neukládají.
 * Blok bez verze dostane syntetickou verzi `<nejbližší starší verze>.<n>` (n = 1, 2…
 * odspodu), aby šel uložit a zařadit do týdne; do `versions` zápisu se nepíše.
 * Vrací jen bloky od `minVersion`. Nejstarší blok v textu se nevrací (mohl být
 * useknutý limitem délky); jeho verzi nese `truncatedTail.version` a o tom, zda
 * historie stačí, rozhoduje syncGrokBot.
 */
export async function parseGrokBotChangelog(md: string, minVersion = "0.0.0"): Promise<GrokBotParse> {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const blocks: RawBlock[] = [];
  const unparsed: string[] = [];
  let cur: RawBlock | null = null;
  let group: RawBlock["groups"][number] | null = null;
  let pendingType: ChangeType | null = null;
  /** Verze bez řádku data (uprostřed bloku): její položky nejde zařadit do týdne, hlásí se. */
  let orphan: string | null = null;
  for (const raw of lines) {
    const line = raw.trim();
    const date = line.match(DATE_RE);
    if (date) {
      orphan = null;
      const d = new Date(Date.UTC(Number(date[3]), MONTHS[date[1]!.toLowerCase()]!, Number(date[2]), 12));
      cur = { date: d, dateText: d.toISOString().slice(0, 10), version: null, title: null, alsoIncludes: [], groups: [] };
      blocks.push(cur);
      group = null;
      pendingType = null;
      continue;
    }
    if (!cur) continue; // hlavička stránky před prvním vydáním
    if (line === "") { group = null; continue; }
    const ver = line.match(VERSION_LINE_RE);
    if (ver && !cur.version && cur.groups.length === 0) { cur.version = ver[1]!; continue; }
    if (ver && !orphan) { orphan = ver[1]!; group = null; pendingType = null; }
    if (orphan) { unparsed.push(`verze ${orphan} bez data: ${line.slice(0, 200)}`); continue; }
    const sec = line.match(SECTION_RE);
    if (sec) { pendingType = SECTION_TYPE[sec[1]!.toLowerCase()]!; group = null; continue; }
    const also = line.match(ALSO_RE);
    if (also) { cur.alsoIncludes = parseVersions(also[1]!); continue; }
    const item = line.match(ITEM_RE);
    if (item) {
      if (!group) {
        group = { type: pendingType, labelled: pendingType !== null, items: [] };
        pendingType = null;
        cur.groups.push(group);
      }
      group.items.push(item[1]!.trim());
      continue;
    }
    const title = line.match(TITLE_RE);
    if (title && !cur.title && cur.groups.length === 0) { cur.title = title[1]!; continue; }
    unparsed.push(`${cur.dateText}: ${line.slice(0, 200)}`);
  }

  if (blocks.length === 0) throw new Error("grok-bot: v textu changelogu není žádné vydání s datem (rozbitá extrakce stránky?)");
  const empty = blocks.find((b) => b.groups.every((g) => g.items.length === 0));
  if (empty) throw new Error(`grok-bot: vydání ${empty.version ?? empty.dateText} nemá žádnou položku`);

  // Syntetické verze odspodu (od nejstaršího), aby se přidáním nového bloku nahoře neměnily.
  let base = "0.0.0";
  let n = 0;
  const versionOf = new Map<RawBlock, { version: string; synthetic: boolean }>();
  for (const b of [...blocks].reverse()) {
    if (b.version) { base = b.version; n = 0; versionOf.set(b, { version: b.version, synthetic: false }); }
    else versionOf.set(b, { version: `${base}.${++n}`, synthetic: true });
  }

  const real = blocks.flatMap((b) => (b.version ? [b.version, ...b.alsoIncludes] : b.alsoIncludes)).sort(compareVersions);
  const newest = real[real.length - 1] ?? null;
  const latest = md.match(LATEST_RE)?.[1] ?? null;
  if (latest && newest && compareVersions(latest, newest) !== 0) {
    throw new Error(`grok-bot: hlavička uvádí Latest v${latest}, ale nejnovější vydání v textu je ${newest}`);
  }

  const oldest = blocks[blocks.length - 1]!;
  const oldestVer = versionOf.get(oldest)!.version;

  const releases: AssistantRelease[] = [];
  const entries: ChangelogEntry[] = [];
  for (const b of blocks) {
    const { version, synthetic } = versionOf.get(b)!;
    if (b === oldest && blocks.length > 1) continue;
    if (compareVersions(version, minVersion) < 0) continue;
    const types = resolveGroupTypes(b.groups);
    let ord = 0;
    const seen = new Set<string>();
    for (const [gi, g] of b.groups.entries()) {
      for (const rawText of g.items) {
        const { text, scope } = splitScope(rawText);
        ord++;
        let id = `grok-bot:${version}#${await sha8(text)}`;
        if (seen.has(id)) id = `${id}-${ord}`;
        seen.add(id);
        entries.push({ id, version, publishedAt: b.date, ord, type: types[gi]!, scope, text });
      }
    }
    releases.push({ version, synthetic, date: b.dateText, title: b.title, alsoIncludes: b.alsoIncludes, items: ord });
  }
  return {
    latest: latest ?? newest,
    releases,
    entries: entries.sort((a, b) => compareVersions(a.version, b.version) || a.ord - b.ord),
    unparsed,
    truncatedTail: blocks.length > 1 ? { version: oldestVer, date: oldest.dateText } : null,
  };
}

/** Odpověď Exa contents API (jen pole, která čteme). */
interface ExaContents {
  results?: { url?: string; text?: string }[];
  statuses?: { id: string; status: string; source?: string; error?: { tag?: string; httpStatusCode?: number | null } | null }[];
}

/**
 * Text stránky přes Exa contents API. `text: true` = celý text (objektová varianta
 * má strop maxCharacters 10 000, to na historii nestačí). Chyba stavu = výjimka.
 */
export async function fetchViaExa(url: string, apiKey: string, f: typeof fetch = fetch): Promise<{ text: string; source: string | null }> {
  const res = await f(EXA_CONTENTS_URL, {
    method: "POST",
    headers: { "x-api-key": apiKey, "content-type": "application/json" },
    body: JSON.stringify({ urls: [url], text: true, maxAgeHours: EXA_MAX_AGE_HOURS }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`grok-bot: Exa contents ${res.status} ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as ExaContents;
  const status = data.statuses?.find((s) => s.id === url) ?? data.statuses?.[0];
  if (status && status.status !== "success") {
    throw new Error(`grok-bot: Exa nenačetlo ${url}: ${status.error?.tag ?? status.status}${status.error?.httpStatusCode ? ` (${status.error.httpStatusCode})` : ""}`);
  }
  const text = data.results?.[0]?.text ?? "";
  if (!text.trim()) throw new Error(`grok-bot: Exa vrátilo pro ${url} prázdný text`);
  return { text, source: status?.source ?? null };
}

export interface GrokBotSyncResult {
  latest: string | null;
  /** Nejvyšší uložená verze po běhu. */
  stored: string | null;
  /** Uložená řada obsahuje nejnovější vydání ze stránky (podmínka pro týdenní zápis). */
  caughtUp: boolean;
  added: number;
  releases: number;
  textLength: number;
  exaSource: string | null;
  unparsed: string[];
  truncatedTail: { version: string; date: string } | null;
}

/** Nejvyšší uložená verze nástroje, nebo null. */
async function latestStored(db: Db, tool: ToolKey): Promise<string | null> {
  const rows = await db.selectDistinct({ v: ccChangeItem.version }).from(ccChangeItem).where(eq(ccChangeItem.tool, tool));
  return rows.map((r) => r.v).sort(compareVersions).pop() ?? null;
}

/**
 * Denní synchronizace: stáhne stránku přes Exa, rozloží ji a uloží položky od
 * `minVersion` (idempotentně; změněný text položky nahradí starý řádek). Když
 * text nové kopie nesahá k nejnovější uložené verzi, je to chyba (díra v řadě).
 */
export async function syncGrokBot(
  db: Db, kv: KVNamespace, opts: { apiKey?: string; fetch?: typeof fetch; minVersion?: string } = {},
): Promise<GrokBotSyncResult> {
  if (!opts.apiKey) throw new Error("grok-bot: chybí EXA_API_KEY");
  const minVersion = opts.minVersion ?? GROK_BOT_MIN_VERSION;
  const { text, source } = await fetchViaExa(GROK_BOT_CHANGELOG_URL, opts.apiKey, opts.fetch);
  const before = await latestStored(db, GROK_BOT);
  const parsed = await parseGrokBotChangelog(text, minVersion);
  if (parsed.entries.length === 0) throw new Error(`grok-bot: v textu nejsou žádné položky od verze ${minVersion}`);
  const versions = new Set(parsed.entries.map((e) => e.version));
  const stored0 = before && compareVersions(before, minVersion) >= 0 ? before : null;
  if (stored0 && !versions.has(stored0)) {
    // Navazuje na uloženou řadu? Jinak by mezi uloženým a staženým chyběla vydání.
    throw new Error(`grok-bot: nová kopie stránky neobsahuje uloženou verzi ${stored0} (oříznutý nebo starý text?), neukládám`);
  }
  if (!stored0 && parsed.truncatedTail && compareVersions(parsed.truncatedTail.version, minVersion) >= 0) {
    // První naplnění: text musí sahat pod minVersion, jinak historie není celá.
    throw new Error(`grok-bot: text končí vydáním ${parsed.truncatedTail.version} (${parsed.truncatedTail.date}), historie od ${minVersion} není celá (oříznutý text?)`);
  }
  const added = await syncChangelogEntries(db, parsed.entries, GROK_BOT);
  await kv.put(toolReleasesKvKey(GROK_BOT), JSON.stringify(parsed.releases));
  const stored = await latestStored(db, GROK_BOT);
  const newestReal = parsed.releases.filter((r) => !r.synthetic).map((r) => r.version).sort(compareVersions).pop() ?? null;
  return {
    latest: parsed.latest,
    stored,
    caughtUp: !!newestReal && versions.has(newestReal),
    added,
    releases: parsed.releases.length,
    textLength: text.length,
    exaSource: source,
    unparsed: parsed.unparsed,
    truncatedTail: parsed.truncatedTail,
  };
}
