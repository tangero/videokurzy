import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { describe, it, expect, beforeEach } from "vitest";
import {
  customIdFor,
  paidOnFromDate,
  isWholeCrowns,
  buildInvoiceJobValues,
  createInvoiceJob,
  shouldInvoice,
  type PaymentConfirmed,
} from "../../../src/lib/invoicing/jobs";

function pc(overrides: Partial<PaymentConfirmed> = {}): PaymentConfirmed {
  return {
    purchaseId: 1,
    jobKind: "initial_purchase",
    paymentSource: "stripe_checkout",
    sourceEventId: "cs_test_1",
    amount: 3000,
    paidAt: new Date("2026-06-27T08:57:00Z"),
    paidAtSource: "stripe_api",
    billing: { email: "a@b.cz" },
    ...overrides,
  };
}

async function clearJobs() {
  await env.DB.prepare("DELETE FROM invoice_job").run();
}

describe("customIdFor", () => {
  it("vstupní faktura → vk-purchase-<id>", () => {
    expect(customIdFor({ jobKind: "initial_purchase", purchaseId: 42, stripeInvoiceId: null }))
      .toBe("vk-purchase-42");
  });

  it("renewal → vk-stripe-invoice-<stripeInvoiceId>", () => {
    expect(customIdFor({ jobKind: "stripe_renewal", purchaseId: 42, stripeInvoiceId: "in_9" }))
      .toBe("vk-stripe-invoice-in_9");
  });

  it("renewal bez stripeInvoiceId vyhodí chybu", () => {
    expect(() => customIdFor({ jobKind: "stripe_renewal", purchaseId: 42, stripeInvoiceId: null }))
      .toThrow(/stripeInvoiceId/);
  });
});

describe("paidOnFromDate (TZ Europe/Prague)", () => {
  it("večerní UTC platba patří do následujícího pražského dne (letní čas +2)", () => {
    // 2026-06-27 22:30 UTC = 2026-06-28 00:30 Praha
    expect(paidOnFromDate(new Date("2026-06-27T22:30:00Z"))).toBe("2026-06-28");
  });

  it("dopolední UTC platba zůstává v témže dni", () => {
    expect(paidOnFromDate(new Date("2026-06-27T08:57:00Z"))).toBe("2026-06-27");
  });

  it("zimní čas (+1): 23:30 UTC patří do následujícího dne", () => {
    // 2026-01-15 23:30 UTC = 2026-01-16 00:30 Praha
    expect(paidOnFromDate(new Date("2026-01-15T23:30:00Z"))).toBe("2026-01-16");
  });
});

describe("isWholeCrowns", () => {
  it.each([
    [3000, true],
    [2000.0, true],
    [2000.5, false],
    [Number.NaN, false],
  ])("%s → %s", (amount, expected) => {
    expect(isWholeCrowns(amount as number)).toBe(expected);
  });
});

describe("buildInvoiceJobValues", () => {
  it("celá částka → state=pending, bez error reason", () => {
    const v = buildInvoiceJobValues(pc({ amount: 3000 }));
    expect(v.state).toBe("pending");
    expect(v.amount).toBe(3000);
    expect(v.lastErrorCode).toBeNull();
    expect(v.customId).toBe("vk-purchase-1");
    expect(v.paidOn).toBe("2026-06-27");
  });

  it("zlomková částka → needs_manual_review + reason, žádné tiché zaokrouhlení do účetnictví", () => {
    const v = buildInvoiceJobValues(pc({ amount: 2000.5 }));
    expect(v.state).toBe("needs_manual_review");
    expect(v.lastErrorCode).toBe("non_integer_amount");
    expect(v.lastErrorMessage).toContain("2000.5");
  });

  it("initialState override (backfill) má přednost", () => {
    const v = buildInvoiceJobValues(pc({ initialState: "needs_reconcile" }));
    expect(v.state).toBe("needs_reconcile");
  });

  it("renewal sestaví customId ze stripeInvoiceId", () => {
    const v = buildInvoiceJobValues(pc({ jobKind: "stripe_renewal", stripeInvoiceId: "in_5", sourceEventId: "in_5" }));
    expect(v.customId).toBe("vk-stripe-invoice-in_5");
  });
});

describe("shouldInvoice", () => {
  it.each([
    [{ kind: "paid", amountPaid: 3000 }, true],
    [{ kind: "manual", amountPaid: 1500 }, true],
    [{ kind: "comp", amountPaid: 0 }, false],
    [{ kind: "staff", amountPaid: 0 }, false],
    [{ kind: "paid", amountPaid: 0 }, false],
  ])("%o → %s", (p, expected) => {
    expect(shouldInvoice(p as { kind: string; amountPaid: number })).toBe(expected);
  });
});

describe("createInvoiceJob (DB dedup)", () => {
  beforeEach(clearJobs);

  it("založí novou úlohu", async () => {
    const db = drizzle(env.DB);
    const res = await createInvoiceJob(db, pc());
    expect(res.status).toBe("created");
    if (res.status === "created") expect(res.jobId).toBeGreaterThan(0);
  });

  it("duplicita dle customId → neduplikuje", async () => {
    const db = drizzle(env.DB);
    await createInvoiceJob(db, pc({ sourceEventId: "cs_A" }));
    // stejný purchaseId+jobKind → stejné customId 'vk-purchase-1'
    const res = await createInvoiceJob(db, pc({ sourceEventId: "cs_B" }));
    expect(res.status).toBe("duplicate");
  });

  it("duplicita dle initial_purchase (jiný customId nelze — stejný purchase initial)", async () => {
    const db = drizzle(env.DB);
    await createInvoiceJob(db, pc({ purchaseId: 7, sourceEventId: "x1" }));
    const res = await createInvoiceJob(db, pc({ purchaseId: 7, sourceEventId: "x2" }));
    expect(res.status).toBe("duplicate");
  });

  it("duplicita dle (paymentSource, sourceEventId)", async () => {
    const db = drizzle(env.DB);
    // dvě různá purchase, ale stejná platební událost → dedup přes source_event index
    await createInvoiceJob(db, pc({ purchaseId: 10, sourceEventId: "evt_same" }));
    const res = await createInvoiceJob(db, pc({ purchaseId: 11, sourceEventId: "evt_same" }));
    expect(res.status).toBe("duplicate");
  });

  it("dvě renewal faktury k jednomu purchase s různým stripeInvoiceId → obě projdou", async () => {
    const db = drizzle(env.DB);
    const a = await createInvoiceJob(db, pc({ purchaseId: 20, jobKind: "stripe_renewal", stripeInvoiceId: "in_1", sourceEventId: "in_1" }));
    const b = await createInvoiceJob(db, pc({ purchaseId: 20, jobKind: "stripe_renewal", stripeInvoiceId: "in_2", sourceEventId: "in_2" }));
    expect(a.status).toBe("created");
    expect(b.status).toBe("created");
  });

  it("NULL sourceEventId nekoliduje (partial index)", async () => {
    const db = drizzle(env.DB);
    const a = await createInvoiceJob(db, pc({ purchaseId: 30, jobKind: "stripe_renewal", stripeInvoiceId: "in_a", sourceEventId: null }));
    const b = await createInvoiceJob(db, pc({ purchaseId: 31, jobKind: "stripe_renewal", stripeInvoiceId: "in_b", sourceEventId: null }));
    expect(a.status).toBe("created");
    expect(b.status).toBe("created");
  });
});
