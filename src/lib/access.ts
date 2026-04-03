import { eq, and, gt } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { purchase, organization } from "../db/schema";

export async function hasAccess(
  userId: string,
  userEmail: string,
  courseId: number,
  db: DrizzleD1Database
): Promise<boolean> {
  // Check individual purchase
  const activePurchase = await db
    .select({ id: purchase.id })
    .from(purchase)
    .where(
      and(
        eq(purchase.userId, userId),
        eq(purchase.courseId, courseId),
        eq(purchase.status, "active"),
        gt(purchase.expiresAt, new Date())
      )
    )
    .limit(1);

  if (activePurchase.length > 0) return true;

  // Check organization domain license
  const domain = userEmail.split("@")[1];
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
