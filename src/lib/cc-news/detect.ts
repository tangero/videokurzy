// Detekce nových týdenních záznamů z code.claude.com/docs/en/whats-new
// (služba „Novinky v Claude Code", W-003 / R1).
//
// Zdroj je STROJOVÝ, ne HTML: RSS feed `…/whats-new/rss.xml` pro detekci +
// `.md` detail digestu pro obsah (viz B-002). guid/pubDate z RSS se na klíč
// idempotence NEPOUŽÍVAJÍ — Week N a Week N-1 mohou sdílet pubDate a guid se
// může změnit. Idempotency key = `sourceId` (canonical_url detailu), na který
// je v DB UNIQUE index.
//
// Funkce je čistá detekce: nic neposílá, nic nepublikuje. Vrací rozhodnutí
// (`new` | `changed` | `unchanged`), zápis do DB je idempotentní upsert. Další
// kroky pipeline (redakční zpracování, schválení) navazují přes status řádky.

import { eq } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";
import { nanoid } from "nanoid";
import { ccNewsItem } from "../../db/schema";

type Db = ReturnType<typeof drizzle>;

const WHATS_NEW_BASE = "https://code.claude.com/docs/en/whats-new";
export const WHATS_NEW_RSS_URL = `${WHATS_NEW_BASE}/rss.xml`;

/** Surová položka z RSS feedu (jen pole, která potřebujeme). */
export interface RssItem {
  /** canonical URL detailu, normalizovaná na cestu bez koncového `.md`/lomítka */
  sourceId: string;
  weekLabel: string | null;
  versionRange: string | null;
  guid: string | null;
}

export type DetectOutcome =
  | { kind: "new"; sourceId: string; itemId: string }
  | { kind: "changed"; sourceId: string; itemId: string }
  | { kind: "unchanged"; sourceId: string; itemId: string }
  | { kind: "empty" };

/** SHA-256 hex přes Web Crypto (dostupné ve Workers i v testech). */
export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Normalizuje odkaz z RSS na stabilní `sourceId`. Sjednocuje varianty
 * `…/2026-w24`, `…/2026-w24.md`, s/bez koncového lomítka i absolutní vs.
 * relativní URL na jednu kanonickou cestu (pathname bez `.md`, bez trailing `/`).
 */
export function normalizeSourceId(link: string): string {
  let pathname: string;
  try {
    pathname = new URL(link, WHATS_NEW_BASE).pathname;
  } catch {
    pathname = link;
  }
  pathname = pathname.replace(/\.md$/i, "").replace(/\/+$/, "");
  return pathname;
}

/** URL `.md` detailu pro daný `sourceId`. */
export function detailMarkdownUrl(sourceId: string): string {
  return `https://code.claude.com${sourceId}.md`;
}

/**
 * Minimalistický parser RSS 2.0 — vytáhne první `<item>` a z něj `link`,
 * `title` (weekLabel), `category` (versionRange) a `guid`. Regex stačí: feed je
 * strojově generovaný Mintlify a my čteme jen první (nejnovější) položku.
 * Vrací null, když feed neobsahuje žádnou položku.
 */
export function parseFirstRssItem(xml: string): RssItem | null {
  const itemMatch = xml.match(/<item\b[^>]*>([\s\S]*?)<\/item>/i);
  if (!itemMatch) return null;
  const block = itemMatch[1];

  const pick = (tag: string): string | null => {
    const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "i");
    const m = block.match(re);
    if (!m) return null;
    return decodeXml(stripCdata(m[1]).trim()) || null;
  };

  const link = pick("link");
  if (!link) return null;

  return {
    sourceId: normalizeSourceId(link),
    weekLabel: pick("title"),
    versionRange: pick("category"),
    guid: pick("guid"),
  };
}

function stripCdata(s: string): string {
  return s.replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/i, "$1");
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Dvojice fetcherů — injectovatelné v testech (bez sítě). */
export interface Fetchers {
  fetchRss(): Promise<string>;
  fetchDetail(sourceId: string): Promise<string>;
}

/** Reálné fetchery proti Mintlify endpointům. Tolerují dočasnou nedostupnost. */
export function defaultFetchers(): Fetchers {
  return {
    async fetchRss() {
      const res = await fetch(WHATS_NEW_RSS_URL, {
        headers: { accept: "application/rss+xml, application/xml" },
      });
      if (!res.ok) throw new Error(`whats-new RSS fetch failed: ${res.status}`);
      return res.text();
    },
    async fetchDetail(sourceId: string) {
      const url = detailMarkdownUrl(sourceId);
      const res = await fetch(url, { headers: { accept: "text/markdown, text/plain" } });
      if (!res.ok) throw new Error(`whats-new detail fetch failed: ${res.status}`);
      return res.text();
    },
  };
}

/**
 * Jeden idempotentní průchod detekce.
 *
 * - `empty`: feed bez položek (nebo neparsovatelný) — nic se nemění.
 * - `unchanged`: sourceId už v DB a contentHash sedí — nic se nemění (R1: totéž
 *   se nezpracuje 2×, ani při opakovaném běhu cronu).
 * - `changed`: sourceId v DB, ale obsah detailu se změnil — aktualizuje hash a
 *   vrátí řádku zpět do `draft` (re-edit digestu téhož týdne).
 * - `new`: dosud neviděný sourceId — vloží novou řádku ve stavu `draft`.
 *
 * Zápis nového/změněného řádku NEvolá žádné odeslání ani publikaci; navazující
 * kroky (W-004+) si je vyzvednou podle statusu.
 */
export async function detectLatest(
  db: Db,
  fetchers: Fetchers,
  now: Date
): Promise<DetectOutcome> {
  const xml = await fetchers.fetchRss();
  const item = parseFirstRssItem(xml);
  if (!item) return { kind: "empty" };

  const detail = await fetchers.fetchDetail(item.sourceId);
  const contentHash = await sha256Hex(detail);

  const existing = await db
    .select()
    .from(ccNewsItem)
    .where(eq(ccNewsItem.sourceId, item.sourceId))
    .limit(1);

  if (existing.length > 0) {
    const row = existing[0];
    if (row.contentHash === contentHash) {
      return { kind: "unchanged", sourceId: item.sourceId, itemId: row.id };
    }
    await db
      .update(ccNewsItem)
      .set({
        contentHash,
        weekLabel: item.weekLabel,
        versionRange: item.versionRange,
        status: "draft",
      })
      .where(eq(ccNewsItem.id, row.id));
    return { kind: "changed", sourceId: item.sourceId, itemId: row.id };
  }

  const id = nanoid();
  await db.insert(ccNewsItem).values({
    id,
    sourceId: item.sourceId,
    contentHash,
    weekLabel: item.weekLabel,
    versionRange: item.versionRange,
    status: "draft",
    createdAt: now,
  });
  return { kind: "new", sourceId: item.sourceId, itemId: id };
}
