import { eq, and, gt, or } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { purchase, organization } from "../db/schema";

export async function hasAccess(
  userId: string,
  userEmail: string,
  courseId: number,
  db: DrizzleD1Database
): Promise<boolean> {
  const email = userEmail.toLowerCase();

  // Check individual purchase (by userId or email)
  const activePurchase = await db
    .select({ id: purchase.id })
    .from(purchase)
    .where(
      and(
        eq(purchase.courseId, courseId),
        eq(purchase.status, "active"),
        gt(purchase.expiresAt, new Date()),
        or(eq(purchase.userId, userId), eq(purchase.email, email))
      )
    )
    .limit(1);

  if (activePurchase.length > 0) return true;

  // Check organization domain license
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
 * Called after successful magic link auth.
 */
export async function linkPurchasesToUser(
  userId: string,
  email: string,
  db: DrizzleD1Database
): Promise<void> {
  await db
    .update(purchase)
    .set({ userId })
    .where(and(eq(purchase.email, email.toLowerCase()), eq(purchase.userId, "")));
}
