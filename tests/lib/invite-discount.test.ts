import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { discountInvite } from "../../src/db/schema";
import {
  resolveInviteDiscount,
  consumeInviteToken,
} from "../../src/lib/discount";

const NOW = new Date("2026-06-03T10:00:00.000Z");

describe("resolveInviteDiscount", () => {
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM discount_invite");
  });

  async function seed(overrides: Partial<typeof discountInvite.$inferInsert> = {}) {
    const db = drizzle(env.DB);
    await db.insert(discountInvite).values({
      token: "tok-valid",
      email: "absolvent@example.cz",
      percent: 50,
      label: "Osobní sleva",
      expiresAt: new Date("2026-12-31T00:00:00.000Z"),
      createdAt: NOW,
      batch: "vibecoding-2026-06",
      usedAt: null,
      usedByPurchaseId: null,
      ...overrides,
    });
    return db;
  }

  it("returns discount for a valid token", async () => {
    const db = await seed();
    const r = await resolveInviteDiscount(db, "tok-valid", NOW);
    expect(r).toEqual({ percent: 50, token: "tok-valid", label: "Osobní sleva" });
  });

  it("returns null for unknown token", async () => {
    const db = await seed();
    expect(await resolveInviteDiscount(db, "nope", NOW)).toBeNull();
  });

  it("returns null for expired token", async () => {
    const db = await seed({ token: "tok-exp", expiresAt: new Date("2026-01-01T00:00:00.000Z") });
    expect(await resolveInviteDiscount(db, "tok-exp", NOW)).toBeNull();
  });

  it("returns null for already used token", async () => {
    const db = await seed({ token: "tok-used", usedAt: NOW });
    expect(await resolveInviteDiscount(db, "tok-used", NOW)).toBeNull();
  });

  it("treats NULL expiresAt as no expiry", async () => {
    const db = await seed({ token: "tok-forever", expiresAt: null });
    const r = await resolveInviteDiscount(db, "tok-forever", NOW);
    expect(r?.percent).toBe(50);
  });

  it("trims and ignores empty token", async () => {
    const db = await seed();
    expect(await resolveInviteDiscount(db, "   ", NOW)).toBeNull();
    expect(await resolveInviteDiscount(db, null, NOW)).toBeNull();
  });
});

describe("consumeInviteToken", () => {
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM discount_invite");
  });

  it("marks token used once and is idempotent", async () => {
    const db = drizzle(env.DB);
    await db.insert(discountInvite).values({
      token: "tok-c",
      email: "a@b.cz",
      percent: 50,
      createdAt: NOW,
    });

    const first = await consumeInviteToken(db, "tok-c", 555, NOW);
    const second = await consumeInviteToken(db, "tok-c", 999, NOW);

    expect(first).toBe(true);
    expect(second).toBe(false);

    const [row] = await db
      .select()
      .from(discountInvite)
      .where(eq(discountInvite.token, "tok-c"));
    expect(row.usedByPurchaseId).toBe(555);
    expect(row.usedAt).not.toBeNull();
  });
});
