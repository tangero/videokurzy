import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { nanoid } from "nanoid";
import { user } from "../db/schema";
import { purchase } from "../db/schema";
import { ensureUserEmailRecord, normalizeEmail } from "./user-emails";
import { linkPurchasesToUser } from "./access";

type Db = ReturnType<typeof drizzle>;
type AdminAccess = "free" | "individual" | "organization";

const VALID_ROLES = new Set(["user", "admin"]);
const VALID_ACCESS = new Set<AdminAccess>(["free", "individual", "organization"]);

export async function createAdminUser(
  db: Db,
  opts: { email: string; name?: string; role?: string; access?: string },
): Promise<{ id: string; email: string; name: string | null; role: string }> {
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
      expiresAt: new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000),
      createdAt: now,
    });
  }

  return { id, email, name, role };
}
