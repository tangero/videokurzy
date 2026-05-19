import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/d1";
import { purchase } from "../../src/db/schema";
import { sendPaymentReminders } from "../../src/lib/payment-reminders";

const NOW = new Date("2026-05-17T10:00:00.000Z");

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * 86400 * 1000);
}

interface FakeKV {
  get: (key: string) => Promise<string | null>;
  put: (key: string, value: string, opts?: unknown) => Promise<void>;
}

function makeKV(): { kv: FakeKV; store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    kv: {
      get: async (k) => store.get(k) ?? null,
      put: async (k, v) => {
        store.set(k, v);
      },
    },
  };
}

function makeEnv(extra: Partial<Record<string, unknown>> = {}) {
  const { kv } = makeKV();
  return {
    ...env,
    BETTER_AUTH_URL: "https://kurzy.vibecoding.cz",
    RESEND_API_KEY: "test_resend",
    KV: kv,
    ...extra,
  } as never;
}

describe("sendPaymentReminders", () => {
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM purchase");
    vi.restoreAllMocks();
  });

  it("sends 2-day reminder for fresh FIO pending order", async () => {
    const db = drizzle(env.DB);
    await db.insert(purchase).values({
      email: "buyer@example.cz",
      type: "individual",
      paymentMethod: "fio",
      variableSymbol: "33000001",
      status: "pending",
      kind: "paid",
      expiresAt: new Date("2026-05-22T10:00:00.000Z"),
      createdAt: daysAgo(2),
    });

    const sent = vi.fn();
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      sent(JSON.parse(String(init.body)));
      return new Response("{}", { status: 200 });
    });

    const result = await sendPaymentReminders(db, makeEnv(), NOW);

    expect(result).toEqual({ sent: 1, errors: 0, skipped: 0 });
    expect(sent).toHaveBeenCalledWith(expect.objectContaining({
      to: ["buyer@example.cz"],
      subject: "Připomínáme platbu kurzu",
    }));
    const body = sent.mock.calls[0][0];
    expect(body.html).toContain("api.qrserver.com");
    expect(body.html).toContain("33000001");
    // Link na kartu vede na příslušný checkout flow.
    expect(body.html).toContain("/checkout/individual");
  });

  it("sends 5-day reminder with urgency wording", async () => {
    const db = drizzle(env.DB);
    await db.insert(purchase).values({
      email: "late@example.cz",
      type: "organization",
      paymentMethod: "fio",
      variableSymbol: "33000002",
      status: "pending",
      kind: "paid",
      expiresAt: new Date("2026-05-19T10:00:00.000Z"),
      createdAt: daysAgo(5),
    });

    const sent = vi.fn();
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      sent(JSON.parse(String(init.body)));
      return new Response("{}", { status: 200 });
    });

    const result = await sendPaymentReminders(db, makeEnv(), NOW);

    expect(result.sent).toBe(1);
    expect(sent.mock.calls[0][0].subject).toBe("Platba kurzu — splatnost končí za 2 dny");
    // B2B objednávka má card link na organization flow.
    expect(sent.mock.calls[0][0].html).toContain("/checkout/organization");
  });

  it("does not send to comp/staff grants or to non-FIO purchases", async () => {
    const db = drizzle(env.DB);
    // Granty — měly by být přeskočeny i pokud měly stejné stáří.
    await db.insert(purchase).values({
      email: "comp@example.cz",
      type: "individual",
      paymentMethod: "fio",
      variableSymbol: "33000003",
      status: "pending",
      kind: "comp",
      expiresAt: new Date("2026-05-22T10:00:00.000Z"),
      createdAt: daysAgo(2),
    });
    // Stripe pending — také se nemělo by stát, ale filtr ho vyhodí.
    await db.insert(purchase).values({
      email: "stripe@example.cz",
      type: "individual",
      paymentMethod: "stripe",
      stripePaymentId: "cs_test_123",
      status: "pending",
      kind: "paid",
      expiresAt: new Date("2026-05-22T10:00:00.000Z"),
      createdAt: daysAgo(2),
    });
    // Active — už zaplaceno, neposílá se.
    await db.insert(purchase).values({
      email: "active@example.cz",
      type: "individual",
      paymentMethod: "fio",
      variableSymbol: "33000004",
      status: "active",
      kind: "paid",
      expiresAt: new Date("2027-05-22T10:00:00.000Z"),
      createdAt: daysAgo(2),
    });

    const sent = vi.fn();
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      sent(JSON.parse(String(init.body)));
      return new Response("{}", { status: 200 });
    });

    const result = await sendPaymentReminders(db, makeEnv(), NOW);
    expect(result.sent).toBe(0);
    expect(sent).not.toHaveBeenCalled();
  });

  it("dedupes via KV — second run does not resend", async () => {
    const db = drizzle(env.DB);
    await db.insert(purchase).values({
      email: "buyer@example.cz",
      type: "individual",
      paymentMethod: "fio",
      variableSymbol: "33000005",
      status: "pending",
      kind: "paid",
      expiresAt: new Date("2026-05-22T10:00:00.000Z"),
      createdAt: daysAgo(2),
    });

    const sent = vi.fn();
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      sent(JSON.parse(String(init.body)));
      return new Response("{}", { status: 200 });
    });

    const { kv } = makeKV();
    const sharedEnv = { ...env, BETTER_AUTH_URL: "https://kurzy.vibecoding.cz", RESEND_API_KEY: "test_resend", KV: kv } as never;

    const r1 = await sendPaymentReminders(drizzle(env.DB), sharedEnv, NOW);
    expect(r1.sent).toBe(1);

    const r2 = await sendPaymentReminders(drizzle(env.DB), sharedEnv, NOW);
    expect(r2).toEqual({ sent: 0, errors: 0, skipped: 1 });
    expect(sent).toHaveBeenCalledTimes(1);
  });

  it("kill switch via PAYMENT_REMINDERS_ENABLED=false short-circuits", async () => {
    const db = drizzle(env.DB);
    await db.insert(purchase).values({
      email: "skip@example.cz",
      type: "individual",
      paymentMethod: "fio",
      variableSymbol: "33000006",
      status: "pending",
      kind: "paid",
      expiresAt: new Date("2026-05-22T10:00:00.000Z"),
      createdAt: daysAgo(2),
    });

    const sent = vi.fn();
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      sent(JSON.parse(String(init.body)));
      return new Response("{}", { status: 200 });
    });

    const result = await sendPaymentReminders(db, makeEnv({ PAYMENT_REMINDERS_ENABLED: "false" }), NOW);
    expect(result).toEqual({ sent: 0, errors: 0, skipped: -1 });
    expect(sent).not.toHaveBeenCalled();
  });

  it("skips pending order without VS (data inconsistency)", async () => {
    const db = drizzle(env.DB);
    await db.insert(purchase).values({
      email: "novs@example.cz",
      type: "individual",
      paymentMethod: "fio",
      variableSymbol: null,
      status: "pending",
      kind: "paid",
      expiresAt: new Date("2026-05-22T10:00:00.000Z"),
      createdAt: daysAgo(2),
    });

    const sent = vi.fn();
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      sent(JSON.parse(String(init.body)));
      return new Response("{}", { status: 200 });
    });

    const result = await sendPaymentReminders(db, makeEnv(), NOW);
    expect(result.sent).toBe(0);
    expect(result.skipped).toBe(1);
    expect(sent).not.toHaveBeenCalled();
  });
});
