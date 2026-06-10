import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/d1";
import { hasAccess, invalidateAccessCache } from "../../src/lib/access";
import { purchase } from "../../src/db/schema";

const USER = { id: "u_access_test", email: "buyer@example.cz", role: "user" };
const cacheKey = `access:${USER.id}`;

describe("hasAccess + KV cache", () => {
  let db: ReturnType<typeof drizzle>;

  beforeEach(async () => {
    await env.DB.exec("DELETE FROM purchase");
    await env.DB.exec("DELETE FROM organization");
    await env.KV.delete(cacheKey);
    db = drizzle(env.DB);
  });

  async function insertActivePurchase() {
    await db.insert(purchase).values({
      email: USER.email,
      userId: USER.id,
      type: "individual",
      paymentMethod: "stripe",
      stripePaymentId: "pi_access_test",
      status: "active",
      expiresAt: new Date(Date.now() + 86400000),
      createdAt: new Date(),
    });
  }

  it("admin má přístup bez DB i cache zápisu", async () => {
    const granted = await hasAccess({ ...USER, role: "admin" }, db, env.KV);
    expect(granted).toBe(true);
    expect(await env.KV.get(cacheKey)).toBeNull();
  });

  it("pozitivní výsledek se zacachuje pod access:{userId}", async () => {
    await insertActivePurchase();
    expect(await hasAccess(USER, db, env.KV)).toBe(true);
    expect(await env.KV.get(cacheKey)).toBe("1");
  });

  it("negativní výsledek se NEcachuje (čerstvá platba musí projít hned)", async () => {
    expect(await hasAccess(USER, db, env.KV)).toBe(false);
    expect(await env.KV.get(cacheKey)).toBeNull();
  });

  it("cache hit vrátí přístup i po smazání purchase (do invalidace)", async () => {
    await insertActivePurchase();
    await hasAccess(USER, db, env.KV); // naplní cache
    await env.DB.exec("DELETE FROM purchase");

    // cache stále drží "1"
    expect(await hasAccess(USER, db, env.KV)).toBe(true);

    // po invalidaci se dopočítá znovu z DB → false
    await invalidateAccessCache(env.KV, USER.id);
    expect(await hasAccess(USER, db, env.KV)).toBe(false);
  });

  it("bez KV funguje jako čistý DB lookup", async () => {
    await insertActivePurchase();
    expect(await hasAccess(USER, db)).toBe(true);
    expect(await env.KV.get(cacheKey)).toBeNull();
  });
});
