import { drizzle } from "drizzle-orm/d1";
import { and, eq, lt } from "drizzle-orm";
import { purchase } from "./db/schema";
import type { Env } from "./types";

/**
 * Scheduled handler spouštěný Cloudflare Cron Triggerem.
 * Cron registrován v wrangler.toml: `[triggers] crons = ["0 3 * * *"]` (denně 03:00 UTC).
 *
 * Úkoly:
 * 1. Expirace FIO pending objednávek, kterým vypršela splatnost.
 * 2. Renewal reminders pro aktivní FIO předplatné (3/2/1 týden / 1 den před expirací).
 *    (Implementace v Etapě 2 — zatím jen TODO.)
 */
export async function handleScheduled(
  event: ScheduledEvent,
  env: Env,
  _ctx: ExecutionContext
): Promise<void> {
  const db = drizzle(env.DB);
  const now = new Date();

  // ─── 1) Expirace pending FIO objednávek ──────────────────────────
  const expiredCount = await expirePendingFioOrders(db, now);
  console.log(`[cron] Expirated ${expiredCount} pending FIO orders`);

  // ─── 2) Renewal reminders (implementace v Etapě 2) ───────────────
  // TODO(etapa-2): sendRenewalReminders(db, env, now);
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
