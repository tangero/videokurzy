import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { purchase, organization, course } from "./db/schema";
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
          await handleCheckoutCompleted(db, data);
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
  data: Record<string, unknown>
) {
  const metadata = data.metadata as Record<string, string> | undefined;
  const customerEmail = data.customer_email as string | undefined;
  const subscriptionId = data.subscription as string | undefined;
  const paymentId = (data.id as string) ?? "";

  if (!metadata?.type) return;

  if (metadata.type === "individual") {
    // Get the first published course
    const [firstCourse] = await db
      .select({ id: course.id })
      .from(course)
      .where(eq(course.published, true))
      .limit(1);

    if (!firstCourse) return;

    // Idempotent insert — UNIQUE constraint on stripePaymentId
    await db
      .insert(purchase)
      .values({
        userId: "", // Will be linked when user signs in with magic link
        courseId: firstCourse.id,
        type: "individual",
        stripePaymentId: paymentId,
        status: "active",
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        createdAt: new Date(),
      })
      .onConflictDoNothing();
  } else if (metadata.type === "organization") {
    const customFields = data.custom_fields as
      | Array<{ key: string; text?: { value: string } }>
      | undefined;
    const domainField = customFields?.find((f) => f.key === "domain");
    const domain = domainField?.text?.value?.toLowerCase().trim();

    if (!domain) return;

    // Idempotent insert
    await db
      .insert(organization)
      .values({
        publicId: nanoid(),
        domain,
        stripeSubscriptionId: subscriptionId ?? "",
        status: "pending", // admin must approve
        createdAt: new Date(),
      })
      .onConflictDoNothing();
  }
}

async function handleSubscriptionDeleted(
  db: ReturnType<typeof drizzle>,
  data: Record<string, unknown>
) {
  const subscriptionId = data.id as string;
  if (!subscriptionId) return;

  // Expire organization
  await db
    .update(organization)
    .set({ status: "expired" })
    .where(eq(organization.stripeSubscriptionId, subscriptionId));

  // Expire individual purchase
  await db
    .update(purchase)
    .set({ status: "expired" })
    .where(eq(purchase.stripePaymentId, subscriptionId));
}

async function handleInvoicePaid(
  db: ReturnType<typeof drizzle>,
  data: Record<string, unknown>
) {
  const subscriptionId = data.subscription as string;
  if (!subscriptionId) return;

  const newExpiry = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

  // Extend purchase expiry
  await db
    .update(purchase)
    .set({ expiresAt: newExpiry, status: "active" })
    .where(eq(purchase.stripePaymentId, subscriptionId));
}
