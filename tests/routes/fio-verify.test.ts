import { env, SELF } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { purchase } from "../../src/db/schema";
import {
  activateFioPurchaseIfPendingForTest,
  fioRateLimitTtlSecondsForTest,
} from "../../src/routes/checkout";

describe("POST /api/fio/verify/:vs", () => {
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM purchase");
  });

  it("rejects non-HTMX POSTs before touching FIO lookup", async () => {
    const res = await SELF.fetch("https://test.local/api/fio/verify/33990101", {
      method: "POST",
    });

    expect(res.status).toBe(403);
  });

  it("rejects cross-origin HTMX POSTs", async () => {
    const res = await SELF.fetch("https://test.local/api/fio/verify/33990102", {
      method: "POST",
      headers: {
        "HX-Request": "true",
        Origin: "https://evil.example",
      },
    });

    expect(res.status).toBe(403);
  });

  it("uses a rate-limit TTL derived from FIO_RATE_LIMIT_MS", () => {
    expect(fioRateLimitTtlSecondsForTest()).toBe(35);
  });

  it("activates a pending purchase only once", async () => {
    const db = drizzle(env.DB);
    await db.insert(purchase).values({
      id: 9901,
      email: "fio-race@example.cz",
      type: "individual",
      paymentMethod: "fio",
      variableSymbol: "33999901",
      status: "pending",
      expiresAt: new Date("2026-06-07T08:00:00.000Z"),
      createdAt: new Date("2026-05-31T08:00:00.000Z"),
      amountPaid: 0,
    });

    const first = await activateFioPurchaseIfPendingForTest(db, {
      purchaseId: 9901,
      expiresAt: new Date("2027-05-31T08:00:00.000Z"),
      transactionId: "123456",
      amountPaid: 2000,
    });
    const second = await activateFioPurchaseIfPendingForTest(db, {
      purchaseId: 9901,
      expiresAt: new Date("2027-05-31T08:00:00.000Z"),
      transactionId: "123456",
      amountPaid: 2000,
    });

    expect(first).toBe(true);
    expect(second).toBe(false);

    const [row] = await db.select().from(purchase).where(eq(purchase.id, 9901));
    expect(row.status).toBe("active");
    expect(row.fioTransactionId).toBe("123456");
    expect(row.amountPaid).toBe(2000);
  });
});
