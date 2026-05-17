import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as authSchema from "../../src/db/auth-schema";
import * as identitySchema from "../../src/db/identity-schema";
import * as appSchema from "../../src/db/schema";
import { createAdminUser, createAdminUsers } from "../../src/lib/admin-users";

describe("createAdminUser", () => {
  let db: ReturnType<typeof drizzle>;

  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(async () => {
    await env.DB.exec("DELETE FROM user_emails");
    await env.DB.exec("DELETE FROM purchase");
    await env.DB.exec("DELETE FROM session");
    await env.DB.exec("DELETE FROM account");
    await env.DB.exec("DELETE FROM user");
    db = drizzle(env.DB, { schema: { ...authSchema, ...identitySchema, ...appSchema } });
  });

  it("creates a verified user with primary email record and paid admin grant", async () => {
    const created = await createAdminUser(db, {
      email: "  New.User@Example.cz ",
      name: "Nový Uživatel",
      role: "admin",
      access: "individual",
    });

    expect(created.email).toBe("new.user@example.cz");
    expect(created.role).toBe("admin");

    const userRow = await db
      .select()
      .from(authSchema.user)
      .where(eq(authSchema.user.id, created.id))
      .get();
    expect(userRow?.emailVerified).toBe(true);

    const emailRow = await db
      .select()
      .from(identitySchema.userEmails)
      .where(eq(identitySchema.userEmails.userId, created.id))
      .get();
    expect(emailRow?.email).toBe("new.user@example.cz");
    expect(emailRow?.isPrimary).toBe(true);

    const purchaseRow = await db
      .select()
      .from(appSchema.purchase)
      .where(eq(appSchema.purchase.userId, created.id))
      .get();
    expect(purchaseRow?.type).toBe("individual");
    expect(purchaseRow?.paymentMethod).toBe("stripe");
    expect(purchaseRow?.status).toBe("active");
    expect(purchaseRow?.stripePaymentId).toMatch(/^admin_grant_/);
  });

  it("uses a 90 day default expiry for paid admin grants", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-17T08:00:00.000Z"));

    const created = await createAdminUser(db, {
      email: "trial@example.cz",
      access: "individual",
    });

    const purchaseRow = await db
      .select()
      .from(appSchema.purchase)
      .where(eq(appSchema.purchase.userId, created.id))
      .get();
    expect(purchaseRow?.expiresAt.toISOString()).toBe("2026-08-15T08:00:00.000Z");
  });

  it("stores an explicit access expiry for paid admin grants", async () => {
    const created = await createAdminUser(db, {
      email: "expires@example.cz",
      access: "organization",
      expiresAt: new Date("2026-09-30T23:59:59.000Z"),
    });

    const purchaseRow = await db
      .select()
      .from(appSchema.purchase)
      .where(eq(appSchema.purchase.userId, created.id))
      .get();
    expect(purchaseRow?.type).toBe("organization");
    expect(purchaseRow?.expiresAt.toISOString()).toBe("2026-09-30T23:59:59.000Z");
  });

  it("creates multiple users from pasted emails with shared settings", async () => {
    const result = await createAdminUsers(db, {
      emails: "alpha@example.cz\nbeta@example.cz, alpha@example.cz",
      role: "user",
      access: "individual",
      expiresAt: new Date("2026-10-01T23:59:59.000Z"),
    });

    expect(result.created.map((u) => u.email)).toEqual([
      "alpha@example.cz",
      "beta@example.cz",
    ]);
    expect(result.errors).toEqual([]);

    const purchases = await db
      .select()
      .from(appSchema.purchase);
    expect(purchases).toHaveLength(2);
    expect(purchases.every((p) => p.expiresAt.toISOString() === "2026-10-01T23:59:59.000Z")).toBe(true);
  });

  it("rejects duplicate users and links existing purchases", async () => {
    await db.insert(appSchema.purchase).values({
      email: "buyer@example.cz",
      type: "individual",
      paymentMethod: "stripe",
      stripePaymentId: "pi_admin_user_test",
      status: "active",
      expiresAt: new Date(Date.now() + 86_400_000),
      createdAt: new Date(),
    });

    const created = await createAdminUser(db, { email: "buyer@example.cz" });

    const purchaseRow = await db
      .select()
      .from(appSchema.purchase)
      .where(eq(appSchema.purchase.email, "buyer@example.cz"))
      .get();
    expect(purchaseRow?.userId).toBe(created.id);

    await expect(
      createAdminUser(db, { email: "buyer@example.cz" }),
    ).rejects.toThrow(/už existuje/i);
  });
});
