import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/d1";
import { nanoid } from "nanoid";
import * as authSchema from "../../src/db/auth-schema";
import * as identitySchema from "../../src/db/identity-schema";
import {
  addUserEmail,
  ensureUserEmailRecord,
  listUserEmails,
  promotePrimary,
  removeUserEmail,
  findUserIdByEmail,
  normalizeEmail,
} from "../../src/lib/user-emails";

async function seedUser(db: ReturnType<typeof drizzle>, email: string) {
  const userId = nanoid();
  await db.insert(authSchema.user).values({
    id: userId,
    email: email.toLowerCase(),
    emailVerified: true,
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  await db.insert(identitySchema.userEmails).values({
    id: nanoid(),
    userId,
    email: email.toLowerCase(),
    verifiedAt: new Date(),
    isPrimary: true,
    addedAt: new Date(),
    addedVia: "signup",
  });
  return userId;
}

describe("user-emails lib", () => {
  let db: ReturnType<typeof drizzle>;

  beforeEach(async () => {
    // Clear tables before each test to ensure isolation.
    // Order matters: child tables (FK references) first.
    await env.DB.exec("DELETE FROM user_emails");
    await env.DB.exec("DELETE FROM session");
    await env.DB.exec("DELETE FROM account");
    await env.DB.exec("DELETE FROM user");
    db = drizzle(env.DB, { schema: { ...authSchema, ...identitySchema } });
  });

  it("normalizeEmail lowercases and trims", () => {
    expect(normalizeEmail("  FOO@Bar.CZ ")).toBe("foo@bar.cz");
  });

  it("adds a secondary email and lists both", async () => {
    const userId = await seedUser(db, "primary@test.cz");
    await addUserEmail(db, { userId, email: "Secondary@test.cz", via: "self-add" });

    const emails = await listUserEmails(db, userId);
    expect(emails.map((e) => e.email).sort()).toEqual([
      "primary@test.cz",
      "secondary@test.cz",
    ]);
    expect(emails.find((e) => e.email === "primary@test.cz")!.isPrimary).toBe(true);
  });

  it("rejects duplicate email", async () => {
    const userId = await seedUser(db, "dup@test.cz");
    await expect(
      addUserEmail(db, { userId, email: "dup@test.cz", via: "self-add" }),
    ).rejects.toThrow(/already/i);
  });

  it("promotes secondary to primary, demotes old", async () => {
    const userId = await seedUser(db, "old@test.cz");
    await addUserEmail(db, { userId, email: "new@test.cz", via: "self-add" });

    await promotePrimary(db, { userId, email: "new@test.cz" });

    const emails = await listUserEmails(db, userId);
    expect(emails.find((e) => e.email === "new@test.cz")!.isPrimary).toBe(true);
    expect(emails.find((e) => e.email === "old@test.cz")!.isPrimary).toBe(false);
  });

  it("refuses to remove the only remaining email", async () => {
    const userId = await seedUser(db, "only@test.cz");
    await expect(
      removeUserEmail(db, { userId, email: "only@test.cz" }),
    ).rejects.toThrow(/only email/i);
  });

  it("refuses to remove primary while secondary exists", async () => {
    const userId = await seedUser(db, "primary@test.cz");
    await addUserEmail(db, { userId, email: "sec@test.cz", via: "self-add" });
    await expect(
      removeUserEmail(db, { userId, email: "primary@test.cz" }),
    ).rejects.toThrow(/primary/i);
  });

  it("findUserIdByEmail matches case-insensitive", async () => {
    const userId = await seedUser(db, "case@test.cz");
    const found = await findUserIdByEmail(db, "CASE@Test.CZ");
    expect(found).toBe(userId);
  });

  it("ensureUserEmailRecord is idempotent", async () => {
    const userId = "u-ensure-test";
    await db.insert(authSchema.user).values({
      id: userId,
      email: "ensure@test.cz",
      emailVerified: true,
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await ensureUserEmailRecord(db, { userId, email: "Ensure@test.cz" });
    await ensureUserEmailRecord(db, { userId, email: "ensure@test.cz" });
    const emails = await listUserEmails(db, userId);
    expect(emails).toHaveLength(1);
    expect(emails[0].isPrimary).toBe(true);
    expect(emails[0].addedVia).toBe("signup");
  });
});
