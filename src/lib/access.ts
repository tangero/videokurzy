import { eq, and, gt, or, isNull } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";
import { purchase, organization } from "../db/schema";

type Db = ReturnType<typeof drizzle>;

// KV cache pro výsledek hasAccess(). Klíč per-userId, krátké TTL.
// Cachuje se ZÁMĚRNĚ jen pozitivní výsledek (přístup má):
//  - Negativní výsledek je levný a hlavně NESMÍ uvíznout v cache — uživatel,
//    který právě dokončil platbu, musí přístup dostat okamžitě.
//  - Pozitivní výsledek odebíráme aktivní invalidací (revoke / expirace /
//    subscription.deleted). TTL je pojistka pro případ, že invalidace unikne.
const ACCESS_CACHE_TTL_SECONDS = 300; // 5 min — viz PRD sekce 9
const accessCacheKey = (userId: string) => `access:${userId}`;

/** Smaže cachovaný přístup uživatele. Volat při každém odebrání přístupu. */
export async function invalidateAccessCache(
  kv: KVNamespace,
  userId: string,
): Promise<void> {
  await kv.delete(accessCacheKey(userId));
}

/**
 * Check if user has platform-wide access (any active purchase or org domain).
 * One subscription = access to all courses.
 * Pending purchases (FIO před potvrzením platby) NEDOSTÁVAJÍ access.
 *
 * Admins always have access — bypass paywall pro správu obsahu, testování
 * a reakce na uživatelské problémy.
 *
 * `kv` je volitelné: když je dodané, pozitivní výsledek se cachuje pod
 * `access:{userId}` (TTL 5 min) a ušetří 1–2 D1 dotazy na request. Bez `kv`
 * (testy, okrajové callsites) funguje jako čistý DB lookup.
 */
export async function hasAccess(
  user: { id: string; email: string; role: string },
  db: Db,
  kv?: KVNamespace,
): Promise<boolean> {
  if (user.role === "admin") return true;

  if (kv) {
    const cached = await kv.get(accessCacheKey(user.id));
    if (cached === "1") return true;
  }

  const email = user.email.toLowerCase();
  const userId = user.id;

  const granted = await computeAccess(userId, email, db);

  // Cachuj jen pozitivní výsledek — viz komentář u ACCESS_CACHE_TTL_SECONDS.
  if (kv && granted) {
    await kv.put(accessCacheKey(userId), "1", {
      expirationTtl: ACCESS_CACHE_TTL_SECONDS,
    });
  }

  return granted;
}

async function computeAccess(
  userId: string,
  email: string,
  db: Db,
): Promise<boolean> {
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
  db: Db
): Promise<void> {
  await db
    .update(purchase)
    .set({ userId })
    .where(and(eq(purchase.email, email.toLowerCase()), isNull(purchase.userId)));
}
