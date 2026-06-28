import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { describe, it, expect, beforeEach } from "vitest";
import { invoiceJob, purchase } from "../../../src/db/schema";
import { processInvoiceJob, sanitizeInvoiceError } from "../../../src/lib/invoicing/processor";
import type { FakturoidApi } from "../../../src/lib/invoicing/fakturoid-gateway";
import type { Env } from "../../../src/types";

const E = env as unknown as Env;
const db = () => drizzle(env.DB);

/** Konfigurovatelný mock Fakturoidu pro orchestrátor. */
function fakeApi(opts: {
  existingByCustomId?: unknown[];
  invoice?: Record<string, unknown>;
  createdInvoiceId?: number;
  throwOn?: string; // path substring, na kterém GET/POST vyhodí
} = {}): { api: FakturoidApi; calls: string[] } {
  const calls: string[] = [];
  const inv = opts.invoice ?? { id: opts.createdInvoiceId ?? 500, status: "open", payments: [], sent_at: null };
  const api: FakturoidApi = {
    get: async <T>(path: string) => {
      calls.push(`GET ${path}`);
      if (opts.throwOn && path.includes(opts.throwOn)) throw new Error(`Fakturoid API GET ${path} failed (502): boom`);
      if (path.startsWith("invoices.json?custom_id")) return (opts.existingByCustomId ?? []) as T;
      if (path.startsWith("subjects/search")) return [] as T;
      if (path.match(/^invoices\/\d+\.json/)) return inv as T;
      return null as T;
    },
    post: async <T>(path: string, _body?: unknown) => {
      calls.push(`POST ${path}`);
      if (opts.throwOn && path.includes(opts.throwOn)) throw new Error(`Fakturoid API POST ${path} failed (500): boom`);
      if (path === "subjects.json") return { id: 9 } as T;
      if (path === "invoices.json") return { id: opts.createdInvoiceId ?? 500 } as T;
      return {} as T;
    },
  };
  return { api, calls };
}

async function seedPurchase(type: "individual" | "organization" = "individual"): Promise<number> {
  const [row] = await db()
    .insert(purchase)
    .values({ email: "a@b.cz", type, status: "active", expiresAt: new Date(), createdAt: new Date(), amountPaid: 3000 })
    .returning({ id: purchase.id });
  return row.id;
}

async function seedJob(purchaseId: number, over: Partial<typeof invoiceJob.$inferInsert> = {}): Promise<number> {
  const [row] = await db()
    .insert(invoiceJob)
    .values({
      purchaseId,
      jobKind: "initial_purchase",
      customId: `vk-purchase-${purchaseId}`,
      paymentSource: "manual",
      amount: 3000,
      paidAt: new Date("2026-06-27T08:00:00Z"),
      paidOn: "2026-06-27",
      paidAtSource: "manual_admin_input",
      email: "a@b.cz",
      createdAt: new Date(),
      ...over,
    })
    .returning({ id: invoiceJob.id });
  return row.id;
}

async function getJob(id: number) {
  const [j] = await db().select().from(invoiceJob).where(eq(invoiceJob.id, id)).limit(1);
  return j;
}

async function clear() {
  await env.DB.prepare("DELETE FROM invoice_job").run();
  await env.DB.prepare("DELETE FROM purchase").run();
}

describe("sanitizeInvoiceError", () => {
  it("vytáhne status, maskuje e-mail, omezí délku", () => {
    const e = sanitizeInvoiceError(new Error("failed (422): konflikt pro user@x.cz token=abc123"));
    expect(e.status).toBe(422);
    expect(e.code).toBe("http_422");
    expect(e.message).toContain("<email>");
    expect(e.message).not.toContain("user@x.cz");
  });
});

describe("processInvoiceJob", () => {
  beforeEach(clear);

  it("happy path → done (create + payment + send)", async () => {
    const pid = await seedPurchase();
    const jid = await seedJob(pid);
    const { api, calls } = fakeApi();
    const res = await processInvoiceJob(db(), E, jid, api);
    expect(res).toEqual({ status: "done", invoiceId: 500 });
    const j = await getJob(jid);
    expect(j.state).toBe("done");
    expect(j.fakturoidInvoiceId).toBe(500);
    expect(j.issuedAt).not.toBeNull();
    expect(j.paymentRecordedAt).not.toBeNull();
    expect(j.sentAt).not.toBeNull();
    expect(calls).toContain("POST invoices.json");
    expect(calls).toContain("POST invoices/500/message.json");
  });

  it("vstupní faktura zrcadlí fakturoidInvoiceId na purchase (legacy nástroje)", async () => {
    const pid = await seedPurchase();
    const jid = await seedJob(pid);
    await processInvoiceJob(db(), E, jid, fakeApi().api);
    const [p] = await db()
      .select({ fid: purchase.fakturoidInvoiceId })
      .from(purchase)
      .where(eq(purchase.id, pid))
      .limit(1);
    expect(p.fid).toBe(500);
  });

  it("renewal NEpřepisuje purchase.fakturoidInvoiceId (zůstává initial)", async () => {
    const pid = await seedPurchase();
    await db().update(purchase).set({ fakturoidInvoiceId: 111 }).where(eq(purchase.id, pid));
    const jid = await seedJob(pid, { jobKind: "stripe_renewal", customId: `vk-stripe-invoice-r${pid}` });
    await processInvoiceJob(db(), E, jid, fakeApi({ createdInvoiceId: 999 }).api);
    const [p] = await db()
      .select({ fid: purchase.fakturoidInvoiceId })
      .from(purchase)
      .where(eq(purchase.id, pid))
      .limit(1);
    expect(p.fid).toBe(111);
  });

  it("resume: s předvyplněnou fakturou + platbou jen odešle", async () => {
    const pid = await seedPurchase();
    const jid = await seedJob(pid, {
      state: "failed_retryable",
      fakturoidInvoiceId: 500,
      paymentRecordedAt: new Date(),
    });
    const { api, calls } = fakeApi();
    const res = await processInvoiceJob(db(), E, jid, api);
    expect(res.status).toBe("done");
    expect(calls.some((c) => c === "POST invoices.json")).toBe(false); // krok 1 přeskočen
    expect(calls).toContain("POST invoices/500/message.json");
  });

  it("mismatch částky → needs_manual_review", async () => {
    const pid = await seedPurchase();
    const jid = await seedJob(pid);
    const { api } = fakeApi({ invoice: { id: 500, payments: [{ amount: "2000.0" }], sent_at: null } });
    const res = await processInvoiceJob(db(), E, jid, api);
    expect(res.status).toBe("needs_manual_review");
    const j = await getJob(jid);
    expect(j.state).toBe("needs_manual_review");
    expect(j.lastErrorCode).toBe("payment_amount_mismatch");
  });

  it("estimated paidAt → needs_manual_review BEZ vytvoření faktury (špatné datum)", async () => {
    const pid = await seedPurchase();
    const jid = await seedJob(pid, { paidAtConfidence: "estimated" });
    const { api, calls } = fakeApi();
    const res = await processInvoiceJob(db(), E, jid, api);
    expect(res.status).toBe("needs_manual_review");
    const j = await getJob(jid);
    expect(j.lastErrorCode).toBe("estimated_paid_date");
    expect(j.fakturoidInvoiceId).toBeNull(); // faktura se NEvytvořila
    expect(calls.some((c) => c.includes("invoices.json"))).toBe(false);
    expect(calls.some((c) => c.includes("message.json"))).toBe(false);
  });

  it("chyba Fakturoidu → failed_retryable + nextRetryAt", async () => {
    const pid = await seedPurchase();
    const jid = await seedJob(pid);
    const { api } = fakeApi({ throwOn: "invoices.json" });
    const res = await processInvoiceJob(db(), E, jid, api);
    expect(res.status).toBe("failed_retryable");
    const j = await getJob(jid);
    expect(j.state).toBe("failed_retryable");
    expect(j.attempts).toBe(1);
    expect(j.nextRetryAt).not.toBeNull();
    expect(j.lastErrorStatus).toBeGreaterThanOrEqual(500); // 502 z GET custom_id lookupu
  });

  it("po vyčerpání pokusů → failed_permanent", async () => {
    const pid = await seedPurchase();
    const jid = await seedJob(pid, { attempts: 5 }); // claim → 6 = MAX_ATTEMPTS
    const { api } = fakeApi({ throwOn: "invoices.json" });
    const res = await processInvoiceJob(db(), E, jid, api);
    expect(res.status).toBe("failed_permanent");
    const j = await getJob(jid);
    expect(j.state).toBe("failed_permanent");
    expect(j.nextRetryAt).toBeNull();
  });

  it("už hotový job → skipped (claim nikoho nevybere)", async () => {
    const pid = await seedPurchase();
    const jid = await seedJob(pid, { state: "done" });
    const { api } = fakeApi();
    const res = await processInvoiceJob(db(), E, jid, api);
    expect(res.status).toBe("skipped");
  });

  it("dvojí zpracování: druhý běh už nic nedělá", async () => {
    const pid = await seedPurchase();
    const jid = await seedJob(pid);
    const a = await processInvoiceJob(db(), E, jid, fakeApi().api);
    const b = await processInvoiceJob(db(), E, jid, fakeApi().api);
    expect(a.status).toBe("done");
    expect(b.status).toBe("skipped");
  });
});
