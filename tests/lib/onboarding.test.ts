import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { purchase } from "../../src/db/schema";
import {
  ONBOARDING_SWEEP_FROM,
  sendOnboardingEventOnce,
  sweepPendingOnboardingEvents,
} from "../../src/lib/onboarding";

/**
 * Převodové nákupy (FIO / Creditas) nemají retry přes frontu. Když Resend
 * onboarding odmítne (429), dřív se ztratil nadobro. Teď se vrátí claim a
 * 15min cron ho dožene — ale jen u nákupů po ONBOARDING_SWEEP_FROM, ať se
 * starším zákazníkům (sloupec u nich nikdy nebyl vyplněný) nepošle znovu.
 */
describe("onboarding nejvýše jednou + dohánění převodů", () => {
  const db = drizzle(env.DB);
  const now = new Date(ONBOARDING_SWEEP_FROM.getTime() + 2 * 86400 * 1000);
  let events: string[];
  let status: number;

  beforeEach(async () => {
    await env.DB.exec("DELETE FROM purchase");
    events = [];
    status = 200;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.includes("resend.com/events/send")) {
        if (status !== 200) return new Response("limit", { status });
        events.push(String(JSON.parse(String(init?.body ?? "{}")).email));
      }
      return new Response("{}", { status: 200 });
    });
  });
  afterEach(() => vi.restoreAllMocks());

  async function insert(id: number, overrides: Partial<typeof purchase.$inferInsert> = {}) {
    await db.insert(purchase).values({
      id,
      email: `kupujici-${id}@example.cz`,
      type: "individual",
      paymentMethod: "fio",
      variableSymbol: `3399${id}`,
      status: "active",
      kind: "paid",
      amountPaid: 3000,
      expiresAt: new Date(now.getTime() + 365 * 86400 * 1000),
      createdAt: new Date(now.getTime() - 3600 * 1000),
      ...overrides,
    });
  }

  async function sentAt(id: number) {
    const [row] = await db.select().from(purchase).where(eq(purchase.id, id));
    return row.onboardingEventSentAt;
  }

  it("po odmítnutí (429) vrátí claim a sweep událost dožene", async () => {
    await insert(1);
    status = 429;
    const first = await sendOnboardingEventOnce(db, env, {
      purchaseId: 1, email: "kupujici-1@example.cz", payload: { type: "individual" },
    });
    expect(first).toBe("failed");
    expect(await sentAt(1)).toBeNull();

    status = 200;
    const r = await sweepPendingOnboardingEvents(db, env, now);
    expect(r).toEqual({ scanned: 1, sent: 1 });
    expect(events).toEqual(["kupujici-1@example.cz"]);
    expect(await sentAt(1)).not.toBeNull();

    // Další běh cronu už nic neposílá.
    expect(await sweepPendingOnboardingEvents(db, env, now)).toEqual({ scanned: 0, sent: 0 });
    expect(events).toHaveLength(1);
  });

  it("úspěšně odeslanou událost podruhé nepošle", async () => {
    await insert(2);
    const opts = { purchaseId: 2, email: "kupujici-2@example.cz", payload: {} };
    expect(await sendOnboardingEventOnce(db, env, opts)).toBe("sent");
    expect(await sendOnboardingEventOnce(db, env, opts)).toBe("already_sent");
    expect(events).toHaveLength(1);
  });

  it("nesahá na starší nákupy, Stripe, pending ani nákupy mimo 7denní okno", async () => {
    await insert(3, { createdAt: new Date(ONBOARDING_SWEEP_FROM.getTime() - 1000) }); // před hranicí
    await insert(4, { paymentMethod: "stripe", variableSymbol: null, stripePaymentId: "cs_test_4" });
    await insert(5, { status: "pending" });
    await insert(6, { kind: "comp", amountPaid: 0 });
    expect(await sweepPendingOnboardingEvents(db, env, now)).toEqual({ scanned: 0, sent: 0 });

    // Nákup starší než 7 dní už se nedohání.
    await insert(7);
    const later = new Date(now.getTime() + 8 * 86400 * 1000);
    expect(await sweepPendingOnboardingEvents(db, env, later)).toEqual({ scanned: 0, sent: 0 });
    expect(events).toEqual([]);
  });

  it("dožene i ručně potvrzenou platbu a Creditas", async () => {
    await insert(8, { kind: "manual" });
    await insert(9, { paymentMethod: "creditas" });
    expect(await sweepPendingOnboardingEvents(db, env, now)).toEqual({ scanned: 2, sent: 2 });
  });
});
