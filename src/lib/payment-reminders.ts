import { and, eq, gt, inArray, lt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { purchase, siteConfig } from "../db/schema";
import {
  FIO_PAYMENT_REMINDER_DAYS,
  PAYMENT_ACCOUNT,
  PAYMENT_IBAN,
  CREDITAS_PAYMENT_ACCOUNT,
  CREDITAS_PAYMENT_IBAN,
  PRICE_INDIVIDUAL,
  PRICE_ORGANIZATION,
} from "../config/payment";
import { generateSPD } from "./fio";
import { applyDiscount } from "./discount";
import {
  sendEmail,
  paymentReminder2dHtml,
  paymentReminder5dHtml,
  type PaymentReminderOpts,
} from "./email";
import type { Env } from "../types";

const DAY_MS = 86400 * 1000;
const WINDOW_MS = 12 * 3600 * 1000; // ±12h kolem targetu — pokrývá různé timing běhu cronu

type Db = ReturnType<typeof drizzle>;

const TEMPLATE_BY_DAYS: Record<number, (opts: PaymentReminderOpts) => string> = {
  2: paymentReminder2dHtml,
  5: paymentReminder5dHtml,
};

function formatDueDate(d: Date): string {
  return `${d.getDate()}. ${d.getMonth() + 1}. ${d.getFullYear()}`;
}

/**
 * Pošle upomínky platby pro pending FIO objednávky stáří 2 a 5 dní.
 *
 * Filtr:
 *   - status = 'pending'
 *   - paymentMethod = 'fio'           (Stripe je okamžitý, upomínka nemá smysl)
 *   - kind = 'paid'                   (granty nejsou reálné objednávky)
 *   - createdAt v okně [target ± 12h]
 *
 * Dedup přes KV pod klíčem `payment-reminder:<id>:<day>`.
 * Kill switch: `env.PAYMENT_REMINDERS_ENABLED === "false"` → nic se nepošle.
 */
export async function sendPaymentReminders(
  db: Db,
  env: Env,
  now: Date,
): Promise<{ sent: number; errors: number; skipped: number }> {
  if ((env as { PAYMENT_REMINDERS_ENABLED?: string }).PAYMENT_REMINDERS_ENABLED === "false") {
    return { sent: 0, errors: 0, skipped: -1 }; // -1 = kill switch active (pro log diagnostiku)
  }

  // Aktuální ceny z site_config — historické změny v ceně se promítnou jen
  // v částce v upomínce, což je akceptovatelné (upomínka nepřepočítává sumu
  // k zaplacení, jen ji opakuje vůči aktuálnímu ceníku).
  const cfgRows = await db.select().from(siteConfig);
  const cfg = Object.fromEntries(cfgRows.map((r) => [r.key, r.value]));
  const priceIndividual = parseInt(cfg.price_individual ?? String(PRICE_INDIVIDUAL), 10);
  const priceOrganization = parseInt(cfg.price_organization ?? String(PRICE_ORGANIZATION), 10);

  let sent = 0;
  let errors = 0;
  let skipped = 0;

  for (const daysOld of FIO_PAYMENT_REMINDER_DAYS) {
    const targetTime = now.getTime() - daysOld * DAY_MS;
    const windowStart = new Date(targetTime - WINDOW_MS);
    const windowEnd = new Date(targetTime + WINDOW_MS);

    const rows = await db
      .select({
        id: purchase.id,
        email: purchase.email,
        type: purchase.type,
        paymentMethod: purchase.paymentMethod,
        variableSymbol: purchase.variableSymbol,
        accessToken: purchase.accessToken,
        discountPercent: purchase.discountPercent,
        expiresAt: purchase.expiresAt,
      })
      .from(purchase)
      .where(
        and(
          eq(purchase.status, "pending"),
          inArray(purchase.paymentMethod, ["fio", "creditas"]),
          eq(purchase.kind, "paid"),
          gt(purchase.createdAt, windowStart),
          lt(purchase.createdAt, windowEnd),
        ),
      );

    const template = TEMPLATE_BY_DAYS[daysOld];
    if (!template) continue;

    for (const r of rows) {
      if (!r.variableSymbol) {
        // Pending bez VS je chybový stav — uživatel nemá jak zaplatit, takže
        // upomínka by ho jen zmátla. Logujeme přes skipped, ne errors.
        skipped++;
        continue;
      }

      const kvKey = `payment-reminder:${r.id}:${daysOld}`;
      if (await env.KV.get(kvKey)) {
        skipped++;
        continue;
      }

      const fullPrice = r.type === "organization" ? priceOrganization : priceIndividual;
      const amount = applyDiscount(fullPrice, r.discountPercent ?? 0);
      // Bankovní údaje podle banky, na kterou byla objednávka vystavena.
      const iban = r.paymentMethod === "creditas" ? CREDITAS_PAYMENT_IBAN : PAYMENT_IBAN;
      const accountNumber = r.paymentMethod === "creditas" ? CREDITAS_PAYMENT_ACCOUNT : PAYMENT_ACCOUNT;
      const spd = generateSPD(iban, amount, r.variableSymbol, `Videokurz ${r.email}`);
      // Preferuj nehádatelný token; na VS spadni jen u starých objednávek bez tokenu.
      const payUrl = `${env.BETTER_AUTH_URL}/checkout/pay/${r.accessToken ?? r.variableSymbol}`;
      const cardUrl = `${env.BETTER_AUTH_URL}/checkout/${r.type === "organization" ? "organization" : "individual"}`;
      const dueDate = formatDueDate(r.expiresAt);

      const subject = daysOld === 5
        ? "Platba kurzu — splatnost končí za 2 dny"
        : "Připomínáme platbu kurzu";

      const ok = await sendEmail(env, {
        to: r.email,
        subject,
        html: template({
          vs: r.variableSymbol,
          amount,
          accountNumber,
          dueDate,
          spd,
          payUrl,
          cardUrl,
        }),
      });

      if (ok) {
        sent++;
        // KV TTL 14 dní — dlouho po auto-stornu (7d), takže dedup drží i pokud
        // cron mezi tím poběží vícekrát kvůli ad-hoc trigger.
        await env.KV.put(kvKey, "1", { expirationTtl: 14 * 24 * 3600 });
      } else {
        errors++;
      }
    }
  }

  return { sent, errors, skipped };
}
