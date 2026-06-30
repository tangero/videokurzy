import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { purchase, organization, user } from "./db/schema";
import { sendResendEvent } from "./lib/resend";
import { consumeInviteToken } from "./lib/discount";
import { reportPurchase } from "./lib/conversions";
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
  | "invoice.paid"
  // Služba „Novinky v Claude Code" (W-003): nově detekovaný / změněný whats-new
  // digest k redakčnímu zpracování (W-004). Nese jen identifikátory, ne obsah.
  | "cc-news.detected"
  // Rozeslání newsletteru daného vydání předplatitelům. Běží NA POZADÍ (fronta),
  // protože odeslání stovek e-mailů přes Resend trvá déle než HTTP request —
  // admin zařadí a hned dostane odpověď, rozeslání doběhne asynchronně.
  | "cc-news.send-newsletter";

interface WebhookMessage {
  type: WebhookMessageType;
  data: Record<string, unknown>;
}

/** Payload zprávy cc-news.detected — jen reference, žádné PII ani obsah. */
export interface CcNewsDetectedData {
  itemId: string;
  sourceId: string;
  /** Ruční admin trigger: vynutit odeslání schvalovacího e-mailu (ne jen dry-run). */
  manualTrigger?: boolean;
  /** Obejít idempotenci (přegenerovat i když approvalEmailSentAt už je). */
  force?: boolean;
}

/** Payload zprávy cc-news.send-newsletter — jen reference vydání. */
export interface CcNewsSendNewsletterData {
  itemId: string;
  /** Obejít zámek newsletterSentAt (vědomé znovurozeslání VŠEM). */
  force?: boolean;
}

/**
 * Zařadí nově detekovaný / změněný whats-new digest do fronty pro navazující
 * redakční zpracování (W-004). Používá stávající WEBHOOK_QUEUE (vzor dle B-003);
 * žádný nový binding ani poskytovatel. Volá se jen pro outcome new/changed.
 * Volitelný `opts` přidá příznaky ručního triggeru (vynucené odeslání e-mailu),
 * který kvůli LLM překladu (desítky sekund) MUSÍ běžet na pozadí, ne v HTTP
 * requestu — jinak ho prohlížeč/CF utne timeoutem.
 */
export async function enqueueCcNewsItem(
  env: Env,
  itemId: string,
  sourceId: string,
  opts: { manualTrigger?: boolean; force?: boolean } = {}
): Promise<void> {
  const data: CcNewsDetectedData = { itemId, sourceId, ...opts };
  await env.WEBHOOK_QUEUE.send({ type: "cc-news.detected", data });
}

/**
 * Zařadí rozeslání newsletteru daného vydání do fronty. Vlastní odeslání
 * (sestavení příjemců + dávkové volání Resend) běží asynchronně v konzumentovi —
 * admin HTTP request se tím neblokuje a může stránku zavřít. Idempotenci drží
 * atomický zámek `newsletterSentAt` UVNITŘ sendCcNewsNewsletterForItem, takže i
 * při retry fronty se newsletter nepošle dvakrát (bez `force`).
 */
export async function enqueueCcNewsSendNewsletter(
  env: Env,
  itemId: string,
  opts: { force?: boolean } = {}
): Promise<void> {
  const data: CcNewsSendNewsletterData = { itemId, ...opts };
  await env.WEBHOOK_QUEUE.send({ type: "cc-news.send-newsletter", data });
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

        case "cc-news.detected":
          // Napojení detekce na redakční pipeline: stáhne detail digestu,
          // vyrobí článek (editor), uloží draft a připraví schvalovací e-mail
          // v dry-run. NIC se neodesílá/nepublikuje — publikace až po lidském
          // schválení (mantinel).
          await handleCcNewsDetected(db, env, data as unknown as CcNewsDetectedData);
          break;

        case "cc-news.send-newsletter":
          // Asynchronní rozeslání newsletteru vydání. Idempotentní přes zámek
          // newsletterSentAt — retry po selhání nepošle duplicitně.
          await handleCcNewsSendNewsletter(db, env, data as unknown as CcNewsSendNewsletterData);
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

// Konverzní signály ze Stripe session metadata (zapsané v checkoutu
// signalsToStripeMetadata) → na purchase, ať je reportPurchase má pro CAPI (R5).
function extractSignals(metadata: Record<string, string>) {
  return {
    marketingConsent: metadata.mkt_consent === "1",
    fbc: metadata.fbc ?? null,
    fbp: metadata.fbp ?? null,
    gclid: metadata.gclid ?? null,
    gbraid: metadata.gbraid ?? null,
    wbraid: metadata.wbraid ?? null,
    clientIp: metadata.cip ?? null,
    userAgent: metadata.cua ?? null,
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
  const signals = extractSignals(metadata);

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
        ...signals,
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
        ...signals,
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

  // purchase.id dohledáme podle stripePaymentId (insert je onConflictDoNothing
  // bez returning). Použijeme ho pro invite token i pro report konverze.
  const [createdPurchase] = await db
    .select({ id: purchase.id })
    .from(purchase)
    .where(eq(purchase.stripePaymentId, sessionId))
    .limit(1);

  // Invite token spotřebujeme až po aktivaci nákupu. Idempotentní —
  // duplicitní webhook token znovu nespálí.
  const inviteToken = metadata.inviteToken;
  if (inviteToken && createdPurchase) {
    await consumeInviteToken(db, inviteToken, createdPurchase.id);
  }

  // Čas konverze pro Stripe = teď (checkout je instantní platba). Uložíme ho na
  // row PŘED reportem a pak reportujeme konverzi. Idempotentní, best-effort.
  if (createdPurchase && paidAmountCzk > 0) {
    const conversionOccurredAt = new Date();
    await db
      .update(purchase)
      .set({ conversionOccurredAt })
      .where(eq(purchase.id, createdPurchase.id));
    await reportPurchase(db, env, createdPurchase.id, {
      valueOverride: paidAmountCzk,
      conversionOccurredAt,
    });
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

/**
 * Konzument zprávy cc-news.detected — napojuje detekci (W-003) na redakční
 * pipeline (W-004/W-005): stáhne `.md` detail digestu, vyrobí článek editorem
 * (deterministicky + volitelně LLM dle CC_NEWS_LLM), uloží draft a připraví
 * schvalovací e-mail v DRY-RUN. NIC se neodesílá ani nepublikuje — publikace
 * nastává až po lidském kliknutí na schvalovací link (mantinel kontraktu).
 */
async function handleCcNewsDetected(
  db: ReturnType<typeof drizzle>,
  env: Env,
  data: CcNewsDetectedData
): Promise<void> {
  // Validace tvaru zprávy: malformovaná zpráva (chybí itemId/sourceId) je
  // NEVRATNÁ — retry by jen opakoval pád. Zalogovat a tiše zahodit (ack v
  // handleQueue), ne retryovat do DLQ.
  if (!data || typeof data.itemId !== "string" || typeof data.sourceId !== "string") {
    console.error(`[queue] cc-news.detected: malformovaná zpráva, zahazuji:`, data);
    return;
  }

  const ref = { itemId: data.itemId, sourceId: data.sourceId };
  const now = new Date();

  // Ruční admin trigger: vynutit odeslání schvalovacího e-mailu (i mimo live
  // brány). Běží TADY na pozadí, protože LLM přepis trvá desítky sekund a v HTTP
  // requestu by ho prohlížeč/CF utnul timeoutem. Konzument fronty má delší limit.
  //
  // ZÁMĚRNĚ NEretryujeme (chybu spolkneme → ack): odeslání schvalovacího e-mailu
  // NENÍ idempotentní napříč pokusy (triggerCcNewsApproval pošle a teprve pak
  // stampne approvalEmailSentAt; force navíc guard obchází). Auto-retry fronty by
  // posílal DUPLICITNÍ e-maily. Selhání se zaloguje; admin pozná z prázdného
  // sloupce „Schvalovací e-mail" v /admin/newsletter, že job neproběhl, a může
  // ho spustit znovu. (Cron cesta níže naopak retry CHCE — je idempotentní.)
  if (data.manualTrigger) {
    try {
      const { triggerCcNewsApproval } = await import("./lib/cc-news/pipeline");
      const result = await triggerCcNewsApproval(db, env, ref, now, undefined, {
        force: data.force === true,
      });
      if ("skipped" in result && result.skipped) {
        console.log(`[queue] cc-news manuální trigger: item=${data.itemId} SKIPPED (už odesláno)`);
      } else {
        console.log(
          `[queue] cc-news manuální trigger: item=${data.itemId} llm=${result.usedLlm} ` +
            `mode=${result.mode} sent=${result.sent}`
        );
      }
    } catch (err) {
      // NEpropagujeme → handleQueue zprávu ack-ne (žádný retry, žádná duplicita).
      console.error(
        `[queue] cc-news manuální trigger SELHAL pro item=${data.itemId} ` +
          `(NEretryuji kvůli riziku duplicitního e-mailu):`,
        (err as Error)?.message,
      );
    }
    return;
  }

  const { processCcNewsItem } = await import("./lib/cc-news/pipeline");
  const result = await processCcNewsItem(db, env, ref, now);
  // mode=live znamená, že schvalovací e-mail reálně odešel (za oběma branami);
  // mode=dry-run = jen připraven a zalogován. Přechodné chyby (fetch/LLM výpadek)
  // nechytáme — ať se zpráva retryuje konzumentem fronty.
  console.log(
    `[queue] cc-news.detected zpracováno: item=${data.itemId} llm=${result.usedLlm} ` +
      `mode=${result.mode} sent=${result.sent}`
  );
}

/**
 * Konzument cc-news.send-newsletter: rozešle newsletter daného vydání na pozadí.
 * Na rozdíl od manuálního triggeru (kde duplicita e-mailu = riziko) TADY chyby
 * PROPAGUJEME → handleQueue zprávu retryuje. Je to bezpečné: atomický zámek
 * `newsletterSentAt` v sendCcNewsNewsletterForItem zaručí, že už rozeslané /
 * běžící vydání se podruhé nepošle (retry dostane `already-sent`). Jednotlivá
 * selhání příjemců se navíc řeší uvnitř sendNewsletter (per-příjemce izolace),
 * takže retry se uplatní jen na chybu sestavení/zámku, ne na dílčí Resend selhání.
 */
async function handleCcNewsSendNewsletter(
  db: ReturnType<typeof drizzle>,
  env: Env,
  data: CcNewsSendNewsletterData
): Promise<void> {
  if (!data || typeof data.itemId !== "string") {
    // Malformovaná zpráva je NEretryovatelná — zaloguj a zahoď (return → ack).
    console.error(`[queue] cc-news.send-newsletter: malformovaná zpráva, zahazuji:`, data);
    return;
  }

  const { sendCcNewsNewsletterForItem } = await import("./lib/cc-news/newsletter");
  const { renderMarkdown } = await import("./lib/markdown");
  const { stripFrontMatter } = await import("./routes/cc-news");
  const { ccNewsNewsletterHtml } = await import("./lib/email");

  const result = await sendCcNewsNewsletterForItem(
    db,
    env,
    data.itemId,
    new Date(),
    renderMarkdown,
    stripFrontMatter,
    ccNewsNewsletterHtml,
    { force: data.force === true },
  );

  if ("skipped" in result && result.skipped) {
    console.log(`[queue] cc-news.send-newsletter: item=${data.itemId} SKIPPED (${result.reason})`);
  } else {
    console.log(
      `[queue] cc-news.send-newsletter: item=${data.itemId} mode=${result.mode} ` +
        `příjemců=${result.recipientCount} odesláno=${result.delivered} selhalo=${result.failed}`
    );
  }
}
