// Reportování konverzí (nákupů) do reklamních platforem — Meta CAPI, Google
// (Offline/Data Manager), Sklik. Viz KONVERZE-PLAN.md.
//
// Návrhové principy:
// - Server-side jako zdroj pravdy (žádné client-side Purchase pixely).
// - Volá se ze 4 míst, kde se pending objednávka aktivuje na reálnou platbu
//   (Stripe queue, FIO/Creditas cron, verify endpoint, admin manual).
// - Idempotence per-provider přes conversion_log + lease-claim (R3): re-run
//   doposílá jen failed / expired-pending, 'sent' přeskočí, souběh drží lease.
// - Guardy (kind/value/consent/config) běží PŘED claimem — žádné zbytečné řádky.
// - Best-effort: výjimka se nikdy nepropustí nahoru (nesmí shodit aktivaci/fakturaci).
//   Vnější try/catch má i volající, tady navíc Promise.allSettled + AbortSignal.timeout.

import { and, eq, isNull, or, lt, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { nanoid } from "nanoid";
import { purchase, conversionLog } from "../db/schema";
import { sha256Hex } from "./cc-news/detect";
import type { Env } from "../types";

type Db = ReturnType<typeof drizzle>;
type Provider = "meta" | "google" | "sklik";

const LEASE_MS = 120_000; // 120 s — pojistka proti uváznutí spadlého běhu
const FETCH_TIMEOUT_MS = 3_000;
const META_DEFAULT_VERSION = "v23.0"; // override přes env.META_API_VERSION

/**
 * Normalizuje datum bankovní transakce (často jen den, bez času) na instant =
 * začátek toho dne v Europe/Prague. Akceptuje `YYYY-MM-DD` i ISO s časem.
 * Pro převody je tohle čas konverze (R6); Stripe/manual mají přesný čas zvlášť.
 */
export function bankDateToConversionInstant(dateStr: string): Date {
  // Vezmi jen datovou část (FIO/Creditas vrací buď "2026-06-28" nebo ISO).
  const datePart = dateStr.slice(0, 10);
  // Europe/Prague je UTC+1 (zimní) / UTC+2 (letní). Začátek dne v Praze =
  // 00:00 local. Zjisti offset pro daný den a odečti ho od UTC půlnoci.
  const utcMidnight = new Date(`${datePart}T00:00:00Z`);
  if (Number.isNaN(utcMidnight.getTime())) return new Date(dateStr); // fallback: ber jak přišlo
  // Offset Prahy v minutách pro daný den (DST-aware) přes Intl.
  const pragueOffsetMin = pragueOffsetMinutes(utcMidnight);
  return new Date(utcMidnight.getTime() - pragueOffsetMin * 60_000);
}

/** Offset Europe/Prague vůči UTC v minutách (kladný = před UTC) pro daný instant. */
function pragueOffsetMinutes(at: Date): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Prague",
    hour: "2-digit",
    hour12: false,
  });
  // Hodina v Praze v okamžiku UTC půlnoci = offset (0→0, 1→+60, 2→+120).
  const hourInPrague = parseInt(fmt.format(at), 10) % 24;
  return hourInPrague * 60;
}

interface ReportOptions {
  /** Reálně přijatá částka v Kč, když se liší od purchase.amountPaid (cron match, manual). */
  valueOverride?: number;
  /** Čas reálné platby (ne objednávky). Volající ho uloží na purchase PŘED voláním. */
  conversionOccurredAt?: Date;
}

/**
 * Reportuje nákup do všech nakonfigurovaných reklamních platforem. Bezpečné volat
 * vícekrát (idempotentní per-provider). NIKDY nehází — chyby jen loguje.
 */
export async function reportPurchase(
  db: Db,
  env: Env,
  purchaseId: number,
  opts: ReportOptions = {},
): Promise<void> {
  try {
    const row = await db
      .select()
      .from(purchase)
      .where(eq(purchase.id, purchaseId))
      .get();
    if (!row) return;

    // ── Guardy PŘED claimem (R3/v2.5) — ať nevznikají zbytečné pending/failed řádky.
    if (row.kind === "comp" || row.kind === "staff") return; // granty zdarma, ne peníze
    if (!row.marketingConsent) return; // bez souhlasu se marketingově nereportuje
    const value = opts.valueOverride ?? row.amountPaid ?? 0;
    if (value <= 0) return;
    if (!row.email) return; // bez emailu nemá Meta match key

    const occurredAt = opts.conversionOccurredAt ?? row.conversionOccurredAt ?? row.createdAt;

    const ctx: ReportContext = {
      purchaseId,
      email: row.email,
      valueCzk: value,
      occurredAt,
      fbc: row.fbc,
      fbp: row.fbp,
      gclid: row.gclid,
      gbraid: row.gbraid,
      wbraid: row.wbraid,
      clientIp: row.clientIp,
      userAgent: row.userAgent,
    };

    // Provideři, kteří mají kompletní konfiguraci (guard config PŘED claimem).
    const tasks: Array<() => Promise<void>> = [];
    if (env.META_PIXEL_ID && env.META_CAPI_TOKEN) {
      tasks.push(() => runProvider(db, env, "meta", ctx, sendMeta));
    }
    // Google a Sklik: rozhraní připravené, aktivace až s konfigurací (token řeší
    // uživatel zvlášť). Když env chybí, provider se vůbec neclaimuje.
    if (isGoogleConfigured(env) && hasGoogleClickId(ctx)) {
      tasks.push(() => runProvider(db, env, "google", ctx, sendGoogle));
    }

    if (tasks.length === 0) return;
    await Promise.allSettled(tasks.map((t) => t()));
  } catch (err) {
    console.error(`[conversions] reportPurchase(${purchaseId}) selhalo:`, err);
  }
}

interface ReportContext {
  purchaseId: number;
  email: string;
  valueCzk: number;
  occurredAt: Date;
  fbc: string | null;
  fbp: string | null;
  gclid: string | null;
  gbraid: string | null;
  wbraid: string | null;
  clientIp: string | null;
  userAgent: string | null;
}

type ProviderSender = (
  env: Env,
  ctx: ReportContext,
) => Promise<{ status: number; body: string }>;

/**
 * Lease-claim + odeslání jednoho provideru. Idempotence R3:
 * 1) zajistí řádek (INSERT attemptCount=0 ON CONFLICT DO NOTHING),
 * 2) atomicky převezme lease (UPDATE … WHERE status!='sent' AND lease vypršel),
 * 3) odešle, zapíše výsledek (sent|failed) a uvolní lease.
 */
async function runProvider(
  db: Db,
  env: Env,
  provider: Provider,
  ctx: ReportContext,
  send: ProviderSender,
): Promise<void> {
  const now = new Date();
  const claimToken = nanoid();

  // (1) Zajisti existenci řádku. attemptCount=0 — inkrement dělá až lease (2),
  // ať se první pokus nezapočítá dvakrát.
  await db
    .insert(conversionLog)
    .values({
      purchaseId: ctx.purchaseId,
      provider,
      status: "pending",
      attemptCount: 0,
      requestId: String(ctx.purchaseId),
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();

  // (2) Atomický lease: převezmi řádek, jen pokud není 'sent' a lease vypršel/chybí.
  // Reset status='pending' + vyčištění stop minulého pokusu, ať během retry řádek
  // nevypadá jako failed.
  const leaseUntil = new Date(now.getTime() + LEASE_MS);
  const claimed = await db
    .update(conversionLog)
    .set({
      status: "pending",
      claimToken,
      claimedAt: now,
      leaseUntil,
      attemptCount: sql`${conversionLog.attemptCount} + 1`,
      lastError: null,
      httpStatus: null,
      responseBody: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(conversionLog.purchaseId, ctx.purchaseId),
        eq(conversionLog.provider, provider),
        sql`${conversionLog.status} != 'sent'`,
        or(isNull(conversionLog.leaseUntil), lt(conversionLog.leaseUntil, now)),
      ),
    );

  const changes = (claimed as { meta?: { changes?: number } }).meta?.changes ?? 0;
  if (changes === 0) return; // už 'sent' nebo drží živý lease jiný běh → skip

  // (3) Odešli (s timeoutem a retry uvnitř senderu) a zapiš výsledek.
  try {
    const { status, body } = await send(env, ctx);
    const ok = status >= 200 && status < 300;
    await db
      .update(conversionLog)
      .set({
        status: ok ? "sent" : "failed",
        httpStatus: status,
        responseBody: body.slice(0, 2000),
        lastError: ok ? null : `HTTP ${status}`,
        leaseUntil: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(conversionLog.purchaseId, ctx.purchaseId),
          eq(conversionLog.provider, provider),
          eq(conversionLog.claimToken, claimToken),
        ),
      );
  } catch (err) {
    await db
      .update(conversionLog)
      .set({
        status: "failed",
        lastError: String(err).slice(0, 500),
        leaseUntil: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(conversionLog.purchaseId, ctx.purchaseId),
          eq(conversionLog.provider, provider),
          eq(conversionLog.claimToken, claimToken),
        ),
      );
  }
}

// ─── Meta Conversions API ────────────────────────────────────────────

async function sendMeta(env: Env, ctx: ReportContext): Promise<{ status: number; body: string }> {
  const version = env.META_API_VERSION || META_DEFAULT_VERSION;
  const hashedEmail = await sha256Hex(ctx.email.trim().toLowerCase());

  const userData: Record<string, unknown> = { em: [hashedEmail] };
  if (ctx.fbc) userData.fbc = ctx.fbc;
  if (ctx.fbp) userData.fbp = ctx.fbp;
  if (ctx.clientIp) userData.client_ip_address = ctx.clientIp;
  if (ctx.userAgent) userData.client_user_agent = ctx.userAgent;

  const payload: Record<string, unknown> = {
    data: [
      {
        event_name: "Purchase",
        event_time: Math.floor(ctx.occurredAt.getTime() / 1000),
        event_id: String(ctx.purchaseId), // dedup s případným browser pixelem
        action_source: "website",
        user_data: userData,
        custom_data: { value: ctx.valueCzk, currency: "CZK" },
      },
    ],
  };
  if (env.META_TEST_EVENT_CODE) payload.test_event_code = env.META_TEST_EVENT_CODE;

  const url = `https://graph.facebook.com/${version}/${env.META_PIXEL_ID}/events?access_token=${encodeURIComponent(env.META_CAPI_TOKEN!)}`;

  // Meta občas vrací dočasnou chybu (5xx, code 1/2). Pár sekund počkat a zkusit znovu.
  const MAX_ATTEMPTS = 3;
  let status = 0;
  let body = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    status = res.status;
    body = await res.text();
    if (status >= 200 && status < 300) break;
    if (!isMetaTransientError(status, body) || attempt === MAX_ATTEMPTS) break;
    await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
  }
  return { status, body };
}

/** Dočasná chyba Meta CAPI, kterou má smysl opakovat (ne chyba tokenu/payloadu). */
function isMetaTransientError(status: number, body: string): boolean {
  if (status >= 500) return true;
  try {
    const err = (JSON.parse(body) as { error?: { code?: number } })?.error;
    if (err && (err.code === 1 || err.code === 2)) return true;
  } catch {
    // tělo není JSON — neopakuj
  }
  return false;
}

// ─── Google Ads / Data Manager ───────────────────────────────────────
// Dvě implementace jednoho rozhraní (KONVERZE-PLAN.md): GoogleAdsApiReporter
// (allowlistnutý dev token) vs DataManagerReporter (nový adopter). Aktivace až
// s ověřenou API cestou a click ID — token řeší uživatel zvlášť. Do té doby
// guard isGoogleConfigured() vrátí false a Google se neclaimuje.

function isGoogleConfigured(env: Env): boolean {
  return Boolean(
    env.GOOGLE_ADS_CUSTOMER_ID &&
      env.GOOGLE_ADS_DEVELOPER_TOKEN &&
      env.GOOGLE_ADS_OAUTH_REFRESH_TOKEN &&
      env.GOOGLE_ADS_CONVERSION_ACTION_ID,
  );
}

function hasGoogleClickId(ctx: ReportContext): boolean {
  return Boolean(ctx.gclid || ctx.gbraid || ctx.wbraid);
}

async function sendGoogle(_env: Env, _ctx: ReportContext): Promise<{ status: number; body: string }> {
  // TODO(fáze 7): implementovat po ověření allowlistu dev tokenu — GoogleAdsApiReporter
  // (uploadClickConversions) NEBO DataManagerReporter. conversion_date_time z occurredAt
  // (formát s TZ), OAuth refresh s KV cache. Token řeší uživatel zvlášť.
  throw new Error("Google reporter zatím neimplementován (čeká na ověření API cesty / token).");
}
