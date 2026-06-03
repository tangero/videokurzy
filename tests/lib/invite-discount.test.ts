import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { discountInvite } from "../../src/db/schema";
import {
  resolveInviteDiscount,
  consumeInviteToken,
  resolveCheckoutDiscount,
  type DiscountSettings,
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

describe("resolveCheckoutDiscount with invite", () => {
  const offSettings: DiscountSettings = {
    active: false,
    percent: 0,
    limit: 0,
    code: "",
    codeExpiresAt: null,
    label: "",
  };

  beforeEach(async () => {
    await env.DB.exec("DELETE FROM discount_invite");
    await env.DB.exec("DELETE FROM purchase");
  });

  it("applies invite discount even when global discount is off", async () => {
    const db = drizzle(env.DB);
    await db.insert(discountInvite).values({
      token: "inv-1",
      email: "x@y.cz",
      percent: 50,
      label: "Osobní sleva",
      createdAt: NOW,
    });

    const r = await resolveCheckoutDiscount(db, offSettings, null, "inv-1", NOW);
    expect(r).toEqual({ percent: 50, code: "invite:inv-1", source: "invite" });
  });

  it("invite takes precedence over an active global auto discount", async () => {
    const db = drizzle(env.DB);
    await db.insert(discountInvite).values({
      token: "inv-2",
      email: "x@y.cz",
      percent: 50,
      createdAt: NOW,
    });
    const autoSettings: DiscountSettings = {
      active: true,
      percent: 30,
      limit: 100,
      code: "",
      codeExpiresAt: null,
      label: "Zaváděcí",
    };

    const r = await resolveCheckoutDiscount(db, autoSettings, null, "inv-2", NOW);
    expect(r?.source).toBe("invite");
    expect(r?.percent).toBe(50);
  });

  it("falls back to global logic when invite token is invalid", async () => {
    const db = drizzle(env.DB);
    const r = await resolveCheckoutDiscount(db, offSettings, null, "nonexistent", NOW);
    expect(r).toBeNull();
  });
});
