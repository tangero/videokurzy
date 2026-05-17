import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { nanoid } from "nanoid";
import { user } from "../db/schema";
import { purchase } from "../db/schema";
import { ensureUserEmailRecord, normalizeEmail } from "./user-emails";
import { linkPurchasesToUser } from "./access";

type Db = ReturnType<typeof drizzle>;
type AdminAccess = "free" | "individual" | "organization";
type CreateAdminUserResult = { id: string; email: string; name: string | null; role: string };

const VALID_ROLES = new Set(["user", "admin"]);
const VALID_ACCESS = new Set<AdminAccess>(["free", "individual", "organization"]);
const DAY_MS = 24 * 60 * 60 * 1000;
export const ADMIN_GRANT_DEFAULT_DAYS = 90;

function defaultAdminGrantExpiresAt(now = new Date()): Date {
  return new Date(now.getTime() + ADMIN_GRANT_DEFAULT_DAYS * DAY_MS);
}

export function defaultAdminGrantExpiresOn(now = new Date()): string {
  return defaultAdminGrantExpiresAt(now).toISOString().slice(0, 10);
}

export function parseAdminGrantExpiresAt(value?: string, now = new Date()): Date {
  const trimmed = value?.trim();
  if (!trimmed) return defaultAdminGrantExpiresAt(now);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    throw new Error("Zadej platné datum konce přístupu.");
  }

  const expiresAt = new Date(`${trimmed}T23:59:59.999Z`);
  if (Number.isNaN(expiresAt.getTime())) {
    throw new Error("Zadej platné datum konce přístupu.");
  }
  return expiresAt;
}

function parsePastedEmails(value: string): string[] {
  const seen = new Set<string>();
  const emails: string[] = [];
  for (const raw of value.split(/[\s,;]+/)) {
    const email = normalizeEmail(raw);
    if (!email || seen.has(email)) continue;
    seen.add(email);
    emails.push(email);
  }
  return emails;
}

export async function createAdminUser(
  db: Db,
  opts: { email: string; name?: string; role?: string; access?: string; expiresAt?: Date },
): Promise<CreateAdminUserResult> {
  const email = normalizeEmail(opts.email);
  const name = opts.name?.trim() || null;
  const role = VALID_ROLES.has(opts.role ?? "") ? opts.role! : "user";
  const access: AdminAccess = VALID_ACCESS.has(opts.access as AdminAccess)
    ? opts.access as AdminAccess
    : "free";

  if (!email || !email.includes("@")) {
    throw new Error("Zadej platný e-mail.");
  }

  const existing = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, email))
    .get();

  if (existing) {
    throw new Error("Uživatel s tímto e-mailem už existuje.");
  }

  const id = nanoid();
  const now = new Date();

  await db.insert(user).values({
    id,
    email,
    name,
    role,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });

  await ensureUserEmailRecord(db, { userId: id, email });
  await linkPurchasesToUser(
    id,
    email,
    db as unknown as Parameters<typeof linkPurchasesToUser>[2],
  );

  if (access !== "free") {
    await db.insert(purchase).values({
      email,
      userId: id,
      type: access,
      paymentMethod: "stripe",
      stripePaymentId: `admin_grant_${nanoid(16)}`,
      status: "active",
      expiresAt: opts.expiresAt ?? defaultAdminGrantExpiresAt(now),
      createdAt: now,
    });
  }

  return { id, email, name, role };
}

export async function createAdminUsers(
  db: Db,
  opts: { emails: string; name?: string; role?: string; access?: string; expiresAt?: Date },
): Promise<{ created: CreateAdminUserResult[]; errors: { email: string; message: string }[] }> {
  const emails = parsePastedEmails(opts.emails);
  if (emails.length === 0) {
    throw new Error("Vlož alespoň jeden platný e-mail.");
  }

  const created: CreateAdminUserResult[] = [];
  const errors: { email: string; message: string }[] = [];
  const sharedName = emails.length === 1 ? opts.name : undefined;

  for (const email of emails) {
    try {
      created.push(await createAdminUser(db, {
        email,
        name: sharedName,
        role: opts.role,
        access: opts.access,
        expiresAt: opts.expiresAt,
      }));
    } catch (err) {
      errors.push({ email, message: (err as Error).message || "Uživatele se nepodařilo založit." });
    }
  }

  return { created, errors };
}
