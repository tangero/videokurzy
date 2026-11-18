/**
 * Onboardingová Resend automation událost `purchase.completed` — NEJVÝŠE JEDNOU
 * na nákup, pro všechny platební cesty (Stripe webhook, bankovní cron, „Ověřit
 * platbu“ v checkoutu) a s dodatečným doručením po odmítnutí.
 *
 * Idempotenci drží sloupec `purchase.onboardingEventSentAt` přes ATOMICKÝ CLAIM
 * před odesláním: `UPDATE … WHERE onboardingEventSentAt IS NULL` uspěje právě
 * jednou, takže ani dva souběžné běhy událost nepošlou dvakrát.
 *
 * - `"failed"` (server odmítl, např. 429): claim se VRÁTÍ na NULL. Stripe cesta pak
 *   vyhodí chybu a zprávu retryuje fronta; bankovní cesty frontu nemají, dožene je
 *   `sweepPendingOnboardingEvents` v 15min cronu.
 * - `"unknown"` (timeout, 5xx): událost mohla proběhnout, claim NEVRACÍME —
 *   druhý onboarding je horší než jeden možná chybějící.
 *
 * Zbytkové riziko: crash mezi odesláním a vyhodnocením nechá claim zapsaný a
 * událost se už nepošle.
 */

import type { drizzle } from "drizzle-orm/d1";
import { and, eq, gte, inArray, isNull } from "drizzle-orm";
import { purchase } from "../db/schema";
import { sendResendEvent, type ResendEventOutcome } from "./resend";
import { maskEmail } from "./errors";
import type { Env } from "../types";

type Db = ReturnType<typeof drizzle>;

export type OnboardingOutcome = ResendEventOutcome | "already_sent";

export async function sendOnboardingEventOnce(
  db: Db,
  env: Pick<Env, "RESEND_API_KEY">,
  opts: { purchaseId: number; email: string; payload: Record<string, unknown> },
): Promise<OnboardingOutcome> {
  // Claim: uspěje právě jeden běh. Prázdný výsledek = událost už odeslal
  // (nebo právě odesílá) někdo jiný.
  const claimed = await db
    .update(purchase)
    .set({ onboardingEventSentAt: new Date() })
    .where(and(eq(purchase.id, opts.purchaseId), isNull(purchase.onboardingEventSentAt)))
    .returning({ id: purchase.id });
  if (claimed.length === 0) return "already_sent";

  const outcome = await sendResendEvent(
    env.RESEND_API_KEY,
    "purchase.completed",
    opts.email,
    opts.payload,
  );

  if (outcome === "failed") {
    // Server odmítl → událost prokazatelně nevznikla. Vrať claim, ať ji další
    // pokus (retry fronty / sweep v cronu) doručí.
    await db
      .update(purchase)
      .set({ onboardingEventSentAt: null })
      .where(eq(purchase.id, opts.purchaseId));
    console.error(
      `[onboarding] event failed for purchase ${opts.purchaseId} (${maskEmail(opts.email)}) — zkusí se znovu`,
    );
  } else if (outcome === "unknown") {
    console.error(
      `[onboarding] event outcome unknown for purchase ${opts.purchaseId} (${maskEmail(opts.email)}) — neopakuje se`,
    );
  }
  return outcome;
}

/**
 * Od kdy sweep dohání. Převodové nákupy před touto změnou `onboardingEventSentAt`
 * nikdy nezapisovaly (NULL i když onboarding odešel), takže bez hranice by sweep
 * poslal onboarding znovu všem starším zákazníkům. NIKDY neposouvat do minulosti.
 */
export const ONBOARDING_SWEEP_FROM = new Date("2026-11-19T00:00:00+01:00");

/** Jak dlouho po založení nákupu se onboarding ještě dohání. Pak už nemá smysl. */
export const ONBOARDING_SWEEP_WINDOW_MS = 7 * 86400 * 1000;

const SWEEP_LIMIT = 20;

/**
 * Dožene onboarding převodovým nákupům (FIO / Creditas), kterým ho Resend odmítl.
 * Jen aktivní placené nákupy založené po ONBOARDING_SWEEP_FROM a ne starší než
 * 7 dní. Stripe se sem nebere — má retry přes frontu a po vyčerpání DLQ alert.
 * Zahrnuje i ručně potvrzené platby (kind='manual'), které onboarding dosud
 * nedostávaly vůbec.
 */
export async function sweepPendingOnboardingEvents(
  db: Db,
  env: Pick<Env, "RESEND_API_KEY">,
  now: Date = new Date(),
): Promise<{ scanned: number; sent: number }> {
  const windowStart = new Date(now.getTime() - ONBOARDING_SWEEP_WINDOW_MS);
  const since = windowStart > ONBOARDING_SWEEP_FROM ? windowStart : ONBOARDING_SWEEP_FROM;

  const due = await db
    .select({ id: purchase.id, email: purchase.email, type: purchase.type, paymentMethod: purchase.paymentMethod })
    .from(purchase)
    .where(
      and(
        eq(purchase.status, "active"),
        inArray(purchase.kind, ["paid", "manual"]),
        inArray(purchase.paymentMethod, ["fio", "creditas"]),
        isNull(purchase.onboardingEventSentAt),
        gte(purchase.createdAt, since),
      ),
    )
    .limit(SWEEP_LIMIT);

  let sent = 0;
  for (const p of due) {
    const outcome = await sendOnboardingEventOnce(db, env, {
      purchaseId: p.id,
      email: p.email.toLowerCase(),
      payload: { type: p.type, paymentMethod: p.paymentMethod },
    });
    if (outcome === "sent") sent++;
  }
  return { scanned: due.length, sent };
}
