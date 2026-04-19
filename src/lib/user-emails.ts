import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { nanoid } from "nanoid";
import { userEmails } from "../db/identity-schema";

type Db = ReturnType<typeof drizzle>;
type AddVia = "signup" | "self-add" | "recovery" | "admin";

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export async function addUserEmail(
  db: Db,
  opts: { userId: string; email: string; via: AddVia; verified?: boolean },
): Promise<void> {
  const email = normalizeEmail(opts.email);
  const existing = await db
    .select()
    .from(userEmails)
    .where(eq(userEmails.email, email))
    .get();
  if (existing) {
    throw new Error(`Email already registered: ${email}`);
  }
  const now = new Date();
  await db.insert(userEmails).values({
    id: nanoid(),
    userId: opts.userId,
    email,
    verifiedAt: opts.verified === false ? new Date(0) : now,
    isPrimary: false,
    addedAt: now,
    addedVia: opts.via,
  });
}

export async function listUserEmails(db: Db, userId: string) {
  return db
    .select()
    .from(userEmails)
    .where(eq(userEmails.userId, userId))
    .all();
}

export async function findUserIdByEmail(
  db: Db,
  email: string,
): Promise<string | null> {
  const row = await db
    .select()
    .from(userEmails)
    .where(eq(userEmails.email, normalizeEmail(email)))
    .get();
  return row?.userId ?? null;
}

export async function promotePrimary(
  db: Db,
  opts: { userId: string; email: string },
): Promise<void> {
  const email = normalizeEmail(opts.email);
  const target = await db
    .select()
    .from(userEmails)
    .where(and(eq(userEmails.userId, opts.userId), eq(userEmails.email, email)))
    .get();
  if (!target) throw new Error(`Email not found for user: ${email}`);
  if (target.verifiedAt.getTime() === 0) {
    throw new Error(`Cannot promote unverified email: ${email}`);
  }

  await db.batch([
    db
      .update(userEmails)
      .set({ isPrimary: false })
      .where(eq(userEmails.userId, opts.userId)),
    db
      .update(userEmails)
      .set({ isPrimary: true })
      .where(
        and(eq(userEmails.userId, opts.userId), eq(userEmails.email, email)),
      ),
  ]);
}

export async function removeUserEmail(
  db: Db,
  opts: { userId: string; email: string },
): Promise<void> {
  const email = normalizeEmail(opts.email);
  const rows = await listUserEmails(db, opts.userId);
  if (rows.length <= 1) {
    throw new Error("Cannot remove the only email on the account");
  }
  const target = rows.find((r) => r.email === email);
  if (!target) throw new Error(`Email not found: ${email}`);
  if (target.isPrimary) {
    throw new Error(
      "Cannot remove primary email; promote another email first",
    );
  }
  await db
    .delete(userEmails)
    .where(
      and(eq(userEmails.userId, opts.userId), eq(userEmails.email, email)),
    );
}
