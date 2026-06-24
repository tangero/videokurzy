import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { discountInvite, purchase } from "../src/db/schema";
import {
  handleQueue,
  handleDlq,
  issueFakturoidInvoiceForTest,
  enqueueCcNewsItem,
  enqueueCcNewsSendNewsletter,
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

  it("consumes invite token after Stripe activation", async () => {
    const db = drizzle(env.DB);
    await env.DB.exec("DELETE FROM discount_invite");
    await env.DB.exec("DELETE FROM purchase");
    await db.insert(discountInvite).values({
      token: "q-inv",
      email: "buyer@example.cz",
      percent: 50,
      createdAt: new Date("2026-06-03T10:00:00.000Z"),
    });

    await handleQueue(
      {
        messages: [
          {
            body: {
              type: "checkout.session.completed",
              data: {
                id: "cs_test_invite_1",
                customer_email: "buyer@example.cz",
                amount_total: 100000,
                metadata: {
                  type: "individual",
                  discountPercent: "50",
                  discountCode: "invite:q-inv",
                  inviteToken: "q-inv",
                },
              },
            },
            ack() {},
            retry() {},
          },
        ],
      } as never,
      env as never,
    );

    const [row] = await db
      .select()
      .from(discountInvite)
      .where(eq(discountInvite.token, "q-inv"));
    expect(row.usedAt).not.toBeNull();
    const [p] = await db
      .select()
      .from(purchase)
      .where(eq(purchase.stripePaymentId, "cs_test_invite_1"));
    expect(row.usedByPurchaseId).toBe(p.id);
  });
});

describe("handleDlq — dead-letter queue", () => {
  it("zaloguje, pošle admin alert s MASKOVANÝM emailem a ack (žádný retry)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const ack = vi.fn();
    const retry = vi.fn();

    // Zachyť odchozí Resend alert (sendEmail → fetch).
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));

    await handleDlq(
      {
        queue: "videokurzy-webhooks-dlq",
        messages: [
          {
            body: {
              type: "checkout.session.completed",
              data: { id: "cs_dlq_1", customer_email: "tajny.kupec@firma.cz" },
            },
            attempts: 3,
            ack,
            retry,
          },
        ],
      } as never,
      env as never,
    );

    // DLQ je poslední instance: ack ano, retry ne.
    expect(ack).toHaveBeenCalledOnce();
    expect(retry).not.toHaveBeenCalled();

    // Strukturovaný log obsahuje typ + stripeId, ale NE plný email.
    const loggedJson = errorSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(loggedJson).toContain("webhook_permanently_failed");
    expect(loggedJson).toContain("cs_dlq_1");
    expect(loggedJson).not.toContain("tajny.kupec");

    // Admin alert email odešel a neobsahuje plný email kupujícího.
    expect(fetchSpy).toHaveBeenCalledOnce();
    const sentBody = JSON.parse(
      (fetchSpy.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(sentBody.subject).toContain("checkout.session.completed");
    expect(sentBody.html).toContain("t***@firma.cz");
    expect(sentBody.html).not.toContain("tajny.kupec");

    fetchSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("ack i když admin alert email selže (DLQ zpráva nesmí uvíznout)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const ack = vi.fn();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("resend down"));

    await handleDlq(
      {
        queue: "videokurzy-webhooks-dlq",
        messages: [
          {
            body: { type: "invoice.paid", data: { subscription: "sub_x" } },
            attempts: 3,
            ack,
            retry: vi.fn(),
          },
        ],
      } as never,
      env as never,
    );

    expect(ack).toHaveBeenCalledOnce();
    fetchSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("escapuje HTML v admin alertu (XSS přes webhook data — greptile P2)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));

    await handleDlq(
      {
        queue: "videokurzy-webhooks-dlq",
        messages: [
          {
            body: {
              // Stripe ID se škodlivým markupem — musí být v e-mailu escapováno.
              type: "checkout.session.completed",
              data: { id: "<script>alert(1)</script>", customer_email: "a@b.cz" },
            },
            attempts: 3,
            ack: vi.fn(),
            retry: vi.fn(),
          },
        ],
      } as never,
      env as never,
    );

    const sentBody = JSON.parse(
      (fetchSpy.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(sentBody.html).not.toContain("<script>alert(1)</script>");
    expect(sentBody.html).toContain("&lt;script&gt;");

    fetchSpy.mockRestore();
    errorSpy.mockRestore();
  });
});

describe("enqueueCcNewsItem — payload pro frontu", () => {
  it("bez opts: jen itemId + sourceId (cron cesta)", async () => {
    const sent: unknown[] = [];
    const fakeEnv = { WEBHOOK_QUEUE: { send: async (m: unknown) => { sent.push(m); } } } as never;
    await enqueueCcNewsItem(fakeEnv, "item-1", "/docs/en/whats-new/2026-w24");
    expect(sent).toEqual([
      { type: "cc-news.detected", data: { itemId: "item-1", sourceId: "/docs/en/whats-new/2026-w24" } },
    ]);
  });

  it("s manualTrigger+force: příznaky se propíšou do payloadu (ruční trigger na pozadí)", async () => {
    const sent: any[] = [];
    const fakeEnv = { WEBHOOK_QUEUE: { send: async (m: unknown) => { sent.push(m); } } } as never;
    await enqueueCcNewsItem(fakeEnv, "item-1", "/docs/en/whats-new/2026-w24", {
      manualTrigger: true,
      force: true,
    });
    expect(sent[0].data).toEqual({
      itemId: "item-1",
      sourceId: "/docs/en/whats-new/2026-w24",
      manualTrigger: true,
      force: true,
    });
  });

  it("manuální trigger při SELHÁNÍ ack-uje (NEretryuje) — brání duplicitě e-mailu", async () => {
    // Zpracování manuálního triggeru reálně volá síť (fetch detailu digestu),
    // což v test env selže → triggerCcNewsApproval hodí. Konzument to MUSÍ
    // spolknout a ack-nout, ne retry (retry by poslal duplicitní e-mail).
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const ack = vi.fn();
    const retry = vi.fn();

    await handleQueue(
      {
        messages: [
          {
            body: {
              type: "cc-news.detected",
              data: { itemId: "item-x", sourceId: "/docs/en/whats-new/2099-w99", manualTrigger: true, force: true },
            },
            ack,
            retry,
          },
        ],
      } as never,
      env as never,
    );

    // Klíčové: ack ano, retry NE — i když zpracování selhalo.
    expect(ack).toHaveBeenCalledOnce();
    expect(retry).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

describe("enqueueCcNewsSendNewsletter — async rozeslání newsletteru", () => {
  it("zařadí zprávu cc-news.send-newsletter s itemId (+ force volitelně)", async () => {
    const sent: any[] = [];
    const fakeEnv = { WEBHOOK_QUEUE: { send: async (m: unknown) => { sent.push(m); } } } as never;

    await enqueueCcNewsSendNewsletter(fakeEnv, "item-1");
    await enqueueCcNewsSendNewsletter(fakeEnv, "item-2", { force: true });

    expect(sent[0]).toEqual({ type: "cc-news.send-newsletter", data: { itemId: "item-1" } });
    expect(sent[1]).toEqual({ type: "cc-news.send-newsletter", data: { itemId: "item-2", force: true } });
  });

  it("malformovaná zpráva (chybí itemId) se ack-ne a NEretryuje", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const ack = vi.fn();
    const retry = vi.fn();

    await handleQueue(
      {
        messages: [
          { body: { type: "cc-news.send-newsletter", data: {} }, ack, retry },
        ],
      } as never,
      env as never,
    );

    expect(ack).toHaveBeenCalledOnce();
    expect(retry).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("nepublikované vydání → handler skončí skipped (no-content), ack bez retry", async () => {
    // Bez řádky v cc_news_item / bez KV obsahu vrátí sendCcNewsNewsletterForItem
    // skipped:no-content. Handler to jen zaloguje a ack-ne (žádná výjimka → žádný retry).
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const ack = vi.fn();
    const retry = vi.fn();

    await handleQueue(
      {
        messages: [
          { body: { type: "cc-news.send-newsletter", data: { itemId: "neexistuje" } }, ack, retry },
        ],
      } as never,
      env as never,
    );

    expect(ack).toHaveBeenCalledOnce();
    expect(retry).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });
});
