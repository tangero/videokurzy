import { drizzle } from "drizzle-orm/d1";
import { eq, and, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import { purchase, organization, user } from "./db/schema";
import { sendResendEvent } from "./lib/resend";
import { getPrices } from "./lib/prices";
import { consumeInviteToken } from "./lib/discount";
import { reportPurchase } from "./lib/conversions";
import { invalidateAccessCache } from "./lib/access";
import { maskEmail } from "./lib/errors";
import { escapeHtml } from "./lib/markdown";
import { createAndEnqueueInvoiceJob } from "./invoice-queue";
import { purchaseToBillingSnapshot } from "./lib/invoicing/jobs";
import { sendEmail, purchaseConfirmedHtml, isConsumerPurchase } from "./lib/email";
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
  | "cc-news.send-newsletter"
  // Dotřídění položek changelogu do témat (Haiku). Bez payloadu; idempotentní.
  | "cc-news.classify"
  // Anglický přehled po schválení české verze → PR do repa webu. Idempotentní.
  | "cc-news.en-weekly"
  // Interní týdenní přehled dalšího sledovaného nástroje (Grok Build). Idempotentní.
  | "tools.week"
  // Kdo koho dohání: kandidáti z pravidel a jejich ověření modelem. Bez payloadu; idempotentní.
  | "cc-news.catchup"
  // Automatické vydání anglického přehledu: sloučí PR do webu, až projde build.
  // Odkládá se (delaySeconds) a znovu zařazuje, dokud kontroly běží.
  | "cc-news.en-merge";

interface WebhookMessage {
  type: WebhookMessageType;
  data: Record<string, unknown>;
  // Stripe event meta — nese se kvůli fakturaci (paidAt z času Stripe události).
  eventId?: string;
  eventCreated?: number;
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

/** Zařadí dotřídění nezatříděných položek changelogu (běží na pozadí, LLM). */
/** Zařadí interní týdenní přehled nástroje (výběr + kontrola faktů, uloží se do KV). */
export async function enqueueToolWeek(env: Env, tool: string, week: { year: number; week: number }): Promise<void> {
  await env.WEBHOOK_QUEUE.send({ type: "tools.week", data: { tool, year: week.year, week: week.week } });
}

/** Zařadí anglický přehled vydání (po schválení české verze). */
export async function enqueueCcNewsEnglish(env: Env, itemId: string, opts: { force?: boolean; rebuildSelection?: boolean } = {}): Promise<void> {
  await env.WEBHOOK_QUEUE.send({ type: "cc-news.en-weekly", data: { itemId, ...opts } });
}

/** První kontrola PR po ~4 minutách (build webu), pak po 5 minutách až ~2 hodiny. */
const EN_MERGE_FIRST_DELAY_S = 240;
const EN_MERGE_DELAY_S = 300;
const EN_MERGE_MAX_ATTEMPTS = 24;

/** Zámek řetězce slučování: jeden běžící řetězec na PR (opakované vydání ho nezdvojí). */
const enMergeLockKey = (itemId: string, number: number) => `cc-news:en-merge:${itemId}:${number}`;
const EN_MERGE_LOCK_TTL_S = 3 * 60 * 60;

/** Zařadí (odložené) sloučení PR anglického přehledu. První pokus jen bez běžícího řetězce. */
export async function enqueueCcNewsEnMerge(env: Env, data: { itemId: string; number: number; attempt: number }): Promise<void> {
  if (data.attempt === 0) {
    const key = enMergeLockKey(data.itemId, data.number);
    if (await env.KV.get(key)) return;
    await env.KV.put(key, "1", { expirationTtl: EN_MERGE_LOCK_TTL_S });
  }
  await env.WEBHOOK_QUEUE.send(
    { type: "cc-news.en-merge", data },
    { delaySeconds: data.attempt === 0 ? EN_MERGE_FIRST_DELAY_S : EN_MERGE_DELAY_S },
  );
}

export async function enqueueCcNewsClassify(env: Env): Promise<void> {
  await env.WEBHOOK_QUEUE.send({ type: "cc-news.classify", data: {} });
}

export async function enqueueCcNewsCatchup(env: Env): Promise<void> {
  await env.WEBHOOK_QUEUE.send({ type: "cc-news.catchup", data: {} });
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
          await handleCheckoutCompleted(db, data, env, message.body.eventCreated);
          break;

        case "customer.subscription.deleted":
          await handleSubscriptionDeleted(db, data, env);
          break;

        case "invoice.paid":
          await handleInvoicePaid(db, data, env);
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

        case "cc-news.classify":
          await handleCcNewsClassify(db, env);
          break;

        case "cc-news.catchup":
          await handleCcNewsCatchup(db, env);
          break;

        case "tools.week": {
          const { isToolKey } = await import("./lib/tools/registry");
          const tool = String(data.tool ?? "");
          if (!isToolKey(tool)) { console.error(`[queue] tools.week: neznámý nástroj ${tool}`); break; }
          const { buildToolWeek } = await import("./lib/tools/weekly-tool");
          const w = await buildToolWeek(db, env, tool, { year: Number(data.year), week: Number(data.week) }, new Date());
          console.log(`[queue] tools.week ${tool} ${w.week.year}-w${w.week.week}: ${w.features.length} novinek z ${w.counts.collected} položek, vyřazeno ${w.dropped.length}`);
          // Automatické vydání: anglický přehled týdne (už vydaný se nepřepíše).
          const { getCcNewsAutopublish } = await import("./lib/cc-news/settings");
          // Jen nástroje s anglickou řadou na webu (TOOLS[].englishWeekly, WEEKLY_TOOLS webu).
          const { TOOLS } = await import("./lib/tools/registry");
          if (w.features.length > 0 && TOOLS[tool].englishWeekly && (await getCcNewsAutopublish(db))) {
            const { toolSelectionId } = await import("./lib/tools/weekly-tool");
            await enqueueCcNewsEnglish(env, toolSelectionId(tool, w.week));
          }
          break;
        }

        case "cc-news.en-merge":
          await handleCcNewsEnMerge(db, env, data as { itemId?: string; number?: number; attempt?: number });
          break;

        case "cc-news.en-weekly":
          await handleCcNewsEnglish(db, env, String(data.itemId ?? ""), data.force === true, data.rebuildSelection === true);
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
  invoiceEmail: string | null;
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
    invoiceEmail: metadata.b_email ?? null,
  };
}

// Konverzní signály ze Stripe session metadata (zapsané v checkoutu
// signalsToStripeMetadata) → na purchase, ať je reportPurchase má pro CAPI (R5).
/**
 * Souhlas se zpřístupněním digitálního obsahu (§ 1837 písm. l) ze Stripe metadat,
 * kam ho zapsal checkout (`ia_consent_at`, unix sekundy). Checkbox je v checkoutu
 * povinný, takže nová session ho má vždy — chybí jen u sessions vytvořených před
 * nasazením a u automatických obnov předplatného, kde Stripe metadata nepřenáší.
 * Tam vracíme false/null: souhlas prokazatelně nemáme, tak si ho nevymýšlíme.
 */
function extractImmediateAccessConsent(metadata: Record<string, string>) {
  const raw = Number(metadata.ia_consent_at);
  if (!Number.isFinite(raw) || raw <= 0) {
    return { immediateAccessConsent: false, immediateAccessConsentAt: null };
  }
  return {
    immediateAccessConsent: true,
    immediateAccessConsentAt: new Date(raw * 1000),
  };
}

/**
 * Odešle onboardingovou automation událost NEJVÝŠE JEDNOU na nákup.
 *
 * Idempotenci drží sloupec `purchase.onboardingEventSentAt` — `sendResendEvent`
 * žádnou nemá a odvozovat ji z toho, zda insert vrátil řádek, je chyba: to
 * zaměňuje „nákup byl vložen" za „událost byla doručena". Když insert projde
 * a odeslání selže, retry už řádek nevloží a onboarding by se neodeslal nikdy.
 *
 * Idempotenci drží ATOMICKÝ CLAIM před odesláním: `UPDATE … WHERE
 * onboardingEventSentAt IS NULL` uspěje právě jednou, takže ani dvě souběžně
 * doručené kopie téhož webhooku událost nepošlou dvakrát. Pouhé přečtení
 * sloupce před odesláním by nestačilo — obě kopie by viděly NULL a obě
 * odeslaly.
 *
 * Když odeslání selže, claim se VRÁTÍ (čas zpět na NULL) a funkce vyhodí
 * chybu, aby `handleQueue` zprávu retryoval. Bez toho by se selhání jen
 * zalogovalo, zpráva by se ackla a onboarding by zmizel — přesně ta ztráta,
 * kterou má sloupec řešit.
 *
 * Zbytkové riziko: crash mezi odesláním a jeho vyhodnocením nechá claim
 * zapsaný a událost se už nepošle. Opačná volba (claim až po odeslání) by
 * naopak riskovala duplicitní onboarding při každém retry; u marketingové
 * sekvence je jednou neodeslaná událost menší zlo než opakované.
 */
async function sendOnboardingEventOnce(
  db: ReturnType<typeof drizzle>,
  env: Env,
  opts: { purchaseId: number; email: string; payload: Record<string, unknown> },
): Promise<void> {
  // Claim: uspěje právě jeden běh. Prázdný výsledek = událost už odeslal
  // (nebo právě odesílá) někdo jiný.
  const claimed = await db
    .update(purchase)
    .set({ onboardingEventSentAt: new Date() })
    .where(
      and(eq(purchase.id, opts.purchaseId), isNull(purchase.onboardingEventSentAt)),
    )
    .returning({ id: purchase.id });
  if (claimed.length === 0) return;

  const outcome = await sendResendEvent(
    env.RESEND_API_KEY,
    "purchase.completed",
    opts.email,
    opts.payload,
  );

  if (outcome === "failed") {
    // Server odmítl → událost prokazatelně nevznikla. Vrať claim, ať ji další
    // pokus doručí, a eskaluj na retry zprávy; jinak by se selhání jen
    // zalogovalo a onboarding by se ztratil.
    await db
      .update(purchase)
      .set({ onboardingEventSentAt: null })
      .where(eq(purchase.id, opts.purchaseId));
    throw new Error(
      `onboarding event failed for purchase ${opts.purchaseId} (${maskEmail(opts.email)})`,
    );
  }

  if (outcome === "unknown") {
    // Timeout / přerušené spojení: událost mohla proběhnout. Claim NEVRACÍME —
    // opakování by znamenalo druhý onboarding, což je horší než jeden možná
    // chybějící. Zůstává v logu k dohledání.
    console.error(
      `[queue] onboarding event outcome unknown for purchase ${opts.purchaseId} (${maskEmail(opts.email)}) — neopakuje se`,
    );
  }
}

/**
 * Odešle potvrzení nákupu a při selhání VYHODÍ chybu, aby ji handleQueue
 * převedl na `message.retry()`.
 *
 * `sendEmail` chybu polyká a vrací false — samotné `await sendEmail(...)` by
 * tedy proběhlo „úspěšně" i při výpadku Resendu, zpráva by se ackla a poučení
 * o odstoupení podle § 1824a by zmizelo nenávratně. Retry je bezpečný: inserty
 * výše jsou `onConflictDoNothing` a fakturační job je idempotentní, takže
 * opakování nevytvoří duplicity. Po 3 pokusech zpráva padne do DLQ, která
 * pošle alert adminovi — poučení se pak dá doručit ručně.
 */
async function sendPurchaseConfirmationOrThrow(
  env: Env,
  opts: { email: string; type: "individual" | "organization"; isConsumer: boolean },
): Promise<void> {
  const ok = await sendEmail(env, {
    to: opts.email,
    subject: "Platba přijata — přihlaste se do kurzu",
    html: await purchaseConfirmedHtml(
      `${env.BETTER_AUTH_URL}/login?email=${encodeURIComponent(opts.email)}`,
      opts.type,
      opts.isConsumer,
      await getPrices(drizzle(env.DB)),
    ),
  });
  if (!ok) {
    throw new Error(
      `purchase confirmation email failed for ${maskEmail(opts.email)} (${opts.type})`,
    );
  }
}

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

/**
 * Založí fakturační outbox úlohu pro Stripe checkout nákup + zařadí do fronty.
 * purchaseId dohledá podle stripePaymentId (insert výše je onConflictDoNothing
 * bez returning). paidAt z času Stripe události; bez něj fallback na teď
 * s confidence='estimated' (job se pak neodešle automaticky).
 */
async function enqueueCheckoutInvoice(
  db: ReturnType<typeof drizzle>,
  env: Env,
  opts: {
    sessionId: string;
    email: string;
    type: "individual" | "organization";
    paidAmountCzk: number;
    billing: BillingFromMetadata;
    eventCreated?: number;
  },
): Promise<void> {
  if (opts.paidAmountCzk <= 0) return;
  const [p] = await db
    .select({ id: purchase.id })
    .from(purchase)
    .where(eq(purchase.stripePaymentId, opts.sessionId))
    .limit(1);
  if (!p) return;

  const hasExact = typeof opts.eventCreated === "number";
  await createAndEnqueueInvoiceJob(db, env, {
    purchaseId: p.id,
    jobKind: "initial_purchase",
    paymentSource: "stripe_checkout",
    sourceEventId: opts.sessionId,
    amount: opts.paidAmountCzk,
    paidAt: hasExact ? new Date(opts.eventCreated! * 1000) : new Date(),
    paidAtSource: "stripe_api",
    paidAtConfidence: hasExact ? "exact" : "estimated",
    billing: { email: opts.email, ...opts.billing },
  });
}

async function handleCheckoutCompleted(
  db: ReturnType<typeof drizzle>,
  data: Record<string, unknown>,
  env: Env,
  eventCreated?: number
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
  const iaConsent = extractImmediateAccessConsent(metadata);

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
    const inserted = await db
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
        ...iaConsent,
      })
      .onConflictDoNothing()
      .returning({ id: purchase.id });

    // Onboardingová sekvence nejvýše jednou na nákup — viz sendOnboardingEventOnce.
    const [b2cRow] = inserted.length > 0
      ? inserted
      : await db
          .select({ id: purchase.id })
          .from(purchase)
          .where(eq(purchase.stripePaymentId, sessionId))
          .limit(1);
    if (b2cRow) {
      await sendOnboardingEventOnce(db, env, {
        purchaseId: b2cRow.id,
        email: customerEmail.toLowerCase(),
        payload: { type: "individual", paymentMethod: "stripe" },
      });
    }

    await enqueueCheckoutInvoice(db, env, {
      sessionId,
      email: customerEmail.toLowerCase(),
      type: "individual",
      paidAmountCzk,
      billing,
      eventCreated,
    });

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
    const insertedOrg = await db
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
        ...iaConsent,
      })
      .onConflictDoNothing()
      .returning({ id: purchase.id });

    // Onboardingová sekvence nejvýše jednou na nákup — viz sendOnboardingEventOnce.
    const [b2bRow] = insertedOrg.length > 0
      ? insertedOrg
      : await db
          .select({ id: purchase.id })
          .from(purchase)
          .where(eq(purchase.stripePaymentId, sessionId))
          .limit(1);
    if (b2bRow) {
      await sendOnboardingEventOnce(db, env, {
        purchaseId: b2bRow.id,
        email: customerEmail.toLowerCase(),
        payload: { type: "organization", domain, paymentMethod: "stripe" },
      });
    }


    await enqueueCheckoutInvoice(db, env, {
      sessionId,
      email: customerEmail.toLowerCase(),
      type: "organization",
      paidAmountCzk,
      billing,
      eventCreated,
    });
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

  // Potvrzení nákupu s poučením o odstoupení posíláme jako POSLEDNÍ krok.
  // Resend automation výše je marketingová sekvence, ne splnění § 1824a —
  // poučení musí odejít z naší šablony, stejně jako u FIO větve. Selhání
  // vyhodí chybu → handleQueue zprávu retryuje, takže se poučení neztratí;
  // všechny předchozí kroky jsou idempotentní, takže je retry bezpečně
  // zopakuje. Poslední v pořadí proto, aby retry kvůli e-mailu nezdržoval
  // aktivaci přístupu ani fakturaci.
  await sendPurchaseConfirmationOrThrow(env, {
    email: customerEmail.toLowerCase(),
    type: metadata.type === "organization" ? "organization" : "individual",
    isConsumer: isConsumerPurchase(billing),
  });
}

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
  data: Record<string, unknown>,
  env: Env
) {
  const subscriptionId = data.subscription as string;
  if (!subscriptionId) return;

  const newExpiry = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

  await db
    .update(purchase)
    .set({ expiresAt: newExpiry, status: "active" })
    .where(eq(purchase.stripeSubscriptionId, subscriptionId));

  // Fakturace JEN pro cyklické obnovení. První platba (subscription_create) se
  // fakturuje přes checkout.session.completed → tady by vznikla duplicita.
  if ((data.billing_reason as string | undefined) !== "subscription_cycle") return;

  const stripeInvoiceId = data.id as string | undefined;
  if (!stripeInvoiceId) return;
  const amountCents = Number(data.amount_paid ?? 0);
  const amount = amountCents > 0 ? Math.round(amountCents / 100) : 0;
  if (amount <= 0) return;

  const paidAtUnix = Number((data.status_transitions as Record<string, unknown> | undefined)?.paid_at);
  const hasPaidAt = Number.isFinite(paidAtUnix) && paidAtUnix > 0;
  // Bez skutečného času platby kotvíme na teď, ale confidence='estimated' →
  // faktura se neodešle automaticky se špatným účetním datem (jde k revizi).
  const paidAt = hasPaidAt ? new Date(paidAtUnix * 1000) : new Date();

  const [p] = await db
    .select({
      id: purchase.id,
      email: purchase.email,
      invoiceEmail: purchase.invoiceEmail,
      companyName: purchase.companyName,
      companyIco: purchase.companyIco,
      companyDic: purchase.companyDic,
      companyAddress: purchase.companyAddress,
      companyCity: purchase.companyCity,
      companyZip: purchase.companyZip,
      contactName: purchase.contactName,
    })
    .from(purchase)
    .where(eq(purchase.stripeSubscriptionId, subscriptionId))
    .limit(1);
  if (!p) return;

  await createAndEnqueueInvoiceJob(db, env, {
    purchaseId: p.id,
    jobKind: "stripe_renewal",
    paymentSource: "stripe_renewal",
    sourceEventId: stripeInvoiceId,
    stripeInvoiceId,
    amount,
    paidAt,
    paidAtSource: "stripe_api",
    paidAtConfidence: hasPaidAt ? "exact" : "estimated",
    billing: purchaseToBillingSnapshot(p),
  });
}

/**
 * Dotřídí dávku nezatříděných položek changelogu. Když po ní něco zbývá a dávka
 * pokročila, zařadí další (bez pokroku nezařazuje — žádná nekonečná smyčka).
 * Chyba LLM se propaguje → retry fronty (třídění je idempotentní).
 */
async function handleCcNewsEnglish(
  db: ReturnType<typeof drizzle>, env: Env, itemId: string, force: boolean, rebuildSelection: boolean,
): Promise<void> {
  const { publishEnglishWeekly, GithubError } = await import("./lib/cc-news/english");
  // Další nástroje (Grok Build): ID týdne místo vydání, výběr z interního přehledu.
  const { parseToolSelectionId } = await import("./lib/tools/weekly-tool");
  const toolWeek = parseToolSelectionId(itemId);
  if (toolWeek && rebuildSelection) {
    const { selectionKvKey } = await import("./lib/cc-news/weekly");
    if (!(await env.KV.get(selectionKvKey(itemId)))) {
      const { buildToolWeek } = await import("./lib/tools/weekly-tool");
      const w = await buildToolWeek(db, env, toolWeek.tool, toolWeek.week, new Date());
      console.log(`[queue] cc-news.en-weekly ${itemId}: výběr doplněn (${w.features.length} novinek, vyřazeno ${w.dropped.length})`);
    }
  }
  // Neexistující vydání (překlep v ID) se opakováním nespraví: zalogovat a potvrdit.
  const { ccNewsItem } = await import("./db/schema");
  const [row] = toolWeek ? [{ id: itemId }] : await db.select({ id: ccNewsItem.id }).from(ccNewsItem).where(eq(ccNewsItem.id, itemId)).limit(1);
  if (!row) {
    console.error(`[queue] cc-news.en-weekly: vydání ${itemId || "(prázdné ID)"} neexistuje, přeskočeno`);
    return;
  }
  if (rebuildSelection && !toolWeek) {
    const { buildChangelogArticle, selectionKvKey } = await import("./lib/cc-news/weekly");
    if (!(await env.KV.get(selectionKvKey(itemId)))) {
      const art = await buildChangelogArticle(db, env, itemId, new Date(), undefined, { selectionOnly: true });
      console.log(`[queue] cc-news.en-weekly ${itemId}: výběr doplněn (${art.review.features.length} novinek, vyřazeno ${art.review.dropped.length})`);
    }
  }
  let out;
  try {
    // force = vědomé přepsání vydaného článku z adminu; pak i nový text.
    out = await publishEnglishWeekly(env, itemId, { force, regenerate: force });
  } catch (err) {
    // Špatný token/repo/oprávnění se opakováním nespraví: zalogovat a zprávu potvrdit.
    if (err instanceof GithubError && err.permanent) {
      console.error(`[queue] cc-news.en-weekly ${itemId}: trvalá chyba GitHubu, neopakuji:`, err.message);
      return;
    }
    throw err;
  }
  if (out.kind === "edited-on-branch") console.log(`[queue] cc-news.en-weekly ${itemId}: ${out.path} na větvi ${out.branch} někdo upravil, nepřepisuji (force přepíše)`);
  else if (out.kind === "already-published") console.log(`[queue] cc-news.en-weekly ${itemId}: ${out.path} už je na webu, nepřepisuji`);
  else if (out.kind === "pr") {
    console.log(`[queue] cc-news.en-weekly ${itemId}: PR ${out.pr.url}${out.pr.created ? "" : " (aktualizován)"}`);
    const { getCcNewsAutopublish } = await import("./lib/cc-news/settings");
    if (out.pr.number && (await getCcNewsAutopublish(db))) {
      await enqueueCcNewsEnMerge(env, { itemId, number: out.pr.number, attempt: 0 });
    }
  }
  else if (out.kind === "no-token") console.warn(`[queue] cc-news.en-weekly ${itemId}: chybí VIBECODING_SITE_GITHUB_TOKEN, ${out.path} nevydán`);
  else console.log(`[queue] cc-news.en-weekly ${itemId}: vydání nemá uložený výběr, přeskočeno`);
}

/**
 * Sloučí PR anglického přehledu, až projde build webu (automatické vydání).
 * Běžící kontroly nejsou chyba: zpráva se znovu odloží (ne retry, ten by skončil
 * v DLQ). Konflikt, zavřený PR nebo vypršení čekání = oznámení adminovi, PR zůstane.
 */
async function handleCcNewsEnMerge(
  db: ReturnType<typeof drizzle>, env: Env, data: { itemId?: string; number?: number; attempt?: number },
): Promise<void> {
  const itemId = String(data.itemId ?? "");
  const number = Number(data.number);
  const attempt = Number(data.attempt ?? 0);
  if (!itemId || !Number.isInteger(number) || number <= 0) {
    console.error("[queue] cc-news.en-merge: malformovaná zpráva, zahazuji:", data);
    return;
  }
  const token = env.VIBECODING_SITE_GITHUB_TOKEN;
  if (!token) { console.warn(`[queue] cc-news.en-merge ${itemId}: chybí VIBECODING_SITE_GITHUB_TOKEN`); return; }
  const { getCcNewsAutopublish, getCcNewsApprovalEmails, isCcNewsLiveSend } = await import("./lib/cc-news/settings");
  if (!(await getCcNewsAutopublish(db))) { console.log(`[queue] cc-news.en-merge ${itemId}: automatické vydávání vypnuto, PR #${number} čeká na ruční sloučení`); return; }

  const { mergeSitePullRequest, englishWeeklyUrls, GithubError } = await import("./lib/cc-news/english");
  const repo = env.VIBECODING_SITE_REPO || "tangero/vibecoding-site";
  const notify = async (subject: string, intro: string, links: { label: string; url: string }[]) => {
    if (!(await isCcNewsLiveSend(db, env))) return;
    const { ccNewsPublishedHtml } = await import("./lib/email");
    await sendEmail({ RESEND_API_KEY: env.RESEND_API_KEY ?? "" },
      { to: await getCcNewsApprovalEmails(db), subject, html: ccNewsPublishedHtml({ intro, links, findings: [] }) })
      .catch((err) => console.error(`[queue] cc-news.en-merge ${itemId}: oznámení selhalo:`, err));
  };
  const done = () => env.KV.delete(enMergeLockKey(itemId, number));
  let out;
  try {
    // Bez čitelných check-runs (oprávnění tokenu) se slučuje až od 3. pokusu (~9 min na build).
    out = await mergeSitePullRequest(token, repo, number, fetch, { allowWithoutChecks: attempt >= 2 });
  } catch (err) {
    if (err instanceof GithubError && err.permanent) {
      console.error(`[queue] cc-news.en-merge ${itemId}: trvalá chyba GitHubu u PR #${number}:`, err.message);
      await notify(`Nevydáno: anglický přehled ${itemId}`, `PR #${number} do webu se nepodařilo sloučit (${err.message.slice(0, 120)}). Sloučte ho ručně.`,
        [{ label: `PR #${number}`, url: `https://github.com/${repo}/pull/${number}` }]);
      await done();
      return;
    }
    throw err;
  }
  if (out.kind === "pending") {
    if (attempt + 1 >= EN_MERGE_MAX_ATTEMPTS) {
      console.error(`[queue] cc-news.en-merge ${itemId}: PR #${number} ani po ${attempt + 1} pokusech není sloučitelný (${out.state})`);
      await notify(`Nevydáno: anglický přehled ${itemId}`, `Build PR #${number} do webu ani po dvou hodinách neprošel (stav ${out.state}). Zkontrolujte ho a sloučte ručně.`,
        [{ label: `PR #${number}`, url: `https://github.com/${repo}/pull/${number}` }]);
      await done();
      return;
    }
    await enqueueCcNewsEnMerge(env, { itemId, number, attempt: attempt + 1 });
    return;
  }
  if (out.kind === "blocked") {
    console.error(`[queue] cc-news.en-merge ${itemId}: PR #${number} nelze sloučit: ${out.reason}`);
    await notify(`Nevydáno: anglický přehled ${itemId}`, `PR #${number} do webu nelze sloučit: ${out.reason}.`, [{ label: `PR #${number}`, url: out.url }]);
    await done();
    return;
  }
  await done();
  console.log(`[queue] cc-news.en-merge ${itemId}: PR #${number} ${out.kind === "merged" ? "sloučen" : "už byl sloučen"}`);
  if (out.kind !== "merged") return;
  const { selectionKvKey } = await import("./lib/cc-news/weekly");
  const sel = await env.KV.get<import("./lib/cc-news/weekly").WeekSelection>(selectionKvKey(itemId), "json");
  const { toolName } = await import("./lib/tools/registry");
  const urls = sel ? englishWeeklyUrls(sel) : null;
  await notify(
    `Vydáno na vibecoding.cz/en: ${sel ? `${toolName(sel.tool)} weekly ${sel.week.year}-W${String(sel.week.week).padStart(2, "0")}` : itemId}`,
    "Anglický týdenní přehled vyšel automaticky (stránka bude dostupná po nasazení webu, do pár minut).",
    [
      ...(urls ? [{ label: "Článek", url: urls.url }, { label: "Upravit v Keystatic", url: urls.editUrl }] : []),
      { label: `PR #${number}`, url: out.url },
    ],
  );
}

async function handleCcNewsClassify(db: ReturnType<typeof drizzle>, env: Env): Promise<void> {
  const { classifyPending, countUnclassified } = await import("./lib/cc-news/classify");
  const done = await classifyPending(db, env, new Date(), 300);
  const left = await countUnclassified(db);
  console.log(`[queue] cc-news.classify: zatříděno ${done}, zbývá ${left}`);
  if (done > 0 && left > 0) await enqueueCcNewsClassify(env);
  // Po dotřídění přepočítat dohánění; chyba zařazení nesmí shodit třídění.
  if (done > 0 && left === 0) await enqueueCcNewsCatchup(env).catch((err) => console.error("[queue] zařazení cc-news.catchup selhalo:", (err as Error)?.message));
}

/** Kandidáti na dohánění z pravidel, ověření modelem a zneplatnění cache stránek. */
async function handleCcNewsCatchup(db: ReturnType<typeof drizzle>, env: Env): Promise<void> {
  const { syncCandidates, verifyPending, catchupCounts, catchupKvKey } = await import("./lib/cc-news/catchup");
  const { isoWeekStart } = await import("./lib/cc-news/trends");
  const now = new Date();
  const fresh = await syncCandidates(db, env.KV, now);
  const checked = await verifyPending(db, env, now, 60);
  await env.KV.delete(catchupKvKey(isoWeekStart(now)));
  const counts = await catchupCounts(db);
  console.log(`[queue] cc-news.catchup: nových kandidátů ${fresh}, ověřeno ${checked}, stav ${JSON.stringify(counts)}`);
  if (checked > 0 && (counts.pending ?? 0) > 0) await enqueueCcNewsCatchup(env);
}

/**
 * Konzument zprávy cc-news.detected — napojuje detekci (W-003) na redakční
 * pipeline (W-004/W-005): stáhne `.md` detail digestu, vyrobí článek editorem
 * (deterministicky + volitelně LLM dle CC_NEWS_LLM), uloží draft a připraví
 * schvalovací e-mail. Týdenní článek ze changelogu se při zapnutém automatickém
 * vydávání (výchozí) rovnou publikuje a zařadí se anglický přehled; jinak
 * publikace nastává po kliknutí na schvalovací link.
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
        if (result.autopublished) await enqueueCcNewsEnglish(env, data.itemId).catch((err) => console.error("[queue] zařazení anglického přehledu selhalo:", err));
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
  // Automaticky vydaný český článek: anglický přehled stejně jako po schválení.
  if (result.autopublished) {
    await enqueueCcNewsEnglish(env, data.itemId).catch((err) => console.error("[queue] zařazení anglického přehledu selhalo:", err));
  }
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
