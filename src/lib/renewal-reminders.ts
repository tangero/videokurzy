import { and, eq, gt, inArray, lt, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { purchase } from "../db/schema";
import { FIO_RENEWAL_REMINDER_DAYS } from "../config/payment";
import { sendEmail, renewal21Html, renewal14Html, renewal7Html, renewal1Html } from "./email";
import type { Env } from "../types";

const DAY_MS = 86400 * 1000;
const WINDOW_MS = 12 * 3600 * 1000; // ±12h

const TEMPLATE_BY_DAYS: Record<number, (url: string) => string> = {
  21: renewal21Html,
  14: renewal14Html,
  7: renewal7Html,
  1: renewal1Html,
};

/**
 * Najde aktivní FIO purchases, jejichž expiresAt spadá do okna
 * [now + daysLeft - 12h, now + daysLeft + 12h] pro některé z daysLeft hodnot (21,14,7,1).
 * Zahrnuje i časově omezené licence založené adminem (`kind='comp'`), aby po expiraci
 * přešly do stejného obnovovacího režimu jako běžný placený přístup. Staff řádky
 * (`kind='staff'`) — pokud nějaké historické existují — by neměly chodit upomínky,
 * protože admin přístup je dán rolí.
 * Pro každou odešle odpovídající renewal reminder email.
 */
export async function sendRenewalReminders(
  db: ReturnType<typeof drizzle>,
  env: Env,
  now: Date
): Promise<{ sent: number; errors: number }> {
  let sent = 0;
  let errors = 0;

  for (const daysLeft of FIO_RENEWAL_REMINDER_DAYS) {
    const targetTime = now.getTime() + daysLeft * DAY_MS;
    const windowStart = new Date(targetTime - WINDOW_MS);
    const windowEnd = new Date(targetTime + WINDOW_MS);

    const rows = await db
      .select({ id: purchase.id, email: purchase.email })
      .from(purchase)
      .where(
        and(
          eq(purchase.status, "active"),
          or(
            and(
              inArray(purchase.paymentMethod, ["fio", "creditas"]),
              eq(purchase.kind, "paid")
            ),
            eq(purchase.kind, "comp")
          ),
          gt(purchase.expiresAt, windowStart),
          lt(purchase.expiresAt, windowEnd)
        )
      );

    const template = TEMPLATE_BY_DAYS[daysLeft];
    if (!template) continue;

    for (const r of rows) {
      const kvKey = `reminder:${r.id}:${daysLeft}`;
      if (await env.KV.get(kvKey)) continue; // už odesláno, přeskočit

      const renewUrl = `${env.BETTER_AUTH_URL}/checkout/individual`;
      const subject = daysLeft === 1
        ? "Poslední den k prodloužení přístupu ke kurzu"
        : `Váš přístup ke kurzu končí za ${daysLeft} dní`;
      const ok = await sendEmail(env, {
        to: r.email,
        subject,
        html: template(renewUrl),
      });
      if (ok) {
        sent++;
        await env.KV.put(kvKey, "1", { expirationTtl: 2 * 24 * 3600 });
      } else {
        errors++;
      }
    }
  }

  return { sent, errors };
}
