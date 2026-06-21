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
 * Minimalistický parser RSS 2.0 — vytáhne první (nejnovější) `<item>`.
 *
 * POZOR na reálný tvar feedu Mintlify: `<link>` NENÍ týdenní detail, ale index
 * s kotvou (`…/whats-new#week-24`). Stabilní detailní URL (`…/2026-w24`) je až
 * uvnitř `<content:encoded>` v odkazu „Read the Week N digest". `sourceId`
 * proto bereme PRIMÁRNĚ z `content:encoded`; `<link>` slouží jen jako fallback,
 * když odkaz na digest chybí. Bez detailní URL → null (nemáme idempotency key).
 *
 * `category` nese rozsah verzí (např. `v2.1.166–v2.1.176`). `guid`/`pubDate` se
 * na klíč idempotence NEPOUŽÍVAJÍ (sousední týdny sdílejí pubDate, guid se mění).
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

  const encoded = pick("content:encoded") ?? "";
  // weekLabel (např. „Week 24") pomáhá vybrat SPRÁVNÝ digest odkaz, když text
  // odkazuje i na jiné (předchozí) týdny — viz extractDigestLink.
  const weekLabel = pick("title");
  const detailLink = extractDigestLink(encoded, weekLabel);
  const fallbackLink = pick("link");
  const source = detailLink ?? fallbackLink;
  if (!source) return null;

  const sourceId = normalizeSourceId(source);
  // Bez týdenního detailu (`…/2026-wNN`) nemáme stabilní idempotency key —
  // index `/docs/en/whats-new` by sloučil všechny týdny do jedné řádky.
  if (!isWeeklyDetailPath(sourceId)) return null;

  return {
    sourceId,
    weekLabel: pick("title"),
    versionRange: pick("category"),
    guid: pick("guid"),
  };
}

/**
 * Najde v HTML `content:encoded` odkaz na týdenní digest `…/whats-new/<rok>-wNN`.
 *
 * Digest může v textu odkazovat i na JINÉ (předchozí) týdny, takže „první href"
 * by mohl ukázat na špatný týden. Když známe `weekLabel` (např. „Week 24"),
 * preferujeme href, jehož číslo týdne se shoduje. Jinak fallback na POSLEDNÍ
 * digest odkaz — cílový „Read the Week N digest →" bývá na konci bloku, kdežto
 * odkazy na předchozí týdny v úvodu textu.
 */
export function extractDigestLink(
  encodedHtml: string,
  weekLabel?: string | null
): string | null {
  const re = /href=["'](https?:\/\/[^"']*?\/whats-new\/(\d{4})-w(\d{1,2})[^"']*)["']/gi;
  const matches = [...encodedHtml.matchAll(re)];
  if (matches.length === 0) return null;

  const wantedWeek = weekLabel?.match(/week\s*(\d{1,2})/i)?.[1];
  if (wantedWeek) {
    const exact = matches.find((m) => parseInt(m[3], 10) === parseInt(wantedWeek, 10));
    if (exact) return decodeXml(exact[1]);
  }
  return decodeXml(matches[matches.length - 1][1]);
}

/** True pro kanonickou cestu týdenního detailu `…/whats-new/<rok>-w<týden>`. */
function isWeeklyDetailPath(pathname: string): boolean {
  return /\/whats-new\/\d{4}-w\d{1,2}$/i.test(pathname);
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

    // Už publikovaný týden: živou verzi NEDEPUBLIKUJEME. Pokud se obsah zdroje
    // změnil, zaznamenáme to do pendingContentHash a necháme rozhodnutí na
    // dalším kroku — re-publikace nové verze je až po lidském schválení.
    if (row.status === "published") {
      if (row.pendingContentHash === contentHash || row.contentHash === contentHash) {
        return { kind: "unchanged", sourceId: item.sourceId, itemId: row.id };
      }
      await db
        .update(ccNewsItem)
        .set({ pendingContentHash: contentHash })
        .where(eq(ccNewsItem.id, row.id));
      return { kind: "changed", sourceId: item.sourceId, itemId: row.id };
    }

    // Dosud nepublikovaný (draft/approved): obsah lze přepsat, idempotence dle hashe.
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

  // Nový sourceId. onConflictDoNothing ošetří závod (souběžný cron + ruční
  // trigger): pokud řádku vloží jiný běh mezi naším SELECT a INSERT, druhý
  // insert se tiše přeskočí a my načteme existující id místo pádu na UNIQUE.
  const id = nanoid();
  const inserted = await db
    .insert(ccNewsItem)
    .values({
      id,
      sourceId: item.sourceId,
      contentHash,
      weekLabel: item.weekLabel,
      versionRange: item.versionRange,
      status: "draft",
      createdAt: now,
    })
    .onConflictDoNothing({ target: ccNewsItem.sourceId })
    .returning({ id: ccNewsItem.id });

  if (inserted.length === 0) {
    // Vložil souběžný běh — vrátíme existující řádku jako unchanged.
    const raced = await db
      .select({ id: ccNewsItem.id })
      .from(ccNewsItem)
      .where(eq(ccNewsItem.sourceId, item.sourceId))
      .limit(1);
    return { kind: "unchanged", sourceId: item.sourceId, itemId: raced[0]?.id ?? id };
  }
  return { kind: "new", sourceId: item.sourceId, itemId: id };
}
