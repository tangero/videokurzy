// Rozeslání newsletteru „Novinky v Claude Code" (W-007, R6/R7).
//
// Default je DRY-RUN: jen sestaví + zaloguje počty a MASKOVANÉ adresy, data
// příjemců se nikam neperzistují. Reálné odeslání přes Resend nastane jen za
// obou bran (env CC_NEWS_DRY_RUN=0 + admin přepínač cc_news_live_send, viz
// settings.ts) a jen když je dodán obsah. Odhlášení (GDPR) je povinné a řeší se
// přes suppression tabulku klíčovanou `emailHash` (žádné plain PII).
//
// Cílová množina (dle B-002):
//   - aktivní purchase: status=active, expiresAt>now, kind ∈ {paid, manual}
//   - ověření uživatelé (emailVerified) na aktivní org doméně
//   - mínus comp/staff granty, mínus suppression (anti-join přes emailHash)
//   deduplikováno podle normalizovaného e-mailu.

import { and, eq, gt, inArray, isNull } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";
import { purchase, organization, user, newsletterSuppression, ccNewsItem } from "../../db/schema";
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
  /** V live režimu počet úspěšně odeslaných / selhání (dry-run: 0/0). */
  delivered: number;
  failed: number;
}

/** Rozpad cílové množiny pro zobrazení v adminu PŘED rozesláním. */
export interface RecipientCounts {
  /** Kolik adres reálně dostane e-mail (po odečtení odhlášených). */
  willSend: number;
  /** Kolik unikátních způsobilých adres je celkem (před odečtením odhlášených). */
  eligible: number;
  /** Kolik způsobilých adres je odhlášených (suppression) — willSend = eligible − suppressed. */
  suppressed: number;
}

/**
 * Spočítá rozpad cílové množiny (způsobilí / odhlášení / reálně odeslaní) BEZ
 * odeslání — pro náhled počtu v adminu. Stejná logika jako `buildRecipientSet`,
 * jen místo finálního seznamu vrací počty (a navíc kolik odpadlo suppression).
 */
export async function countRecipients(
  db: Db,
  secret: string,
  now: Date
): Promise<RecipientCounts> {
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

  const activeOrgs = await db
    .select({ domain: organization.domain })
    .from(organization)
    .where(eq(organization.status, "active"));
  const orgDomains = new Set(activeOrgs.map((o) => o.domain.toLowerCase()));

  const verifiedUsers = orgDomains.size
    ? await db.select({ email: user.email }).from(user).where(eq(user.emailVerified, true))
    : [];

  const candidates = new Set<string>();
  for (const p of purchases) {
    const email = normalizeEmail(p.email);
    if (isLikelyEmail(email)) candidates.add(email);
  }
  for (const u of verifiedUsers) {
    const email = normalizeEmail(u.email);
    const domain = email.slice(email.lastIndexOf("@") + 1);
    if (orgDomains.has(domain)) candidates.add(email);
  }

  const eligible = candidates.size;
  if (eligible === 0) return { willSend: 0, eligible: 0, suppressed: 0 };

  const suppressed = await db
    .select({ emailHash: newsletterSuppression.emailHash })
    .from(newsletterSuppression)
    .where(eq(newsletterSuppression.newsletter, SUPPRESSION_PURPOSE));
  const suppressedHashes = new Set(suppressed.map((s) => s.emailHash));

  const key = await importHmacKey(secret);
  const emails = [...candidates];
  const hashes = await Promise.all(emails.map((e) => hashWithKey(key, e)));
  const suppressedCount = hashes.filter((h) => suppressedHashes.has(h)).length;

  return { willSend: eligible - suppressedCount, eligible, suppressed: suppressedCount };
}

interface NewsletterEnv {
  AUTH_INTERNAL_SECRET: string;
  CC_NEWS_DRY_RUN?: string;
  RESEND_API_KEY?: string;
}

/** Sestaví HTML newsletteru pro jednoho příjemce (vč. jeho unsubscribe odkazu). */
export interface NewsletterContent {
  subject: string;
  /** `(unsubscribeUrl) => html` — per-příjemce, aby šel zapéct osobní odkaz. */
  renderHtml: (unsubscribeUrl: string) => string;
  /** Základ pro odhlašovací odkaz, např. https://kurzy.vibecoding.cz. */
  baseUrl: string;
}

/** Souběžnost odesílání — kompromis mezi wall-clockem a Resend rate-limitem. */
const SEND_CONCURRENCY = 8;

/**
 * Rozešle newsletter. Default = dry-run: jen spočítá příjemce a zaloguje počet +
 * vzorek MASKOVANÝCH adres, NEodesílá. Reálné odeslání přes Resend nastane jen
 * když `isCcNewsLiveSend(db, env)` (obě brány) vrátí true A je dodán `content` —
 * brána se vyhodnocuje UVNITŘ (nelze ji obejít argumentem). Každému příjemci jde
 * e-mail s jeho osobním odhlašovacím odkazem; odeslání běží po dávkách
 * (SEND_CONCURRENCY) a selhání jednoho příjemce neshodí celé rozeslání.
 */
export async function sendNewsletter(
  db: Db,
  env: NewsletterEnv,
  now: Date,
  opts: { content?: NewsletterContent } = {}
): Promise<SendReport> {
  const recipients = await buildRecipientSet(db, env.AUTH_INTERNAL_SECRET, now);
  const maskedSample = recipients.slice(0, 3).map(maskEmail);

  const { isCcNewsLiveSend } = await import("./settings");
  const live = await isCcNewsLiveSend(db, env);

  if (!live || !opts.content) {
    console.log(
      `[cc-news] DRY-RUN rozeslání: příjemců=${recipients.length} — NEODESLÁNO. ` +
        `vzorek=${maskedSample.join(", ")}`
    );
    return {
      mode: "dry-run", recipientCount: recipients.length, maskedSample,
      sent: false, delivered: 0, failed: 0,
    };
  }

  const content = opts.content;
  const { sendEmail } = await import("../email");
  const { buildUnsubscribeUrl } = await import("./approval");
  const base = content.baseUrl.replace(/\/+$/, "");
  const apiKey = env.RESEND_API_KEY ?? "";

  // Per-příjemce izolace: výjimka (HMAC/render) u jednoho příjemce je odchycena
  // a počítá se jako selhání, nesmí přerušit zbytek dávky. Dávkování omezuje
  // souběžnost (Worker subrequest/wall-clock limit) místo striktně sériového I/O.
  let delivered = 0;
  let failed = 0;
  for (let i = 0; i < recipients.length; i += SEND_CONCURRENCY) {
    const batch = recipients.slice(i, i + SEND_CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (to) => {
        try {
          const unsubscribeUrl = await buildUnsubscribeUrl(env, base, to);
          return await sendEmail(
            { RESEND_API_KEY: apiKey },
            { to, subject: content.subject, html: content.renderHtml(unsubscribeUrl) }
          );
        } catch (err) {
          console.error(`[cc-news] rozeslání selhalo pro ${maskEmail(to)}:`, (err as Error).message);
          return false;
        }
      })
    );
    for (const ok of results) ok ? delivered++ : failed++;
  }

  console.log(
    `[cc-news] LIVE rozeslání: příjemců=${recipients.length}, odesláno=${delivered}, ` +
      `selhalo=${failed}. vzorek=${maskedSample.join(", ")}`
  );
  return {
    mode: "live", recipientCount: recipients.length, maskedSample,
    sent: delivered > 0, delivered, failed,
  };
}

// ---------------------------------------------------------------------------
// Render HTML newsletteru pro NÁHLED i rozesílku. Skládá úvodník (jen e-mail)
// nad článek a obojí vloží do brandové e-mailové šablony. Markdown → HTML přes
// sdílený renderMarkdown (stejný jako web), aby náhled odpovídal realitě.
// ---------------------------------------------------------------------------

export interface NewsletterPreviewInput {
  /** Markdown těla článku (publikovaná nebo draft verze vydání). */
  articleMarkdown: string;
  /** Volitelný markdown úvodníku (osobní komentář, jen do e-mailu). */
  editorialMarkdown: string | null;
  /** Odhlašovací odkaz — v náhledu placeholder, v rozesílce per-příjemce. */
  unsubscribeUrl: string;
}

/**
 * Sestaví HTML newsletteru (úvodník + článek) v brandové e-mailové šabloně.
 * Úvodník i článek prochází stripem YAML front matteru a renderMarkdown, takže
 * náhled v adminu je 1:1 s tím, co dostane příjemce. `renderMd` je injektovaný
 * (lib/markdown a lib/cc-news/cc-news routy ho už mají) — drží tuhle vrstvu bez
 * tvrdé závislosti na konkrétním rendereru a usnadní test.
 */
export function buildNewsletterHtml(
  input: NewsletterPreviewInput,
  renderMd: (md: string) => string,
  stripFrontMatter: (md: string) => string,
  template: (opts: {
    introHtml: string | null;
    articleHtml: string;
    unsubscribeUrl: string;
  }) => string
): string {
  const articleHtml = renderMd(stripFrontMatter(input.articleMarkdown));
  const introHtml = input.editorialMarkdown?.trim()
    ? renderMd(input.editorialMarkdown)
    : null;
  return template({ introHtml, articleHtml, unsubscribeUrl: input.unsubscribeUrl });
}

// ---------------------------------------------------------------------------
// Rozeslání newsletteru pro KONKRÉTNÍ vydání s per-vydání zámkem proti
// opakovanému rozeslání. Tohle je vstupní bod z adminu — propojuje vydání
// (cc_news_item) s rozesílkou (sendNewsletter), kterou jinak nikdo nevolá.
// ---------------------------------------------------------------------------

export type SendItemResult =
  | { skipped: true; reason: "already-sent" | "no-content"; newsletterSentAt?: Date }
  | (SendReport & { skipped?: false });

interface SendItemEnv extends NewsletterEnv {
  KV: KVNamespace;
  BETTER_AUTH_URL?: string;
}

/**
 * Rozešle newsletter pro dané vydání předplatitelům — JEDNOU. Idempotence stojí
 * na ATOMICKÉM zámku: `UPDATE … SET newsletterSentAt WHERE id=? AND newsletterSentAt
 * IS NULL`. D1 update je atomický, takže ze dvou souběžných požadavků (dvojklik)
 * uspěje právě jeden; druhý dostane 0 změněných řádků → `skipped: already-sent`.
 * Zámek se bere PŘED odesláním. `force` zámek obejde (vědomé znovurozeslání).
 *
 * Obsah se skládá z PUBLIKOVANÉ verze článku (KV) + úvodníku vydání přes sdílený
 * buildNewsletterHtml — shoda s náhledem v adminu. Bez publikovaného obsahu se
 * nic neposílá (`skipped: no-content`). Dry-run brány (isCcNewsLiveSend) řeší až
 * sendNewsletter uvnitř; v dry-run se zámek NEdrží (rozeslání reálně neproběhlo).
 */
export async function sendCcNewsNewsletterForItem(
  db: Db,
  env: SendItemEnv,
  itemId: string,
  now: Date,
  renderMd: (md: string) => string,
  stripFrontMatter: (md: string) => string,
  template: (opts: { introHtml: string | null; articleHtml: string; unsubscribeUrl: string }) => string,
  opts: { force?: boolean } = {}
): Promise<SendItemResult> {
  const [row] = await db
    .select({
      weekLabel: ccNewsItem.weekLabel,
      editorialMarkdown: ccNewsItem.editorialMarkdown,
      newsletterSentAt: ccNewsItem.newsletterSentAt,
    })
    .from(ccNewsItem)
    .where(eq(ccNewsItem.id, itemId))
    .limit(1);
  if (!row) return { skipped: true, reason: "no-content" };

  // Obsah z publikované verze (rozesíláme jen to, co je živé na webu).
  const { publishedKvKey } = await import("./draft");
  const articleMarkdown = await env.KV.get(publishedKvKey(itemId));
  if (!articleMarkdown) return { skipped: true, reason: "no-content" };

  // Atomický zámek (přeskoč při force). 0 změněných řádků = už rozesláno/běží.
  if (!opts.force) {
    const locked = await db
      .update(ccNewsItem)
      .set({ newsletterSentAt: now })
      .where(and(eq(ccNewsItem.id, itemId), isNull(ccNewsItem.newsletterSentAt)))
      .returning({ id: ccNewsItem.id });
    if (locked.length === 0) {
      return { skipped: true, reason: "already-sent", newsletterSentAt: row.newsletterSentAt ?? undefined };
    }
  }

  const baseUrl = (env.BETTER_AUTH_URL ?? "https://kurzy.vibecoding.cz").replace(/\/+$/, "");
  const subject = `Novinky v Claude Code${row.weekLabel ? ` — ${row.weekLabel}` : ""}`;
  const content: NewsletterContent = {
    subject,
    baseUrl,
    renderHtml: (unsubscribeUrl) =>
      buildNewsletterHtml(
        { articleMarkdown, editorialMarkdown: row.editorialMarkdown, unsubscribeUrl },
        renderMd,
        stripFrontMatter,
        template,
      ),
  };

  const report = await sendNewsletter(db, env, now, { content });

  // Dry-run reálně neodeslal → zámek nedrž, ať jde poslat naostro později.
  // (force zámek nebral, takže ho ani nepouštíme.)
  if (report.mode === "dry-run" && !opts.force) {
    await db
      .update(ccNewsItem)
      .set({ newsletterSentAt: null })
      .where(eq(ccNewsItem.id, itemId));
  }

  return report;
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
// Suppression — zápis/čtení nad emailHash. Ukládá se jen hash, nikdy plain
// e-mail. Sdílený lookup, ať record/resubscribe/isSuppressed nemají tři kopie.
// ---------------------------------------------------------------------------

/** Existuje suppression řádek pro daný hash? Jeden zdroj pravdy pro lookup. */
async function existsSuppressionByHash(db: Db, hash: string): Promise<boolean> {
  const rows = await db
    .select({ emailHash: newsletterSuppression.emailHash })
    .from(newsletterSuppression)
    .where(eq(newsletterSuppression.emailHash, hash));
  return rows.length > 0;
}

// Odhlášení (GDPR, W-007) — zapíše suppression z ověřeného tokenu nebo z profilu.
// Idempotentní (opakované odhlášení = no-op).
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
  if (await existsSuppressionByHash(db, hash)) return { alreadyOptedOut: true };

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

// ---------------------------------------------------------------------------
// Opětovné přihlášení (opt-in) k newsletteru — smaže suppression řádek (dle
// rozhodnutí architekta: zpětné zapnutí = DELETE záznamu, ne tombstone).
// Idempotentní (opakované přihlášení už nepřihlášené adresy = no-op). Ukládá se
// jen emailHash, nikdy plain e-mail — konzistentní s recordUnsubscribe.
// ---------------------------------------------------------------------------
export async function recordResubscribe(
  db: Db,
  secret: string,
  email: string
): Promise<{ wasOptedOut: boolean }> {
  const hash = await emailHash(secret, email);
  const deleted = await db
    .delete(newsletterSuppression)
    .where(eq(newsletterSuppression.emailHash, hash))
    .returning({ emailHash: newsletterSuppression.emailHash });
  return { wasOptedOut: deleted.length > 0 };
}

/**
 * Zjistí, zda je daný e-mail odhlášený (v suppression). Čte jen přes emailHash,
 * žádné plain PII se nečte ani neporovnává v DB.
 */
export async function isSuppressed(
  db: Db,
  secret: string,
  email: string
): Promise<boolean> {
  return existsSuppressionByHash(db, await emailHash(secret, email));
}

// ---------------------------------------------------------------------------
// Adresy účtu pro newsletter. buildRecipientSet cílí jak na user.email, tak na
// purchase.email (fakturační adresa z aktivních nákupů může být jiná). Opt-out
// na profilu proto musí pokrýt VŠECHNY tyto adresy, jinak by odhlášení nad jen
// primární adresou nezasáhlo doručovanou nákupní adresu (GDPR).
// ---------------------------------------------------------------------------

/** Všechny adresy, na které účtu reálně může chodit newsletter (deduplikované). */
export async function userNewsletterEmails(
  db: Db,
  userId: string,
  primaryEmail: string,
  now: Date
): Promise<string[]> {
  const emails = new Set<string>();
  const primary = normalizeEmail(primaryEmail);
  if (isLikelyEmail(primary)) emails.add(primary);

  // Aktivní placené/manuální purchase navázané na účet (stejné podmínky jako
  // buildRecipientSet) — jejich fakturační e-mail může být jiný než user.email.
  const purchases = await db
    .select({ email: purchase.email })
    .from(purchase)
    .where(
      and(
        eq(purchase.userId, userId),
        eq(purchase.status, "active"),
        gt(purchase.expiresAt, now),
        inArray(purchase.kind, ["paid", "manual"])
      )
    );
  for (const p of purchases) {
    const e = normalizeEmail(p.email);
    if (isLikelyEmail(e)) emails.add(e);
  }
  return [...emails];
}

/** Odhlásí VŠECHNY adresy účtu (profil). Vrací počet nově odhlášených. */
export async function unsubscribeUserAll(
  db: Db,
  secret: string,
  emails: string[],
  now: Date,
  opts: { source?: string; userId?: string } = {}
): Promise<void> {
  for (const email of emails) {
    await recordUnsubscribe(db, secret, email, now, opts);
  }
}

/** Přihlásí (smaže suppression) VŠECHNY adresy účtu (profil). */
export async function resubscribeUserAll(
  db: Db,
  secret: string,
  emails: string[]
): Promise<void> {
  for (const email of emails) {
    await recordResubscribe(db, secret, email);
  }
}

/** Je účet odhlášen? True, jen když je odhlášená KTERÁKOLI jeho adresa. */
export async function isUserSuppressed(
  db: Db,
  secret: string,
  emails: string[]
): Promise<boolean> {
  for (const email of emails) {
    if (await isSuppressed(db, secret, email)) return true;
  }
  return false;
}
