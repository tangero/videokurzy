import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as authSchema from "../../src/db/auth-schema";
import * as identitySchema from "../../src/db/identity-schema";
import * as appSchema from "../../src/db/schema";
import { createAdminUser } from "../../src/lib/admin-users";

describe("createAdminUser", () => {
  let db: ReturnType<typeof drizzle>;

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
