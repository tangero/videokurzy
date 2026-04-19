import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { nanoid } from "nanoid";
import { userEmails } from "../db/identity-schema";

type Db = ReturnType<typeof drizzle>;
type AddVia = "signup" | "self-add" | "recovery" | "admin";

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Add a new email to the user. Default is verified = true (email was
 * confirmed via magic link before calling this). Pass `verified: false` to
 * mark as unverified (e.g., if admin adds an email on behalf of a user
 * before they confirm ownership).
 *
 * **Unverified sentinel:** we use `verifiedAt: new Date(0)` (Unix epoch) to
 * represent "not yet verified" because the `verifiedAt` column is NOT NULL.
 * If this pattern becomes unwieldy, consider migrating to nullable
 * `verifiedAt` or adding a separate `verified: boolean` column (see
 * code-review follow-up in docs/gotchas.md).
 *
 * Throws if the email is already registered (to any user — global unique).
 */
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
    if (existing.userId === opts.userId) {
      throw new Error("Tento e-mail už na účtu máte.");
    }
    // Different user — don't leak existence; use generic message.
    throw new Error("E-mail nelze přidat.");
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

/**
 * Atomically make `email` the user's primary — demotes all other emails
 * and promotes target. Uses `db.batch()` for atomicity. Rejects if email
 * is not verified.
 *
 * DB-level safeguard: partial unique index
 * `user_emails_one_primary_per_user` (migration 0005) enforces the
 * invariant even against concurrent writes.
 */
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

/**
 * Idempotently seed a user_emails row with `isPrimary=true` for the given
 * user. Used by Better Auth user.create hook so that every new user gets
 * their login email recorded in user_emails immediately.
 */
export async function ensureUserEmailRecord(
  db: Db,
  opts: { userId: string; email: string },
): Promise<void> {
  const email = normalizeEmail(opts.email);
  const existing = await db
    .select()
    .from(userEmails)
    .where(eq(userEmails.email, email))
    .get();
  if (existing) return;
  const now = new Date();
  try {
    await db.insert(userEmails).values({
      id: nanoid(),
      userId: opts.userId,
      email,
      verifiedAt: now,
      isPrimary: true,
      addedAt: now,
      addedVia: "signup",
    });
  } catch (err) {
    // Concurrent insert (another login race). DB UNIQUE on email guarantees
    // exactly one row survives; treat failure as success if a row now exists.
    const msg = String((err as Error)?.message ?? err);
    if (msg.includes("UNIQUE") || msg.includes("constraint")) {
      const nowExists = await db
        .select()
        .from(userEmails)
        .where(eq(userEmails.email, email))
        .get();
      if (nowExists) return;
    }
    throw err;
  }
}

/**
 * Remove a secondary email from the account. Rejects if it's the only email
 * on the account, or if it's the primary (promote another first).
 */
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
