import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq, and } from "drizzle-orm";
import { reportPurchase, bankDateToConversionInstant } from "../../src/lib/conversions";
import { purchase, conversionLog } from "../../src/db/schema";

const db = drizzle(env.DB);

// Vloží purchase a vrátí jeho id. Default = reportovatelný nákup (paid, consent, hodnota).
async function insertPurchase(overrides: Partial<typeof purchase.$inferInsert> = {}): Promise<number> {
  const now = new Date();
  const res = await db
    .insert(purchase)
    .values({
      email: "kupujici@example.com",
      type: "individual",
      paymentMethod: "stripe",
      status: "active",
      kind: "paid",
      marketingConsent: true,
      amountPaid: 2990,
      expiresAt: new Date(now.getTime() + 365 * 86400_000),
      createdAt: now,
      ...overrides,
    })
    .returning({ id: purchase.id });
  return res[0].id;
}

function logsFor(purchaseId: number) {
  return db.select().from(conversionLog).where(eq(conversionLog.purchaseId, purchaseId)).all();
}

// Meta config zapneme přes env, ať se provider 'meta' claimuje. fetch mockujeme.
// cloudflare:test typuje env jako Cloudflare.Env (testovací bindingy), reportPurchase
// chce náš Env — pro účely testu castujeme přes unknown.
import type { Env } from "../../src/types";
const baseEnv = env as unknown as Env;
const metaEnv = { ...baseEnv, META_PIXEL_ID: "123", META_CAPI_TOKEN: "tok" } as Env;

beforeEach(async () => {
  await db.delete(conversionLog);
  await db.delete(purchase);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("bankDateToConversionInstant — normalizace data z banky (R6)", () => {
  it("letní čas: začátek dne v Praze = 22:00 UTC předchozího dne (UTC+2)", () => {
    // 28. 6. je letní čas (CEST, UTC+2) → 00:00 Praha = 27. 6. 22:00 UTC.
    const d = bankDateToConversionInstant("2026-06-28");
    expect(d.toISOString()).toBe("2026-06-27T22:00:00.000Z");
  });

  it("zimní čas: začátek dne v Praze = 23:00 UTC předchozího dne (UTC+1)", () => {
    // 15. 1. je zimní čas (CET, UTC+1) → 00:00 Praha = 14. 1. 23:00 UTC.
    const d = bankDateToConversionInstant("2026-01-15");
    expect(d.toISOString()).toBe("2026-01-14T23:00:00.000Z");
  });

  it("akceptuje ISO s časem (vezme jen datovou část)", () => {
    const d = bankDateToConversionInstant("2026-06-28T14:33:00+02:00");
    expect(d.toISOString()).toBe("2026-06-27T22:00:00.000Z");
  });
});

describe("reportPurchase — guardy PŘED claimem", () => {
  it("comp grant se nereportuje (žádný conversion_log řádek)", async () => {
    const id = await insertPurchase({ kind: "comp" });
    await reportPurchase(db, metaEnv, id);
    expect(await logsFor(id)).toHaveLength(0);
  });

  it("staff přístup se nereportuje", async () => {
    const id = await insertPurchase({ kind: "staff" });
    await reportPurchase(db, metaEnv, id);
    expect(await logsFor(id)).toHaveLength(0);
  });

  it("bez marketingového souhlasu se nereportuje", async () => {
    const id = await insertPurchase({ marketingConsent: false });
    await reportPurchase(db, metaEnv, id);
    expect(await logsFor(id)).toHaveLength(0);
  });

  it("nulová hodnota se nereportuje", async () => {
    const id = await insertPurchase({ amountPaid: 0 });
    await reportPurchase(db, metaEnv, id);
    expect(await logsFor(id)).toHaveLength(0);
  });

  it("bez Meta konfigurace se Meta neclaimuje (žádný řádek)", async () => {
    const id = await insertPurchase();
    await reportPurchase(db, baseEnv, id); // env bez META_PIXEL_ID/TOKEN
    expect(await logsFor(id)).toHaveLength(0);
  });
});

describe("reportPurchase — Meta CAPI happy path", () => {
  it("úspěšné odeslání → conversion_log status=sent, attemptCount=1", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const id = await insertPurchase();
    await reportPurchase(db, metaEnv, id, { valueOverride: 1500, conversionOccurredAt: new Date(1_700_000_000_000) });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("/123/events"); // pixel id v cestě
    const logs = await logsFor(id);
    expect(logs).toHaveLength(1);
    expect(logs[0].status).toBe("sent");
    expect(logs[0].attemptCount).toBe(1); // insert=0 + jeden lease inkrement, ne dvojí
    expect(logs[0].leaseUntil).toBeNull(); // lease uvolněn
  });

  it("posílá value+CZK a event_id=purchaseId", async () => {
    let captured: any;
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      captured = JSON.parse(init.body as string);
      return new Response("{}", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const id = await insertPurchase();
    await reportPurchase(db, metaEnv, id, { valueOverride: 2990 });

    expect(captured.data[0].event_name).toBe("Purchase");
    expect(captured.data[0].event_id).toBe(String(id));
    expect(captured.data[0].custom_data).toEqual({ value: 2990, currency: "CZK" });
    expect(captured.data[0].user_data.em).toHaveLength(1); // hashed email
  });
});

describe("reportPurchase — idempotence (R3)", () => {
  it("druhé volání po úspěchu už neposílá (sent se přeskočí)", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const id = await insertPurchase();
    await reportPurchase(db, metaEnv, id);
    await reportPurchase(db, metaEnv, id); // re-run

    expect(fetchMock).toHaveBeenCalledTimes(1); // jen jednou
    const logs = await logsFor(id);
    expect(logs[0].status).toBe("sent");
    expect(logs[0].attemptCount).toBe(1);
  });

  it("selhání → failed; re-run doposílá a může uspět", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("err", { status: 400 })) // 1. pokus selže (ne transient)
      .mockResolvedValueOnce(new Response("{}", { status: 200 })); // re-run uspěje
    vi.stubGlobal("fetch", fetchMock);

    const id = await insertPurchase();
    await reportPurchase(db, metaEnv, id);
    let logs = await logsFor(id);
    expect(logs[0].status).toBe("failed");

    await reportPurchase(db, metaEnv, id); // doposlání
    logs = await logsFor(id);
    expect(logs[0].status).toBe("sent");
    expect(logs[0].attemptCount).toBe(2); // dva pokusy
  });

  it("nikdy nehází ven, ani když fetch selže výjimkou", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
    const id = await insertPurchase();
    await expect(reportPurchase(db, metaEnv, id)).resolves.toBeUndefined();
    const logs = await logsFor(id);
    expect(logs[0].status).toBe("failed");
  });
});
