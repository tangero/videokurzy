/**
 * Reconcile fakturačního outboxu (plán docs/fakturacni-system-revize.md v1.0.0,
 * sekce 5.7). Záchranná síť: na vlastním 15min cronu znovu zařadí úlohy, které
 * uvízly — buď protože enqueue po platbě selhal (`pending` bez zpracování), retry
 * dozrál (`failed_retryable` s nextRetryAt v minulosti), nebo zpracování spadlo
 * uprostřed (`processing` starší než CLAIM_TIMEOUT).
 *
 * Terminální stavy (done, failed_permanent, needs_manual_review, needs_reconcile,
 * resolved_manually) se NEvybírají → žádné hladovění poison-řádky. Řazení dle
 * nextRetryAt/createdAt drží férové pořadí (nejstarší dluh první).
 */

import { drizzle } from "drizzle-orm/d1";
import { and, or, eq, isNull, lt, lte, asc } from "drizzle-orm";
import { invoiceJob } from "../../db/schema";
import { CLAIM_TIMEOUT_MS } from "./processor";
import { enqueueInvoiceJob } from "../../invoice-queue";
import type { Env } from "../../types";

type Db = ReturnType<typeof drizzle>;

const RECONCILE_LIMIT = 50;

export async function reconcileInvoiceJobs(
  db: Db,
  env: Env,
  now: Date = new Date(),
  enqueue: (env: Env, jobId: number) => Promise<void> = enqueueInvoiceJob,
): Promise<{ scanned: number; enqueued: number }> {
  const staleBefore = new Date(now.getTime() - CLAIM_TIMEOUT_MS);

  const due = await db
    .select({ id: invoiceJob.id })
    .from(invoiceJob)
    .where(
      or(
        eq(invoiceJob.state, "pending"),
        and(
          eq(invoiceJob.state, "failed_retryable"),
          or(isNull(invoiceJob.nextRetryAt), lte(invoiceJob.nextRetryAt, now)),
        ),
        and(eq(invoiceJob.state, "processing"), lt(invoiceJob.claimedAt, staleBefore)),
      ),
    )
    .orderBy(asc(invoiceJob.nextRetryAt), asc(invoiceJob.createdAt))
    .limit(RECONCILE_LIMIT);

  let enqueued = 0;
  for (const job of due) {
    try {
      await enqueue(env, job.id);
      enqueued++;
    } catch (err) {
      console.error(`[reconcile] enqueue selhal pro job ${job.id}:`, err);
    }
  }
  return { scanned: due.length, enqueued };
}
