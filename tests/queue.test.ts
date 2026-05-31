import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { purchase } from "../src/db/schema";
import {
  handleQueue,
  issueFakturoidInvoiceForTest,
} from "../src/queue";

describe("queue Fakturoid idempotence", () => {
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM purchase");
  });

  it("skips invoice export when the purchase already has a Fakturoid invoice", async () => {
    const db = drizzle(env.DB);
    await db.insert(purchase).values({
      id: 8801,
      email: "paid@example.cz",
      type: "individual",
      paymentMethod: "stripe",
      stripePaymentId: "cs_test_existing_invoice",
      status: "active",
      expiresAt: new Date("2027-05-31T08:00:00.000Z"),
      createdAt: new Date("2026-05-31T08:00:00.000Z"),
      amountPaid: 2000,
      fakturoidInvoiceId: 777,
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await issueFakturoidInvoiceForTest(db, env as never, {
      sessionId: "cs_test_existing_invoice",
      email: "paid@example.cz",
      type: "individual",
      domain: null,
      amount: 2000,
      billing: {
        companyName: null,
        companyIco: null,
        companyDic: null,
        companyAddress: null,
        companyCity: null,
        companyZip: null,
        contactName: null,
      },
    });

    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

describe("queue message dispatch", () => {
  it("logs and acknowledges unknown webhook message types", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ack = vi.fn();
    const retry = vi.fn();
    const batch = {
      messages: [
        {
          body: { type: "unknown.event", data: {} },
          ack,
          retry,
        },
      ],
    } as unknown as MessageBatch<never>;

    await handleQueue(batch, env as never);

    expect(warnSpy).toHaveBeenCalledWith("[queue] Unknown webhook message type: unknown.event");
    expect(ack).toHaveBeenCalledOnce();
    expect(retry).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
