import { drizzle } from "drizzle-orm/d1";
import { and, eq, lt } from "drizzle-orm";
import { purchase } from "./db/schema";
import { sendRenewalReminders } from "./lib/renewal-reminders";
import type { Env } from "./types";

/**
 * Scheduled handler spouštěný Cloudflare Cron Triggerem.
 * Cron registrován v wrangler.toml: `[triggers] crons = ["0 3 * * *"]` (denně 03:00 UTC).
 *
 * Úkoly:
 * 1. Expirace FIO pending objednávek, kterým vypršela splatnost.
 * 2. Renewal reminders pro aktivní FIO předplatné (21/14/7/1 den před expirací).
 */
export async function handleScheduled(
  event: ScheduledEvent,
  env: Env,
  _ctx: ExecutionContext
): Promise<void> {
  const db = drizzle(env.DB);
  const now = new Date();

  try {
    const expiredCount = await expirePendingFioOrders(db, now);
    console.log(`[cron] expired ${expiredCount} pending FIO orders at ${event.scheduledTime}`);
  } catch (err) {
    console.error("[cron] expirePendingFioOrders failed:", err);
  }

  try {
    const { sent, errors } = await sendRenewalReminders(db, env, now);
    console.log(`[cron] renewal reminders: sent=${sent}, errors=${errors}`);
  } catch (err) {
    console.error("[cron] sendRenewalReminders failed:", err);
  }
}

/** Přepne všechny pending FIO objednávky s expiresAt < now na status `expired`. */
async function expirePendingFioOrders(
  db: ReturnType<typeof drizzle>,
  now: Date
): Promise<number> {
  const result = await db
    .update(purchase)
    .set({ status: "expired" })
    .where(
      and(
        eq(purchase.status, "pending"),
        eq(purchase.paymentMethod, "fio"),
        lt(purchase.expiresAt, now)
      )
    )
    .returning({ id: purchase.id });

  return result.length;
}
