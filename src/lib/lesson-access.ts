// Přístup k jednomu zakoupenému videu (lesson_purchase). Je oddělený od
// hasAccess() v access.ts: nákup videa nesmí nikdy otevřít celou platformu.

import { and, desc, eq, gt, isNull, or } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";
import { lesson, lessonPurchase } from "../db/schema";
import { LESSON_VS_PREFIX } from "../config/payment";

type Db = ReturnType<typeof drizzle>;

const DAY_MS = 86_400_000;

/** VS nákupu videa: "35" + 6 náhodných číslic (stejný tvar jako FIO/Creditas). */
export function generateLessonVariableSymbol(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  const num = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
  return `${LESSON_VS_PREFIX}${100000 + (num % 900000)}`;
}

/** Konec přístupu k videu koupenému v `paidAt`. */
export function lessonAccessExpiry(paidAt: Date, accessDays: number): Date {
  return new Date(paidAt.getTime() + accessDays * DAY_MS);
}

/** „22. 2. 2027" — datum konce přístupu pro zákazníka. */
export function formatAccessDate(d: Date): string {
  return d.toLocaleDateString("cs-CZ", { day: "numeric", month: "numeric", year: "numeric", timeZone: "Europe/Prague" });
}

/**
 * Prodává se video samostatně? Jen s cenou a v Bunny library s ověřením tokenem.
 * Hlavní library (bunnyLibraryId = NULL) ochranu tokenem zapnutou nemá, takže
 * odkaz na přehrávač by kupující mohl rozeslat dál a video by přehrál kdokoli.
 */
export function isLessonForSale(l: { priceCzk: number | null; isFree: boolean; bunnyLibraryId: string | null }): boolean {
  return !l.isFree && (l.priceCzk ?? 0) > 0 && l.bunnyLibraryId !== null;
}

const matchUser = (u: { id: string; email: string }) =>
  or(eq(lessonPurchase.userId, u.id), eq(lessonPurchase.email, u.email.toLowerCase()));

/** Do kdy má uživatel přístup k videu z nákupu; null = nemá. Nejpozdější platný nákup. */
export async function lessonAccessUntil(
  db: Db,
  u: { id: string; email: string },
  lessonId: number,
  now = new Date(),
): Promise<Date | null> {
  const [row] = await db
    .select({ expiresAt: lessonPurchase.expiresAt })
    .from(lessonPurchase)
    .where(
      and(
        eq(lessonPurchase.lessonId, lessonId),
        eq(lessonPurchase.status, "active"),
        gt(lessonPurchase.expiresAt, now),
        matchUser(u),
      ),
    )
    .orderBy(desc(lessonPurchase.expiresAt))
    .limit(1);
  return row?.expiresAt ?? null;
}

export interface PurchasedLesson {
  lessonId: number;
  slug: string;
  title: string;
  expiresAt: Date;
}

/** Platné nákupy videí uživatele (pro dashboard), jedno video jednou. */
export async function listPurchasedLessons(
  db: Db,
  u: { id: string; email: string },
  now = new Date(),
): Promise<PurchasedLesson[]> {
  const rows = await db
    .select({
      lessonId: lessonPurchase.lessonId,
      slug: lesson.slug,
      title: lesson.title,
      expiresAt: lessonPurchase.expiresAt,
    })
    .from(lessonPurchase)
    .innerJoin(lesson, eq(lesson.id, lessonPurchase.lessonId))
    .where(and(eq(lessonPurchase.status, "active"), gt(lessonPurchase.expiresAt, now), matchUser(u)))
    .orderBy(desc(lessonPurchase.expiresAt));
  const seen = new Set<number>();
  return rows.filter((r) => !seen.has(r.lessonId) && seen.add(r.lessonId));
}

/** Naváže nákupy videí na účet po přihlášení (obdoba linkPurchasesToUser). */
export async function linkLessonPurchasesToUser(db: Db, userId: string, email: string): Promise<void> {
  await db
    .update(lessonPurchase)
    .set({ userId })
    .where(and(eq(lessonPurchase.email, email.toLowerCase()), isNull(lessonPurchase.userId)));
}

/** id nákupů videí patřících uživateli (GDPR výmaz). */
export async function lessonPurchaseIdsFor(db: Db, userId: string, emailLc: string): Promise<number[]> {
  const rows = await db
    .select({ id: lessonPurchase.id })
    .from(lessonPurchase)
    .where(or(eq(lessonPurchase.userId, userId), eq(lessonPurchase.email, emailLc)))
    .all();
  return rows.map((r) => r.id);
}
