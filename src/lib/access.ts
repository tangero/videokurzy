import { eq, and, gt, or, isNull } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { purchase, organization } from "../db/schema";

/**
 * Check if user has platform-wide access (any active purchase or org domain).
 * One subscription = access to all courses.
 * Pending purchases (FIO před potvrzením platby) NEDOSTÁVAJÍ access.
 *
 * Admins always have access — bypass paywall pro správu obsahu, testování
 * a reakce na uživatelské problémy.
 */
export async function hasAccess(
  user: { id: string; email: string; role: string },
  db: DrizzleD1Database
): Promise<boolean> {
  if (user.role === "admin") return true;

  const email = user.email.toLowerCase();
  const userId = user.id;

  const activePurchase = await db
    .select({ id: purchase.id })
    .from(purchase)
    .where(
      and(
        eq(purchase.status, "active"),
        gt(purchase.expiresAt, new Date()),
        or(eq(purchase.userId, userId), eq(purchase.email, email))
      )
    )
    .limit(1);

  if (activePurchase.length > 0) return true;

  const domain = email.split("@")[1];
  if (domain) {
    const activeOrg = await db
      .select({ id: organization.id })
      .from(organization)
      .where(
        and(
          eq(organization.domain, domain),
          eq(organization.status, "active")
        )
      )
      .limit(1);

    if (activeOrg.length > 0) return true;
  }

  return false;
}

/**
 * Link unlinked purchases to a user after first login.
 * Pending purchases se taky linkují — až se potvrdí platba, uživatel bude mít userId navázaný.
 */
export async function linkPurchasesToUser(
  userId: string,
  email: string,
  db: DrizzleD1Database
): Promise<void> {
  await db
    .update(purchase)
    .set({ userId })
    .where(and(eq(purchase.email, email.toLowerCase()), isNull(purchase.userId)));
}
