import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { purchase, organization, user } from "./db/schema";
import { sendResendEvent } from "./lib/resend";
import { exportPurchaseInvoice } from "./lib/fakturoid";
import type { Env } from "./types";

interface WebhookMessage {
  type: string;
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
          await handleSubscriptionDeleted(db, data);
          break;

        case "invoice.paid":
          await handleInvoicePaid(db, data);
          break;
      }
      message.ack();
    } catch (err) {
      console.error(`Failed to process ${type}:`, err);
      message.retry();
    }
  }
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
      })
      .onConflictDoNothing();

    // Fire Resend automation event for purchase onboarding sequence
    await sendResendEvent(
      env.RESEND_API_KEY,
      "purchase.completed",
      customerEmail.toLowerCase(),
      { type: "individual" }
    );

    if (paidAmountCzk > 0) {
      await issueFakturoidInvoice(db, env, {
        sessionId,
        email: customerEmail.toLowerCase(),
        type: "individual",
        domain: null,
        amount: paidAmountCzk,
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
      })
      .onConflictDoNothing();

    // Fire Resend automation event for B2B onboarding sequence
    await sendResendEvent(
      env.RESEND_API_KEY,
      "purchase.completed",
      customerEmail.toLowerCase(),
      { type: "organization", domain }
    );

    if (paidAmountCzk > 0) {
      await issueFakturoidInvoice(db, env, {
        sessionId,
        email: customerEmail.toLowerCase(),
        type: "organization",
        domain,
        amount: paidAmountCzk,
      });
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
  env: Env,
  opts: {
    sessionId: string;
    email: string;
    type: "individual" | "organization";
    domain: string | null;
    amount: number;
  },
): Promise<void> {
  try {
    const res = await exportPurchaseInvoice(
      env,
      {
        email: opts.email,
        type: opts.type,
        domain: opts.domain,
        amount: opts.amount,
        variableSymbol: null,
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
      console.error(`[stripe] Fakturoid invoice failed for ${opts.email}:`, res.error);
    }
  } catch (err) {
    console.error(`[stripe] Fakturoid threw for ${opts.email}:`, err);
  }
}

async function handleSubscriptionDeleted(
  db: ReturnType<typeof drizzle>,
  data: Record<string, unknown>
) {
  const subscriptionId = data.id as string;
  if (!subscriptionId) return;

  await db
    .update(organization)
    .set({ status: "expired" })
    .where(eq(organization.stripeSubscriptionId, subscriptionId));

  await db
    .update(purchase)
    .set({ status: "expired" })
    .where(eq(purchase.stripeSubscriptionId, subscriptionId));
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
