import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { describe, it, expect, beforeEach } from "vitest";
import { invoiceJob } from "../../../src/db/schema";
import { reconcileInvoiceJobs } from "../../../src/lib/invoicing/reconcile";
import { CLAIM_TIMEOUT_MS } from "../../../src/lib/invoicing/processor";
import type { Env } from "../../../src/types";

const E = env as unknown as Env;
const db = () => drizzle(env.DB);
const NOW = new Date("2026-06-28T12:00:00Z");

let seq = 0;
async function seedJob(over: Partial<typeof invoiceJob.$inferInsert>): Promise<number> {
  seq += 1;
  const [row] = await db()
    .insert(invoiceJob)
    .values({
      purchaseId: seq,
      jobKind: "initial_purchase",
      customId: `vk-purchase-${seq}-${Math.floor(NOW.getTime())}`,
      paymentSource: "manual",
      sourceEventId: `evt-${seq}`,
      amount: 3000,
      paidAt: NOW,
      paidOn: "2026-06-28",
      paidAtSource: "manual_admin_input",
      email: "a@b.cz",
      createdAt: NOW,
      ...over,
    })
    .returning({ id: invoiceJob.id });
  return row.id;
}

async function clear() {
  await env.DB.prepare("DELETE FROM invoice_job").run();
}

/** Sběr enqueue volání místo reálné fronty. */
function recorder() {
  const ids: number[] = [];
  return { fn: async (_e: Env, id: number) => void ids.push(id), ids };
}

describe("reconcileInvoiceJobs", () => {
  beforeEach(async () => {
    await clear();
    seq = 0;
  });

  it("vybere pending, dozrálý failed_retryable a uvízlé processing; vynechá terminální", async () => {
    const pending = await seedJob({ state: "pending" });
    const dueRetry = await seedJob({ state: "failed_retryable", nextRetryAt: new Date(NOW.getTime() - 60_000) });
    const stale = await seedJob({ state: "processing", claimedAt: new Date(NOW.getTime() - CLAIM_TIMEOUT_MS - 60_000) });

    // NEsmí se vybrat:
    await seedJob({ state: "failed_retryable", nextRetryAt: new Date(NOW.getTime() + 60 * 60_000) }); // retry v budoucnu
    await seedJob({ state: "processing", claimedAt: new Date(NOW.getTime() - 60_000) }); // čerstvě claimnuté
    await seedJob({ state: "done" });
    await seedJob({ state: "failed_permanent" });
    await seedJob({ state: "needs_manual_review" });
    await seedJob({ state: "resolved_manually" });

    const rec = recorder();
    const res = await reconcileInvoiceJobs(db(), E, NOW, rec.fn);

    expect(res.scanned).toBe(3);
    expect(res.enqueued).toBe(3);
    expect(new Set(rec.ids)).toEqual(new Set([pending, dueRetry, stale]));
  });

  it("failed_retryable s nextRetryAt=null se vybere (nikdy neodloženo)", async () => {
    const j = await seedJob({ state: "failed_retryable", nextRetryAt: null });
    const rec = recorder();
    const res = await reconcileInvoiceJobs(db(), E, NOW, rec.fn);
    expect(res.scanned).toBe(1);
    expect(rec.ids).toEqual([j]);
  });

  it("prázdný outbox → nic", async () => {
    const rec = recorder();
    const res = await reconcileInvoiceJobs(db(), E, NOW, rec.fn);
    expect(res).toEqual({ scanned: 0, enqueued: 0 });
  });
});
