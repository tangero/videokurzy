import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { purchase, organization, user } from "./db/schema";
import { sendResendEvent } from "./lib/resend";
import { consumeInviteToken } from "./lib/discount";
import { invalidateAccessCache } from "./lib/access";
import { maskEmail } from "./lib/errors";
import { escapeHtml } from "./lib/markdown";
import { exportPurchaseInvoice, type FakturoidEnv } from "./lib/fakturoid";
import { sendEmail } from "./lib/email";
import { ADMIN_EMAILS } from "./config/admin";
import type { Env } from "./types";

type WebhookMessageType =
  | "checkout.session.completed"
  | "customer.subscription.deleted"
  | "invoice.paid";

interface WebhookMessage {
  type: WebhookMessageType;
  data: Record<string, unknown>;
}

export async function handleQueue(
  batch: MessageBatch<WebhookMessage>,
  env: Env
) {
  const db = drizzle(env.DB);

  for (const message of batch.messages) {
    const { type, data } = message.body;

    try {
      switch (type) {
        case "checkout.session.completed":
          await handleCheckoutCompleted(db, data, env);
          break;

        case "customer.subscription.deleted":
          await handleSubscriptionDeleted(db, data, env);
          break;

        case "invoice.paid":
          await handleInvoicePaid(db, data);
          break;

        default:
          console.warn(`[queue] Unknown webhook message type: ${type}`);
          break;
      }
      message.ack();
    } catch (err) {
      console.error(`Failed to process ${type}:`, err);
      message.retry();
    }
  }
}

/**
 * Helper pro vytažení identifikátorů z webhook payloadu pro alert/log.
 * Nikdy nevrací celý e-mail — jen maskovaný (DLQ alert jde do logu i mailu).
 */
function describeWebhook(msg: WebhookMessage): {
  maskedEmail: string;
  stripeId: string;
} {
  const data = msg.data ?? {};
  const email =
    (data.customer_email as string) ??
    ((data.customer_details as Record<string, unknown>)?.email as string) ??
    "";
  const stripeId =
    (data.id as string) ??
    (data.subscription as string) ??
    "?";
  return { maskedEmail: maskEmail(email), stripeId };
}

/**
 * Dead-letter queue konzument. Sem padají webhook zprávy, které 3× selhaly
 * v handleQueue (typicky checkout.session.completed — zákazník ZAPLATIL, ale
 * přístup/faktura nevznikly kvůli výpadku D1/Fakturoidu/Resendu).
 *
 * NEretryuje (to už hlavní queue vyčerpala) — jen zprávu trvale zaloguje
 * a pošle adminovi alert s identifikátory pro ruční dohledání ve Stripe.
 * `message.ack()` vždy, ať zpráva v DLQ neuvízne donekonečna.
 */
export async function handleDlq(
  batch: MessageBatch<WebhookMessage>,
  env: Env
) {
  for (const message of batch.messages) {
    const msg = message.body;
    const { maskedEmail, stripeId } = describeWebhook(msg);

    // Strukturovaný log — i kdyby admin email selhal, stopa zůstane v Logpush.
    console.error(
      JSON.stringify({
        scope: "queue/dlq",
        event: "webhook_permanently_failed",
        type: msg?.type ?? "unknown",
        stripeId,
        maskedEmail,
        attempts: message.attempts,
      })
    );

    try {
      await sendEmail(env, {
        to: [...ADMIN_EMAILS],
        subject: `⚠️ Webhook selhal natrvalo: ${msg?.type ?? "unknown"}`,
        html: dlqAlertHtml(msg?.type ?? "unknown", stripeId, maskedEmail),
      });
    } catch (err) {
      console.error("[queue/dlq] admin alert email failed:", err);
    }

    // DLQ je poslední instance — vždy ack, aby zpráva neretryovala dokola.
    message.ack();
  }
}

function dlqAlertHtml(type: string, stripeId: string, maskedEmail: string): string {
  return `
    <h2>Webhook selhal natrvalo</h2>
    <p>Zpráva 3× selhala ve zpracování a skončila v dead-letter queue. Pokud jde
    o <strong>checkout.session.completed</strong>, zákazník nejspíš zaplatil, ale
    přístup nebo faktura nevznikly — vyžaduje ruční zásah.</p>
    <ul>
      <li><strong>Typ eventu:</strong> ${escapeHtml(type)}</li>
      <li><strong>Stripe ID:</strong> ${escapeHtml(stripeId)}</li>
      <li><strong>Kupující:</strong> ${escapeHtml(maskedEmail)}</li>
    </ul>
    <p>Dohledejte session/subscription ve Stripe Dashboardu podle ID výše
    a doplňte přístup ručně přes /admin.</p>
  `;
}

interface BillingFromMetadata {
  companyName: string | null;
  companyIco: string | null;
  companyDic: string | null;
  companyAddress: string | null;
  companyCity: string | null;
  companyZip: string | null;
  contactName: string | null;
}

function extractBilling(metadata: Record<string, string>): BillingFromMetadata {
  return {
    companyName: metadata.b_name ?? null,
    companyIco: metadata.b_ico ?? null,
    companyDic: metadata.b_dic ?? null,
    companyAddress: metadata.b_addr ?? null,
    companyCity: metadata.b_city ?? null,
    companyZip: metadata.b_zip ?? null,
    contactName: metadata.b_contact ?? null,
  };
}

async function handleCheckoutCompleted(
  db: ReturnType<typeof drizzle>,
  data: Record<string, unknown>,
  env: Env
) {
  const metadata = data.metadata as Record<string, string> | undefined;
  const customerEmail = (data.customer_email as string) ?? (data.customer_details as Record<string, unknown>)?.email as string ?? "";
  const subscriptionId = data.subscription as string | undefined;
  const sessionId = (data.id as string) ?? "";

  if (!metadata?.type || !customerEmail) return;

  const discountPercent = Math.max(0, Math.min(100, parseInt(metadata.discountPercent ?? "0", 10) || 0));
  const discountCode = metadata.discountCode || null;
  const billing = extractBilling(metadata);

  // Pokud uživatel s tímto emailem už existuje (přihlásil se přes magic link
  // dřív, než webhook dorazil), navaž purchase rovnou na jeho userId.
  // Jinak se purchase uloží s userId=null a navazuje se v auth user.create hooku.
  const existingUser = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, customerEmail.toLowerCase()))
    .limit(1);
  const userId = existingUser[0]?.id ?? null;

  // Skutečně zaplacená částka v Kč (Stripe sends cents).
  const amountTotalCents = Number(data.amount_total ?? 0);
  const paidAmountCzk = amountTotalCents > 0 ? Math.round(amountTotalCents / 100) : 0;

  if (metadata.type === "individual") {
    // Idempotent insert — UNIQUE on stripePaymentId
    // Platform-wide access, no courseId needed
    await db
      .insert(purchase)
      .values({
        email: customerEmail.toLowerCase(),
        userId,
        type: "individual",
        stripePaymentId: sessionId,
        stripeSubscriptionId: subscriptionId ?? null,
        status: "active",
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        createdAt: new Date(),
        discountPercent,
        discountCode,
        amountPaid: paidAmountCzk,
        ...billing,
      })
      .onConflictDoNothing();

    // Fire Resend automation event for purchase onboarding sequence
    await sendResendEvent(
      env.RESEND_API_KEY,
      "purchase.completed",
      customerEmail.toLowerCase(),
      { type: "individual", paymentMethod: "stripe" }
    );

    if (paidAmountCzk > 0) {
      await issueFakturoidInvoice(db, env, {
        sessionId,
        email: customerEmail.toLowerCase(),
        type: "individual",
        domain: null,
        amount: paidAmountCzk,
        billing,
      });
    }
  } else if (metadata.type === "organization") {
    const customFields = data.custom_fields as
      | Array<{ key: string; text?: { value: string } }>
      | undefined;
    const domainField = customFields?.find((f) => f.key === "domain");
    const domain = domainField?.text?.value?.toLowerCase().trim();

    if (!domain) return;

    await db
      .insert(organization)
      .values({
        publicId: nanoid(),
        domain,
        stripeSubscriptionId: subscriptionId ?? "",
        status: "pending",
        createdAt: new Date(),
      })
      .onConflictDoNothing();

    // Tracking purchase row pro slot counter a analytics. UNIQUE na stripePaymentId.
    await db
      .insert(purchase)
      .values({
        email: customerEmail.toLowerCase(),
        userId,
        type: "organization",
        stripePaymentId: sessionId,
        stripeSubscriptionId: subscriptionId ?? null,
        status: "active",
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        createdAt: new Date(),
        discountPercent,
        discountCode,
        amountPaid: paidAmountCzk,
        ...billing,
      })
      .onConflictDoNothing();

    // Fire Resend automation event for B2B onboarding sequence
    await sendResendEvent(
      env.RESEND_API_KEY,
      "purchase.completed",
      customerEmail.toLowerCase(),
      { type: "organization", domain, paymentMethod: "stripe" }
    );

    if (paidAmountCzk > 0) {
      await issueFakturoidInvoice(db, env, {
        sessionId,
        email: customerEmail.toLowerCase(),
        type: "organization",
        domain,
        amount: paidAmountCzk,
        billing,
      });
    }
  }

  // Invite token spotřebujeme až po aktivaci nákupu. purchase.id dohledáme podle
  // stripePaymentId (insert je onConflictDoNothing bez returning). Idempotentní —
  // duplicitní webhook token znovu nespálí.
  const inviteToken = metadata.inviteToken;
  if (inviteToken) {
    const [createdPurchase] = await db
      .select({ id: purchase.id })
      .from(purchase)
      .where(eq(purchase.stripePaymentId, sessionId))
      .limit(1);
    if (createdPurchase) {
      await consumeInviteToken(db, inviteToken, createdPurchase.id);
    }
  }
}

/**
 * Best-effort vystavení Fakturoid faktury pro Stripe nákup. Neselhává hlavní
 * webhook, když Fakturoid není dosažitelný — uloží invoice ID zpět do
 * `purchase` (lookup podle stripePaymentId) jakmile odpověď přijde.
 */
async function issueFakturoidInvoice(
  db: ReturnType<typeof drizzle>,
  env: FakturoidEnv,
  opts: {
    sessionId: string;
    email: string;
    type: "individual" | "organization";
    domain: string | null;
    amount: number;
    billing: BillingFromMetadata;
  },
): Promise<void> {
  try {
    const [existing] = await db
      .select({ fakturoidInvoiceId: purchase.fakturoidInvoiceId })
      .from(purchase)
      .where(eq(purchase.stripePaymentId, opts.sessionId))
      .limit(1);

    if (!existing || existing.fakturoidInvoiceId) return;

    const res = await exportPurchaseInvoice(
      env,
      {
        email: opts.email,
        type: opts.type,
        domain: opts.domain,
        amount: opts.amount,
        variableSymbol: null,
        ...opts.billing,
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
        .where(eq(purchase.stripePaymentId, opts.sessionId));
    } else if (!res.ok) {
      console.error(`[stripe] Fakturoid invoice failed for ${maskEmail(opts.email)} (session ${opts.sessionId}):`, res.error);
    }
  } catch (err) {
    console.error(`[stripe] Fakturoid threw for ${maskEmail(opts.email)} (session ${opts.sessionId}):`, err);
  }
}

export const issueFakturoidInvoiceForTest = issueFakturoidInvoice;

async function handleSubscriptionDeleted(
  db: ReturnType<typeof drizzle>,
  data: Record<string, unknown>,
  env: Env
) {
  const subscriptionId = data.id as string;
  if (!subscriptionId) return;

  // Dohledej dotčené uživatele PŘED expirací, ať můžeme invalidovat jejich
  // access cache (jinak by si zachovali přístup až do vypršení 5min TTL).
  const affected = await db
    .select({ userId: purchase.userId })
    .from(purchase)
    .where(eq(purchase.stripeSubscriptionId, subscriptionId));

  await db
    .update(organization)
    .set({ status: "expired" })
    .where(eq(organization.stripeSubscriptionId, subscriptionId));

  await db
    .update(purchase)
    .set({ status: "expired" })
    .where(eq(purchase.stripeSubscriptionId, subscriptionId));

  for (const { userId } of affected) {
    if (userId) await invalidateAccessCache(env.KV, userId);
  }
}

async function handleInvoicePaid(
  db: ReturnType<typeof drizzle>,
  data: Record<string, unknown>
) {
  const subscriptionId = data.subscription as string;
  if (!subscriptionId) return;

  const newExpiry = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

  await db
    .update(purchase)
    .set({ expiresAt: newExpiry, status: "active" })
    .where(eq(purchase.stripeSubscriptionId, subscriptionId));
}
