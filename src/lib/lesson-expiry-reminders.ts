import { and, eq, gt, isNull, lte } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { lesson, lessonPurchase, user } from "../db/schema";
import { LESSON_EXPIRY_REMINDER_DAYS } from "../config/payment";
import { hasAccess } from "./access";
import { formatAccessDate } from "./lesson-access";
import { getPrices } from "./prices";
import { lessonExpiryReminderHtml, sendEmail } from "./email";
import type { Env } from "../types";

const DAY_MS = 86_400_000;

/**
 * Připomínka LESSON_EXPIRY_REMINDER_DAYS dní před koncem přístupu k zakoupenému
 * videu, s důrazem na nabídku ročního předplatného. Běží v denním cronu.
 *
 * Okno je (now, now + 7 dní]: když cron jeden den vynechá, připomínka odejde
 * další den. Nejvýš jednou na nákup přes claim `expiryReminderSentAt`; když
 * odeslání selže, claim se vrátí a zkusí se zítra. Kdo si mezitím koupil
 * předplatné, připomínku nedostane (claim zůstane, ať se to neověřuje denně).
 */
export async function sendLessonExpiryReminders(
  db: ReturnType<typeof drizzle>,
  env: Env,
  now: Date,
): Promise<{ sent: number; skipped: number; errors: number }> {
  let sent = 0;
  let skipped = 0;
  let errors = 0;

  const rows = await db
    .select({
      id: lessonPurchase.id,
      email: lessonPurchase.email,
      userId: lessonPurchase.userId,
      expiresAt: lessonPurchase.expiresAt,
      title: lesson.title,
    })
    .from(lessonPurchase)
    .innerJoin(lesson, eq(lesson.id, lessonPurchase.lessonId))
    .where(
      and(
        eq(lessonPurchase.status, "active"),
        isNull(lessonPurchase.expiryReminderSentAt),
        gt(lessonPurchase.expiresAt, now),
        lte(lessonPurchase.expiresAt, new Date(now.getTime() + LESSON_EXPIRY_REMINDER_DAYS * DAY_MS)),
      ),
    );
  if (rows.length === 0) return { sent, skipped, errors };

  const prices = await getPrices(db);
  for (const r of rows) {
    const claimed = await db
      .update(lessonPurchase)
      .set({ expiryReminderSentAt: now })
      .where(and(eq(lessonPurchase.id, r.id), isNull(lessonPurchase.expiryReminderSentAt)))
      .returning({ id: lessonPurchase.id });
    if (claimed.length === 0) continue;

    // Předplatitel video vidí dál, nabídka předplatného by byla zbytečná.
    const [u] = r.userId
      ? await db.select({ id: user.id, email: user.email, role: user.role }).from(user).where(eq(user.id, r.userId)).limit(1)
      : [];
    const subscriber = await hasAccess(
      { id: u?.id ?? "", email: u?.email ?? r.email, role: u?.role ?? "user" },
      db,
    );
    if (subscriber) {
      skipped++;
      continue;
    }

    const ok = await sendEmail(env, {
      to: r.email,
      subject: "Roční předplatné odemkne všechno – přístup k videu brzy končí",
      html: lessonExpiryReminderHtml({
        lessonTitle: r.title,
        expiresOn: formatAccessDate(r.expiresAt),
        subscribeUrl: `${env.BETTER_AUTH_URL}/checkout/individual`,
        priceIndividual: prices.individual,
      }),
    });
    if (ok) {
      sent++;
    } else {
      errors++;
      await db.update(lessonPurchase).set({ expiryReminderSentAt: null }).where(eq(lessonPurchase.id, r.id));
    }
  }
  return { sent, skipped, errors };
}
