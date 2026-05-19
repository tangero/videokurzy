import { drizzle } from "drizzle-orm/d1";
import { and, eq, inArray, lt } from "drizzle-orm";
import { purchase, siteConfig } from "./db/schema";
import { sendRenewalReminders } from "./lib/renewal-reminders";
import { sendPaymentReminders } from "./lib/payment-reminders";
import { fetchFioTransactions, matchPayment } from "./lib/fio";
import { sendEmail, purchaseConfirmedHtml, paymentCancelledHtml } from "./lib/email";
import { applyDiscount } from "./lib/discount";
import { exportPurchaseInvoice } from "./lib/fakturoid";
import {
  ACCESS_DURATION_DAYS,
  FIO_LOOKBACK_DAYS,
  PRICE_INDIVIDUAL,
  PRICE_ORGANIZATION,
} from "./config/payment";
import type { Env } from "./types";

/**
 * Scheduled handler spouštěný Cloudflare Cron Triggerem.
 * Cron registrován v wrangler.toml: `[triggers] crons = ["0 3 * * *"]` (denně 03:00 UTC).
 *
 * Úkoly:
 * 1. Spárování došlých FIO plateb s pending objednávkami.
 * 2. Payment reminders pro nezaplacené pending FIO objednávky (2 a 5 dní po vytvoření).
 * 3. Expirace pending FIO objednávek po splatnosti + storno email.
 * 4. Renewal reminders pro aktivní FIO předplatné (21/14/7/1 den před expirací).
 *
 * Pořadí: scan → reminders → expire — aby se upomínka neposlala objednávce,
 * která byla v témže běhu spárována nebo expirována.
 */
export async function handleScheduled(
  event: ScheduledEvent,
  env: Env,
  _ctx: ExecutionContext
): Promise<void> {
  const db = drizzle(env.DB);
  const now = new Date();

  try {
    const result = await scanFioPayments(db, env);
    console.log(`[cron] FIO scan: matched=${result.matched}, skipped=${result.skipped}`);
  } catch (err) {
    console.error("[cron] scanFioPayments failed:", err);
  }

  try {
    const { sent, errors, skipped } = await sendPaymentReminders(db, env, now);
    if (skipped === -1) {
      console.log("[cron] payment reminders: KILLED via PAYMENT_REMINDERS_ENABLED=false");
    } else {
      console.log(`[cron] payment reminders: sent=${sent}, errors=${errors}, skipped=${skipped}`);
    }
  } catch (err) {
    console.error("[cron] sendPaymentReminders failed:", err);
  }

  try {
    const expiredCount = await expirePendingFioOrders(db, env, now);
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

/**
 * Načte FIO transakce za posledních FIO_LOOKBACK_DAYS, projde pending FIO
 * objednávky a každou se pokusí spárovat. Při shodě nastaví status=active,
 * uloží transactionId, pošle confirmation email.
 *
 * Vrací { matched, skipped }.
 */
export async function scanFioPayments(
  db: ReturnType<typeof drizzle>,
  env: Env,
): Promise<{ matched: number; skipped: number; errors: string[] }> {
  const pending = await db
    .select()
    .from(purchase)
    .where(and(eq(purchase.status, "pending"), eq(purchase.paymentMethod, "fio")));

  if (pending.length === 0) {
    return { matched: 0, skipped: 0, errors: [] };
  }

  const fio = await fetchFioTransactions(env.FIO_API_TOKEN, FIO_LOOKBACK_DAYS);
  if (!fio.ok) {
    return {
      matched: 0,
      skipped: pending.length,
      errors: [`FIO fetch failed: ${fio.status} ${fio.error}`],
    };
  }

  // Načti aktuální ceny z site_config.
  const cfgRows = await db.select().from(siteConfig);
  const cfg = Object.fromEntries(cfgRows.map((r) => [r.key, r.value]));
  const priceIndividual = parseInt(cfg.price_individual ?? String(PRICE_INDIVIDUAL), 10);
  const priceOrganization = parseInt(cfg.price_organization ?? String(PRICE_ORGANIZATION), 10);

  // Aby jeden FIO převod nepárovaly dvě objednávky, držíme set transaction ID,
  // které už byly použité na páry v tomto běhu.
  const used = new Set<number>();
  let matched = 0;
  const errors: string[] = [];

  for (const p of pending) {
    if (!p.variableSymbol) continue;
    const fullExpected = p.type === "organization" ? priceOrganization : priceIndividual;
    const expectedAmount = applyDiscount(fullExpected, p.discountPercent ?? 0);
    const result = matchPayment(fio.transactions, p.variableSymbol, expectedAmount, used);
    if (!result.found || !result.transaction) continue;

    used.add(result.transaction.id);
    const newExpiresAt = new Date(Date.now() + ACCESS_DURATION_DAYS * 86400 * 1000);
    try {
      await db
        .update(purchase)
        .set({
          status: "active",
          expiresAt: newExpiresAt,
          fioTransactionId: String(result.transaction.id),
          amountPaid: result.transaction.amount,
        })
        .where(eq(purchase.id, p.id));

      // Email s magic linkem ke kurzu — nečekáme na něj, ať jeden výpadek
      // Resendu nezablokuje další pářování.
      sendEmail(env, {
        to: p.email,
        subject: "Platba přijata — přihlaste se do kurzu",
        html: purchaseConfirmedHtml(
          `${env.BETTER_AUTH_URL}/login?email=${encodeURIComponent(p.email)}`,
          p.type as "individual" | "organization",
        ),
      }).catch((err) => console.error(`[cron] email send failed for ${p.email}:`, err));

      // Vystavit fakturu ve Fakturoidu. Awaitujeme úmyslně — fire-and-forget by
      // worker po skončení handleru zabil a fakturoidInvoiceId by se neuložil,
      // i když by Fakturoid stihl fakturu vytvořit (orphan invoice).
      const domain = p.type === "organization" ? p.email.split("@")[1] : null;
      try {
        const res = await exportPurchaseInvoice(
          env,
          {
            email: p.email,
            type: p.type as "individual" | "organization",
            domain,
            amount: expectedAmount,
            variableSymbol: p.variableSymbol,
          },
          { sendEmail: true },
        );
        if (res.ok && res.invoiceId) {
          await db
            .update(purchase)
            .set({
              fakturoidInvoiceId: res.invoiceId,
              fakturoidSubjectId: res.subjectId ?? null,
            })
            .where(eq(purchase.id, p.id));
        } else if (!res.ok) {
          console.error(`[cron] Fakturoid for purchase ${p.id} failed:`, res.error);
        }
      } catch (err) {
        console.error(`[cron] Fakturoid for purchase ${p.id} threw:`, err);
      }

      matched++;
    } catch (err) {
      errors.push(`update purchase ${p.id} failed: ${(err as Error).message}`);
    }
  }

  return { matched, skipped: pending.length - matched, errors };
}

/**
 * Přepne všechny pending FIO objednávky s expiresAt < now na status `expired`
 * a každému uživateli pošle storno email s odkazem na novou objednávku.
 * Email se posílá jen reálným objednávkám (`kind='paid'`) — granty by sem
 * stejně neměly přijít, ale filtr je explicitní pro jistotu.
 */
async function expirePendingFioOrders(
  db: ReturnType<typeof drizzle>,
  env: Env,
  now: Date
): Promise<number> {
  // Načti řádky před UPDATEm, abychom měli email + VS pro storno mail.
  const expiring = await db
    .select({
      id: purchase.id,
      email: purchase.email,
      type: purchase.type,
      variableSymbol: purchase.variableSymbol,
    })
    .from(purchase)
    .where(
      and(
        eq(purchase.status, "pending"),
        eq(purchase.paymentMethod, "fio"),
        eq(purchase.kind, "paid"),
        lt(purchase.expiresAt, now)
      )
    );

  if (expiring.length === 0) return 0;

  const ids = expiring.map((r) => r.id);
  await db
    .update(purchase)
    .set({ status: "expired" })
    .where(inArray(purchase.id, ids));

  // Storno emaily — kill switch sdílíme s payment reminders, ať lze obojí vypnout jedním přepínačem.
  const killed = (env as { PAYMENT_REMINDERS_ENABLED?: string }).PAYMENT_REMINDERS_ENABLED === "false";
  if (!killed) {
    for (const r of expiring) {
      if (!r.variableSymbol) continue;
      const reorderUrl = `${env.BETTER_AUTH_URL}/checkout/${r.type === "organization" ? "organization" : "individual"}`;
      sendEmail(env, {
        to: r.email,
        subject: "Vaše objednávka kurzu byla stornována",
        html: paymentCancelledHtml({ reorderUrl, vs: r.variableSymbol }),
      }).catch((err) => console.error(`[cron] cancel email for purchase ${r.id} failed:`, err));
    }
  }

  return expiring.length;
}
