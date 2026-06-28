/**
 * Orchestrátor fakturační úlohy (plán docs/fakturacni-system-revize.md v1.0.0,
 * sekce 5.3–5.4, 5.7). D1 je zdroj pravdy o stavu; tahle funkce je jediné místo,
 * které mění `invoice_job` během zpracování.
 *
 * Tok: CAS claim → 3 idempotentní kroky gatewaye (s perzistencí po každém kroku,
 * aby resume po pádu navázal) → terminální stav. Chyby Fakturoidu spadnou do
 * failed_retryable (backoff přes nextRetryAt) a po MAX_ATTEMPTS do failed_permanent.
 */

import { drizzle } from "drizzle-orm/d1";
import { and, eq, or, isNull, lt, lte, inArray, sql } from "drizzle-orm";
import { invoiceJob, purchase } from "../../db/schema";
import type { Env } from "../../types";
import {
  makeFakturoidApi,
  ensureInvoiceCreated,
  ensurePaymentRecorded,
  ensureInvoiceSent,
  invoiceLineName,
  type FakturoidApi,
} from "./fakturoid-gateway";

type Db = ReturnType<typeof drizzle>;

export const MAX_ATTEMPTS = 6;
export const CLAIM_TIMEOUT_MS = 10 * 60 * 1000;
const BACKOFF_BASE_MS = 5 * 60 * 1000;
const BACKOFF_MAX_MS = 6 * 60 * 60 * 1000;

export type ProcessResult =
  | { status: "skipped" }
  | { status: "done"; invoiceId: number }
  | { status: "needs_manual_review"; reason: string }
  | { status: "failed_retryable"; code: string }
  | { status: "failed_permanent"; code: string };

/** Bezpečná chybová hláška pro DB — bez PII/tokenů, ≤2 KB, se status kódem. */
export function sanitizeInvoiceError(err: unknown): { code: string; status: number | null; message: string } {
  const raw = err instanceof Error ? err.message : String(err);
  const statusMatch = raw.match(/\((\d{3})\)/);
  const status = statusMatch ? Number(statusMatch[1]) : null;
  let msg = raw
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "<email>")
    .replace(/(Bearer|token|secret|client_secret|Authorization)[=:\s"']+[\w.-]+/gi, "$1 <redacted>")
    .replace(/\s+/g, " ")
    .trim();
  if (msg.length > 2000) msg = `${msg.slice(0, 1997)}...`;
  return { code: status ? `http_${status}` : "error", status, message: msg };
}

function backoffMs(attempts: number): number {
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1));
}

/**
 * Zpracuje jednu fakturační úlohu. Idempotentní a bezpečné při souběhu — claim
 * (CAS) zajistí, že běží jen jeden zpracovatel. `apiOverride` umožní testy nad
 * mock Fakturoid API.
 */
export async function processInvoiceJob(
  db: Db,
  env: Env,
  jobId: number,
  apiOverride?: FakturoidApi,
): Promise<ProcessResult> {
  const now = new Date();
  const staleBefore = new Date(now.getTime() - CLAIM_TIMEOUT_MS);

  // CAS claim — vyhraje jen jeden. Pokryje i uvízlé processing po CLAIM_TIMEOUT.
  const claimed = await db
    .update(invoiceJob)
    .set({
      state: "processing",
      claimedAt: now,
      lastAttemptAt: now,
      attempts: sql`${invoiceJob.attempts} + 1`,
    })
    .where(
      and(
        eq(invoiceJob.id, jobId),
        or(
          inArray(invoiceJob.state, ["pending", "failed_retryable"]),
          and(eq(invoiceJob.state, "processing"), lt(invoiceJob.claimedAt, staleBefore)),
        ),
        or(isNull(invoiceJob.nextRetryAt), lte(invoiceJob.nextRetryAt, now)),
      ),
    )
    .returning({ id: invoiceJob.id });

  if (claimed.length === 0) return { status: "skipped" };

  const [job] = await db.select().from(invoiceJob).where(eq(invoiceJob.id, jobId)).limit(1);
  if (!job) return { status: "skipped" };

  try {
    const api = apiOverride ?? makeFakturoidApi(env);

    // Položka faktury dle typu purchase (osobní / firemní).
    const [p] = await db
      .select({ type: purchase.type })
      .from(purchase)
      .where(eq(purchase.id, job.purchaseId))
      .limit(1);
    const isOrg = p?.type === "organization";
    const domain = isOrg ? job.email.split("@")[1] ?? null : null;
    const lineName = invoiceLineName({ jobKind: job.jobKind, isOrganization: isOrg, domain });

    let invoiceId = job.fakturoidInvoiceId;

    // Krok 1 — vytvoř/adoptuj fakturu.
    if (!invoiceId) {
      const created = await ensureInvoiceCreated(api, {
        customId: job.customId,
        lineName,
        amount: job.amount,
        paidOn: job.paidOn,
        subject: {
          email: job.invoiceEmail ?? job.email,
          name: job.companyName ?? job.contactName ?? job.email,
          companyIco: job.companyIco,
          companyDic: job.companyDic,
          companyAddress: job.companyAddress,
          companyCity: job.companyCity,
          companyZip: job.companyZip,
        },
      });
      invoiceId = created.invoiceId;
      await db
        .update(invoiceJob)
        .set({ fakturoidInvoiceId: invoiceId, fakturoidSubjectId: created.subjectId, issuedAt: new Date() })
        .where(eq(invoiceJob.id, jobId));
    }

    // Krok 2 — zaeviduj platbu (idempotentně).
    if (!job.paymentRecordedAt) {
      const pay = await ensurePaymentRecorded(api, invoiceId, job.amount, job.paidOn);
      if (pay.status === "mismatch") {
        return finalizeManualReview(
          db,
          jobId,
          "payment_amount_mismatch",
          `remote total ${pay.remoteTotal} != job ${job.amount}`,
        );
      }
      await db.update(invoiceJob).set({ paymentRecordedAt: new Date() }).where(eq(invoiceJob.id, jobId));
    }

    // Krok 3 — odeslání. 'estimated' datum se neodesílá automaticky (čeká na admina).
    if (!job.sentAt) {
      if (job.paidAtConfidence === "estimated") {
        return finalizeManualReview(
          db,
          jobId,
          "estimated_paid_date_no_autosend",
          "paidAt confidence=estimated -> odeslani ceka na admina",
        );
      }
      await ensureInvoiceSent(api, invoiceId, job.invoiceEmail ?? job.email);
      await db.update(invoiceJob).set({ sentAt: new Date() }).where(eq(invoiceJob.id, jobId));
    }

    await db
      .update(invoiceJob)
      .set({ state: "done", lastErrorCode: null, lastErrorStatus: null, lastErrorMessage: null, nextRetryAt: null })
      .where(eq(invoiceJob.id, jobId));
    return { status: "done", invoiceId };
  } catch (err) {
    const e = sanitizeInvoiceError(err);
    const permanent = job.attempts >= MAX_ATTEMPTS;
    await db
      .update(invoiceJob)
      .set({
        state: permanent ? "failed_permanent" : "failed_retryable",
        lastErrorCode: e.code,
        lastErrorStatus: e.status,
        lastErrorMessage: e.message,
        nextRetryAt: permanent ? null : new Date(now.getTime() + backoffMs(job.attempts)),
      })
      .where(eq(invoiceJob.id, jobId));
    return permanent ? { status: "failed_permanent", code: e.code } : { status: "failed_retryable", code: e.code };
  }
}

async function finalizeManualReview(
  db: Db,
  jobId: number,
  reason: string,
  detail: string,
): Promise<ProcessResult> {
  await db
    .update(invoiceJob)
    .set({ state: "needs_manual_review", lastErrorCode: reason, lastErrorMessage: detail, nextRetryAt: null })
    .where(eq(invoiceJob.id, jobId));
  return { status: "needs_manual_review", reason };
}
