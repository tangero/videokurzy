import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as authSchema from "../../src/db/auth-schema";
import * as identitySchema from "../../src/db/identity-schema";
import * as appSchema from "../../src/db/schema";
import { createAdminUser, createAdminUsers, listAdminUsers } from "../../src/lib/admin-users";

describe("createAdminUser", () => {
  let db: ReturnType<typeof drizzle>;

  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(async () => {
    await env.DB.exec("DELETE FROM user_emails");
    await env.DB.exec("DELETE FROM lesson_watch");
    await env.DB.exec("DELETE FROM lesson");
    await env.DB.exec("DELETE FROM module");
    await env.DB.exec("DELETE FROM course");
    await env.DB.exec("DELETE FROM purchase");
    await env.DB.exec("DELETE FROM session");
    await env.DB.exec("DELETE FROM account");
    await env.DB.exec("DELETE FROM user");
    db = drizzle(env.DB, { schema: { ...authSchema, ...identitySchema, ...appSchema } });
  });

  it("creates a verified user with primary email record and a comp purchase", async () => {
    const created = await createAdminUser(db, {
      email: "  New.User@Example.cz ",
      name: "Nový Uživatel",
      role: "user",
      access: "individual",
      grantedBy: "patrick@vibecoding.cz",
      compReason: "Recenze",
    });

    expect(created.email).toBe("new.user@example.cz");
    expect(created.role).toBe("user");

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
    expect(purchaseRow?.status).toBe("active");
    expect(purchaseRow?.kind).toBe("comp");
    expect(purchaseRow?.grantedBy).toBe("patrick@vibecoding.cz");
    expect(purchaseRow?.compReason).toBe("Recenze");
    // Granty nepoužívají Stripe namespace — nezamořují stripePaymentId UNIQUE index.
    expect(purchaseRow?.stripePaymentId).toBeNull();
  });

  it("skips purchase creation for admin role (access is granted via user.role)", async () => {
    const created = await createAdminUser(db, {
      email: "boss@example.cz",
      role: "admin",
      access: "individual",
    });

    expect(created.role).toBe("admin");

    const purchases = await db
      .select()
      .from(appSchema.purchase)
      .where(eq(appSchema.purchase.userId, created.id));
    expect(purchases).toEqual([]);
  });

  it("uses a 90 day default expiry for comp grants", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-17T08:00:00.000Z"));

    const created = await createAdminUser(db, {
      email: "trial@example.cz",
      role: "user",
      access: "individual",
    });

    const purchaseRow = await db
      .select()
      .from(appSchema.purchase)
      .where(eq(appSchema.purchase.userId, created.id))
      .get();
    expect(purchaseRow?.expiresAt.toISOString()).toBe("2026-08-15T08:00:00.000Z");
  });

  it("stores an explicit access expiry for comp grants", async () => {
    const created = await createAdminUser(db, {
      email: "expires@example.cz",
      role: "user",
      access: "organization",
      expiresAt: new Date("2026-09-30T23:59:59.000Z"),
    });

    const purchaseRow = await db
      .select()
      .from(appSchema.purchase)
      .where(eq(appSchema.purchase.userId, created.id))
      .get();
    expect(purchaseRow?.type).toBe("organization");
    expect(purchaseRow?.kind).toBe("comp");
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

  it("normalizes aggregated lesson_watch timestamps in the user list", async () => {
    const created = await createAdminUser(db, { email: "watcher@example.cz" });
    const [course] = await db
      .insert(appSchema.course)
      .values({
        title: "Kurz",
        slug: "kurz",
        description: "",
        published: true,
      })
      .returning({ id: appSchema.course.id });
    const [module] = await db
      .insert(appSchema.module)
      .values({
        courseId: course.id,
        title: "Modul",
        slug: "modul",
        sortOrder: 1,
      })
      .returning({ id: appSchema.module.id });
    const [lesson] = await db
      .insert(appSchema.lesson)
      .values({
        moduleId: module.id,
        publicId: "lesson-admin-users-watch",
        title: "Lekce",
        slug: "lekce",
        sortOrder: 1,
      })
      .returning({ id: appSchema.lesson.id });
    await db.insert(appSchema.lessonWatch).values({
      userId: created.id,
      lessonId: lesson.id,
      maxSegment: 2,
      watchedSeconds: 120,
      startedAt: new Date("2026-05-31T06:00:00.000Z"),
      updatedAt: new Date("2026-05-31T06:53:03.000Z"),
    });

    const result = await listAdminUsers(db, { search: "watcher@example.cz" });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].lastActivityAt).toBeInstanceOf(Date);
    expect(result.rows[0].lastActivityAt?.toISOString()).toBe("2026-05-31T06:53:03.000Z");
  });
});
