// Rozeslání newsletteru „Novinky v Claude Code" — DRY-RUN (W-007, R6/R7).
//
// Mantinely: NEodesílá reálné e-maily (jen sestaví + zaloguje počty a MASKOVANÉ
// adresy), data příjemců se nikam neperzistují. Odhlášení (GDPR) je povinné a
// řeší se přes suppression tabulku klíčovanou `emailHash` (žádné plain PII).
//
// Cílová množina (dle B-002):
//   - aktivní purchase: status=active, expiresAt>now, kind ∈ {paid, manual}
//   - ověření uživatelé (emailVerified) na aktivní org doméně
//   - mínus comp/staff granty, mínus suppression (anti-join přes emailHash)
//   deduplikováno podle normalizovaného e-mailu.

import { and, eq, gt, inArray } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";
import { purchase, organization, user, newsletterSuppression } from "../../db/schema";
import { maskEmail } from "../errors";

type Db = ReturnType<typeof drizzle>;

const SUPPRESSION_PURPOSE = "claude_code_news";

export const normalizeEmail = (raw: string): string => raw.trim().toLowerCase();

/** Základní sanity check tvaru e-mailu (ne plná RFC validace): local@domain.tld. */
export const isLikelyEmail = (email: string): boolean =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

/** Importuje HMAC klíč jednou (znovupoužitelný pro mnoho hashů — viz batch níže). */
async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

/** Spočítá emailHash s předem importovaným klíčem. */
async function hashWithKey(key: CryptoKey, email: string): Promise<string> {
  const body = `${SUPPRESSION_PURPOSE}:${normalizeEmail(email)}`;
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** HMAC-SHA256 hex z (normalizovaný e-mail, účel). Stejný klíč jako suppression. */
export async function emailHash(secret: string, email: string): Promise<string> {
  return hashWithKey(await importHmacKey(secret), email);
}

/**
 * Sestaví cílovou množinu příjemců (normalizované, deduplikované e-maily) po
 * odečtení suppression. Vrací jen e-maily — volající je nikam neukládá.
 */
export async function buildRecipientSet(
  db: Db,
  secret: string,
  now: Date
): Promise<string[]> {
  // 1) aktivní placené/manuální purchase
  const purchases = await db
    .select({ email: purchase.email })
    .from(purchase)
    .where(
      and(
        eq(purchase.status, "active"),
        gt(purchase.expiresAt, now),
        inArray(purchase.kind, ["paid", "manual"])
      )
    );

  // 2) ověření uživatelé na aktivní org doméně
  const activeOrgs = await db
    .select({ domain: organization.domain })
    .from(organization)
    .where(eq(organization.status, "active"));
  const orgDomains = new Set(activeOrgs.map((o) => o.domain.toLowerCase()));

  const verifiedUsers = orgDomains.size
    ? await db.select({ email: user.email }).from(user).where(eq(user.emailVerified, true))
    : [];

  const candidates = new Set<string>();
  // purchase.email je uživatelem zadané pole (neprošlo ověřením jako u user.
  // emailVerified větve) — aspoň základní validace tvaru, ať se do rozeslání
  // nedostanou zjevně nevalidní adresy (překlepy, prázdné, bez @).
  for (const p of purchases) {
    const email = normalizeEmail(p.email);
    if (isLikelyEmail(email)) candidates.add(email);
  }
  for (const u of verifiedUsers) {
    const email = normalizeEmail(u.email);
    const domain = email.slice(email.lastIndexOf("@") + 1);
    if (orgDomains.has(domain)) candidates.add(email);
  }

  if (candidates.size === 0) return [];

  // 3) anti-join proti suppression (přes emailHash)
  const suppressed = await db
    .select({ emailHash: newsletterSuppression.emailHash })
    .from(newsletterSuppression)
    .where(eq(newsletterSuppression.newsletter, SUPPRESSION_PURPOSE));
  const suppressedHashes = new Set(suppressed.map((s) => s.emailHash));

  // Klíč importujeme JEDNOU a hashe počítáme paralelně (ne sériově per-příjemce)
  // — důležité při velkých cílových množinách.
  const key = await importHmacKey(secret);
  const emails = [...candidates];
  const hashes = await Promise.all(emails.map((e) => hashWithKey(key, e)));
  const result = emails.filter((_, i) => !suppressedHashes.has(hashes[i]));
  return result.sort();
}

export interface SendReport {
  mode: "dry-run" | "live";
  recipientCount: number;
  maskedSample: string[]; // jen pár maskovaných adres pro kontrolu, ne celý seznam
  sent: boolean;
}

interface NewsletterEnv {
  AUTH_INTERNAL_SECRET: string;
  CC_NEWS_DRY_RUN?: string;
}

/**
 * „Rozešle" newsletter — v dry-run jen spočítá příjemce a zaloguje počet +
 * vzorek maskovaných adres. NEodesílá. Live větev je zakázaná (mantinel fáze 1).
 */
export async function sendNewsletterDryRun(
  db: Db,
  env: NewsletterEnv,
  now: Date
): Promise<SendReport> {
  const recipients = await buildRecipientSet(db, env.AUTH_INTERNAL_SECRET, now);
  const maskedSample = recipients.slice(0, 3).map(maskEmail);

  if (env.CC_NEWS_DRY_RUN === "0") {
    throw new Error("cc-news live rozeslání je zakázané (mantinel fáze 1) — vyžaduje eskalaci.");
  }

  console.log(
    `[cc-news] DRY-RUN rozeslání: příjemců=${recipients.length} — NEODESLÁNO. ` +
      `vzorek=${maskedSample.join(", ")}`
  );
  return { mode: "dry-run", recipientCount: recipients.length, maskedSample, sent: false };
}

// ---------------------------------------------------------------------------
// R7 — odkazy na nové CC články z vibecoding.cz
// ---------------------------------------------------------------------------

export interface CcArticleLink {
  title: string;
  url: string;
}

const VIBECODING_FEED = "https://vibecoding.cz/vibecoding-feed.xml";

/** Fetcher feedu vibecoding.cz — injektovatelný pro testy. */
export interface FeedFetcher {
  fetchFeed(): Promise<string>;
}

export function defaultFeedFetcher(): FeedFetcher {
  return {
    async fetchFeed() {
      const res = await fetch(VIBECODING_FEED, { headers: { accept: "application/rss+xml" } });
      if (!res.ok) throw new Error(`vibecoding feed fetch failed: ${res.status}`);
      return res.text();
    },
  };
}

/**
 * Vybere z RSS feedu vibecoding.cz články z rubriky Claude Code (R7). Filtruje
 * podle kategorie „Claude Code" nebo URL segmentu `/claude-code`. `limit` omezí
 * počet nejnovějších.
 */
export function parseCcArticleLinks(xml: string, limit = 5): CcArticleLink[] {
  const links: CcArticleLink[] = [];
  for (const m of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const block = m[1];

    // Textový obsah <link> (RSS) NEBO href atribut <link .../> (Atom self-closing).
    const url = (
      stripCdata(block.match(/<link\b[^>]*>([\s\S]*?)<\/link>/i)?.[1] ?? "") ||
      (block.match(/<link\b[^>]*\shref=["']([^"']+)["']/i)?.[1] ?? "")
    ).trim();

    // Filtrujeme cíleně: kategorie „Claude Code" NEBO URL segment /claude-code/.
    // (Ne přes celý text bloku — náhodná zmínka v popisu by jinak protáhla
    // nesouvisející článek.)
    const categories = [...block.matchAll(/<category\b[^>]*>([\s\S]*?)<\/category>/gi)]
      .map((c) => stripCdata(c[1]));
    const isCc =
      categories.some((c) => /claude[\s-]?code/i.test(c)) || /\/claude-code\//i.test(url);
    if (!isCc) continue;

    const title = stripCdata(block.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").trim();
    if (title && url) links.push({ title, url });
    if (links.length >= limit) break;
  }
  return links;
}

function stripCdata(s: string): string {
  return s.replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/i, "$1").trim();
}

// ---------------------------------------------------------------------------
// Odhlášení (GDPR, W-007) — zapíše suppression z ověřeného tokenu. Ukládá jen
// emailHash, nikdy plain e-mail. Idempotentní (opakované odhlášení = no-op).
// ---------------------------------------------------------------------------
export async function recordUnsubscribe(
  db: Db,
  secret: string,
  email: string,
  now: Date,
  opts: { source?: string; userId?: string } = {}
): Promise<{ alreadyOptedOut: boolean }> {
  // emailHash nese ÚČEL v HMAC body (`claude_code_news:…`), takže je už
  // per-newsletter — různé newslettery dají různý hash a PK na emailHash je
  // korektní rozlišovač (žádná kolize napříč newslettery).
  const hash = await emailHash(secret, email);
  const existing = await db
    .select({ emailHash: newsletterSuppression.emailHash })
    .from(newsletterSuppression)
    .where(eq(newsletterSuppression.emailHash, hash));
  if (existing.length > 0) return { alreadyOptedOut: true };

  // onConflictDoNothing: pojistka proti závodu dvou souběžných odhlašovacích
  // kliků na stejný odkaz (oba projdou SELECT s prázdným výsledkem).
  const inserted = await db
    .insert(newsletterSuppression)
    .values({
      emailHash: hash,
      newsletter: SUPPRESSION_PURPOSE,
      optedOutAt: now,
      source: opts.source ?? "unsubscribe-link",
      createdFromUserId: opts.userId ?? null,
    })
    .onConflictDoNothing({ target: newsletterSuppression.emailHash })
    .returning({ emailHash: newsletterSuppression.emailHash });

  return { alreadyOptedOut: inserted.length === 0 };
}
