/**
 * Konzument fakturační fronty `videokurzy-invoices` + její DLQ (plán
 * docs/fakturacni-system-revize.md v1.0.0, sekce 5.7).
 *
 * Queue je jen JEDNORÁZOVÝ transport — processInvoiceJob řeší byznys chyby sám
 * (failed_retryable + nextRetryAt) a zprávu ACKujeme. Retry plánuje reconcile
 * cron dle nextRetryAt (D1 = zdroj pravdy), ne Cloudflare retry. Retry zprávy
 * (m.retry → DLQ) je tu jen pro NEČEKANÉ pády (např. výpadek D1 v claimu).
 */

import { drizzle } from "drizzle-orm/d1";
import { processInvoiceJob } from "./lib/invoicing/processor";
import { createInvoiceJob, type PaymentConfirmed } from "./lib/invoicing/jobs";
import type { Env } from "./types";

type Db = ReturnType<typeof drizzle>;

export interface InvoiceQueueMessage {
  jobId: number;
}

/** Zařadí fakturační úlohu ke zpracování. Best-effort — i kdyby selhal, řádek
 * v invoice_job zůstává a reconcile cron ho doručí (outbox). */
export async function enqueueInvoiceJob(env: Env, jobId: number): Promise<void> {
  await env.INVOICE_QUEUE.send({ jobId } satisfies InvoiceQueueMessage);
}

/**
 * Producer helper: idempotentně založí fakturační úlohu a (jen při novém založení)
 * ji zařadí do fronty. Duplicitní událost job nezaloží ani nezařadí. Selhání
 * enqueue nezhatí outbox — reconcile cron job doručí.
 */
export async function createAndEnqueueInvoiceJob(
  db: Db,
  env: Env,
  pc: PaymentConfirmed,
): Promise<void> {
  const res = await createInvoiceJob(db, pc);
  if (res.status !== "created") return;
  try {
    await enqueueInvoiceJob(env, res.jobId);
  } catch (err) {
    console.error(`[invoicing] enqueue selhal pro job ${res.jobId} (reconcile dožene):`, err);
  }
}

export async function handleInvoiceQueue(
  batch: MessageBatch<InvoiceQueueMessage>,
  env: Env,
): Promise<void> {
  const db = drizzle(env.DB);
  for (const message of batch.messages) {
    try {
      await processInvoiceJob(db, env, message.body.jobId);
      message.ack();
    } catch (err) {
      // Nečekaný pád (ne byznys chyba — tu processInvoiceJob ošetří sám).
      // Retry → po vyčerpání DLQ; reconcile mezitím zachytí uvízlé processing.
      console.error(`[invoice-queue] unexpected failure for job ${message.body.jobId}:`, err);
      message.retry();
    }
  }
}

/**
 * DLQ konzument — zprávy, které opakovaně spadly transportně. Jen alert/log,
 * NEnastavuje byznys stav (oponentura 0.3 B8). Skutečné zotavení řeší reconcile
 * cron přes CLAIM_TIMEOUT (uvízlé processing) — kroky jsou idempotentní.
 */
export async function handleInvoiceDlq(
  batch: MessageBatch<InvoiceQueueMessage>,
  _env: Env,
): Promise<void> {
  for (const message of batch.messages) {
    console.error(
      `[invoice-dlq] fakturační job ${message.body?.jobId} opakovaně selhal v transportu — ` +
        `reconcile cron ho zkusí znovu (uvízlé processing). Nutná kontrola, pokud přetrvává.`,
    );
    message.ack();
  }
}
