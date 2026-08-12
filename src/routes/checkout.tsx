import { Hono } from "hono";
import type { Context } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { and, eq, gt, inArray } from "drizzle-orm";
import Stripe from "stripe";
import { nanoid } from "nanoid";
import type { Env, Variables } from "../types";
import { purchase, organization, siteConfig } from "../db/schema";
import { reportPurchase, bankDateToConversionInstant, captureSignals, type ConversionSignals } from "../lib/conversions";
import { sklikConversionSnippetFor } from "../lib/analytics-snippet";
import { lookupByIco, lookupByName } from "../lib/ares";
import { generateProformaHtml } from "../lib/proforma";
import { nextProformaNumber } from "../lib/proforma-sequence";
import {
  PRICE_INDIVIDUAL,
  PRICE_ORGANIZATION,
  FIO_DEFAULT_DUE_DAYS,
  FIO_EXTENDED_DUE_DAYS,
  FIO_RATE_LIMIT_MS,
  FIO_LOOKBACK_DAYS,
  ACCESS_DURATION_DAYS,
  SUPPLIER,
  DEFAULT_ACTIVE_BANK,
  bankDetails,
  type TransferBank,
} from "../config/payment";
import { isFreemailDomain, FREEMAIL_REJECTION_MESSAGE } from "../config/freemail-domains";
import { ADMIN_EMAILS } from "../config/admin";
import {
  generateVariableSymbol,
  generateSPD,
  fetchFioTransactions,
  fioProxyFromEnv,
  matchPayment,
} from "../lib/fio";
import {
  generateCreditasVariableSymbol,
  fetchCreditasTransactions,
  matchCreditasPayment,
} from "../lib/creditas";
import {
  applyDiscount,
  expectedPaymentAmount,
  getDiscountState,
  resolveCheckoutDiscount,
  resolveInviteDiscount,
  consumeInviteToken,
  type DiscountSettings,
  type AppliedDiscount,
} from "../lib/discount";
import { generateQRSvg } from "../lib/qr";
import { sendEmail, fioPendingHtml, purchaseConfirmedHtml, isConsumerPurchase, adminNewOrgHtml } from "../lib/email";
import { Layout } from "../views/layout";
import {
  CheckoutSelect,
  PaymentDetails,
  VerifySuccess,
  VerifyNotFound,
  VerifyError,
  VerifyRateLimit,
} from "../views/checkout";

const checkoutRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

type AppContext = Context<{ Bindings: Env; Variables: Variables }>;

// ─── Helpers ─────────────────────────────────────────────────────

async function getPrices(db: ReturnType<typeof drizzle>) {
  const rows = await db.select().from(siteConfig);
  const cfg = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    individual: parseInt(cfg.price_individual ?? String(PRICE_INDIVIDUAL), 10),
    organization: parseInt(cfg.price_organization ?? String(PRICE_ORGANIZATION), 10),
  };
}

// Cloudflare KV odmítá expirationTtl < 60 s ("Invalid expiration_ttl … must be
// at least 60") a hodí 400, což celý verify endpoint shodí na 500. Prodleva
// mezi ověřeními zůstává FIO_RATE_LIMIT_MS (35 s) — tu hlídá porovnání
// uloženého timestampu, ne expirace klíče. TTL je jen úklid, takže ho můžeme
// beze škody protáhnout na minimum, které KV akceptuje.
const KV_MIN_EXPIRATION_TTL_SECONDS = 60;

export function fioRateLimitTtlSeconds(): number {
  return Math.max(KV_MIN_EXPIRATION_TTL_SECONDS, Math.ceil(FIO_RATE_LIMIT_MS / 1000));
}

/**
 * Která banka přijímá nové převodové objednávky. Řídí se site_config klíčem
 * `active_bank` (`fio` | `creditas`); fallback DEFAULT_ACTIVE_BANK z configu.
 */
async function getActiveBank(db: ReturnType<typeof drizzle>): Promise<TransferBank> {
  const row = await db
    .select({ value: siteConfig.value })
    .from(siteConfig)
    .where(eq(siteConfig.key, "active_bank"))
    .limit(1);
  const v = row[0]?.value;
  return v === "creditas" || v === "fio" ? v : DEFAULT_ACTIVE_BANK;
}

export async function activateFioPurchaseIfPending(
  db: ReturnType<typeof drizzle>,
  opts: {
    purchaseId: number;
    expiresAt: Date;
    transactionId: string;
    amountPaid: number;
    bank?: TransferBank;
  },
): Promise<boolean> {
  const txColumn =
    opts.bank === "creditas"
      ? { creditasTransactionId: opts.transactionId }
      : { fioTransactionId: opts.transactionId };
  const updated = await db
    .update(purchase)
    .set({
      status: "active",
      expiresAt: opts.expiresAt,
      amountPaid: opts.amountPaid,
      ...txColumn,
    })
    .where(and(eq(purchase.id, opts.purchaseId), eq(purchase.status, "pending")))
    .returning({ id: purchase.id });

  return updated.length > 0;
}

export const fioRateLimitTtlSecondsForTest = fioRateLimitTtlSeconds;
export const activateFioPurchaseIfPendingForTest = activateFioPurchaseIfPending;

async function getDiscountSettings(db: ReturnType<typeof drizzle>): Promise<DiscountSettings> {
  const rows = await db.select().from(siteConfig);
  const cfg = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const expiresRaw = cfg.discount_code_expires_at ?? "";
  const expiresAt = expiresRaw ? new Date(expiresRaw) : null;
  return {
    active: cfg.discount_active === "true",
    percent: parseInt(cfg.discount_percent ?? "0", 10),
    limit: parseInt(cfg.discount_limit ?? "0", 10),
    code: cfg.discount_code ?? "",
    codeExpiresAt: expiresAt && !Number.isNaN(expiresAt.getTime()) ? expiresAt : null,
    label: cfg.discount_label ?? "",
  };
}

function getStripe(secretKey: string) {
  return new Stripe(secretKey, { apiVersion: "2026-03-25.dahlia" });
}

function formatDueDate(d: Date): string {
  return d.toLocaleDateString("cs-CZ", { day: "numeric", month: "long", year: "numeric" });
}

function emailDomain(email: string): string {
  return email.toLowerCase().split("@")[1] ?? "";
}

// Firemní fakturační údaje z form data. Pole jsou volitelná; vrací null
// pokud uživatel checkbox nezaškrtl nebo nevyplnil IČO.
interface BillingData {
  companyName: string | null;
  companyIco: string | null;
  companyDic: string | null;
  companyAddress: string | null;
  companyCity: string | null;
  companyZip: string | null;
  contactName: string | null;
  // Volitelný oddělený fakturační e-mail. Když chybí, faktura jde na e-mail nákupu.
  invoiceEmail: string | null;
}

function parseBilling(form: FormData): BillingData | null {
  const enabled = form.get("billingEnabled") === "1";
  const icoRaw = String(form.get("companyIco") ?? "").trim();
  // Pokud user check zaškrtl ale IČO nedoplnil, neukládáme — bez IČO ZD nedává smysl.
  if (!enabled || !icoRaw) return null;
  const ico = icoRaw.replace(/\s/g, "");
  const pick = (k: string) => {
    const v = String(form.get(k) ?? "").trim();
    return v.length > 0 ? v : null;
  };
  const invoiceEmailRaw = String(form.get("invoiceEmail") ?? "").toLowerCase().trim();
  return {
    companyName: pick("companyName"),
    companyIco: ico,
    companyDic: pick("companyDic"),
    companyAddress: pick("companyAddress"),
    companyCity: pick("companyCity"),
    companyZip: pick("companyZip"),
    contactName: pick("contactName"),
    invoiceEmail: invoiceEmailRaw || null,
  };
}

// Konverzní signály z checkout formuláře + requestu (fáze 3). consentMarketing
// je explicitní checkbox; click ID přicházejí z hidden fieldů (capture na vstupu
// landing/GET → hidden field). Zbytek (IP/UA/cookie) řeší captureSignals z requestu.
function captureSignalsFromForm(c: AppContext, form: FormData): ConversionSignals {
  return captureSignals(c.req, {
    consentCheckbox: form.get("marketingConsent") === "1",
    fbclid: String(form.get("fbclid") ?? "").trim() || null,
    gclid: String(form.get("gclid") ?? "").trim() || null,
    gbraid: String(form.get("gbraid") ?? "").trim() || null,
    wbraid: String(form.get("wbraid") ?? "").trim() || null,
  });
}

// Konverzní signály → Stripe metadata (vrátí se ve webhooku). Klíče krátké kvůli
// limitu 50/40/500. marketingConsent jako "1"/"0".
function signalsToStripeMetadata(s: ConversionSignals): Record<string, string> {
  const md: Record<string, string> = { mkt_consent: s.marketingConsent ? "1" : "0" };
  if (s.fbc) md.fbc = s.fbc.slice(0, 500);
  if (s.fbp) md.fbp = s.fbp.slice(0, 500);
  if (s.gclid) md.gclid = s.gclid.slice(0, 500);
  if (s.gbraid) md.gbraid = s.gbraid.slice(0, 500);
  if (s.wbraid) md.wbraid = s.wbraid.slice(0, 500);
  if (s.clientIp) md.cip = s.clientIp.slice(0, 100);
  if (s.userAgent) md.cua = s.userAgent.slice(0, 500);
  return md;
}

/** Validní jen prázdný nebo skutečný e-mail. Vrací false pro vyplněný, ale chybný. */
function invoiceEmailValid(b: BillingData | null): boolean {
  return !b?.invoiceEmail || b.invoiceEmail.includes("@");
}

// Stripe metadata má 50 klíčů, 500 znaků na hodnotu, 40 znaků na klíč.
// Firemní pole zploštíme s prefixem `b_` a oříznem dlouhých hodnot.
function billingToStripeMetadata(b: BillingData | null): Record<string, string> {
  if (!b) return {};
  const out: Record<string, string> = {};
  const set = (k: string, v: string | null) => { if (v) out[k] = v.slice(0, 500); };
  set("b_name", b.companyName);
  set("b_ico", b.companyIco);
  set("b_dic", b.companyDic);
  set("b_addr", b.companyAddress);
  set("b_city", b.companyCity);
  set("b_zip", b.companyZip);
  set("b_contact", b.contactName);
  set("b_email", b.invoiceEmail);
  return out;
}

// ─── B2C: /checkout/individual ───────────────────────────────────

checkoutRoutes.get("/checkout/individual", async (c) => {
  const db = drizzle(c.env.DB);
  const inviteToken = c.req.query("invite") ?? undefined;
  const invite = await resolveInviteDiscount(db, inviteToken ?? null);
  const view = await checkoutSelectView(db, "individual", {
    inviteToken: invite ? invite.token : undefined,
    inviteLabel: invite?.label,
    invitePercent: invite?.percent,
  });
  return c.html(<Layout title="Roční přístup — kurzy.vibecoding.cz">{view}</Layout>);
});

checkoutRoutes.post("/checkout/individual", async (c) => {
  const form = await c.req.formData();
  const email = String(form.get("email") ?? "").toLowerCase().trim();
  const paymentMethod = String(form.get("paymentMethod") ?? "stripe");
  const extendedDeadline = form.get("extendedDeadline") === "1";
  const promoCode = String(form.get("promoCode") ?? "").trim();
  const inviteToken = String(form.get("inviteToken") ?? "").trim() || null;
  const billing = parseBilling(form);
  const signals = captureSignalsFromForm(c, form);

  // Povinný souhlas se zpřístupněním obsahu — `required` v HTML hlídá jen
  // prohlížeč, server musí validovat znovu (přímý POST, vypnutý JS).
  const immediateAccessConsent = form.get("immediateAccessConsent") === "1";
  const emailError = !email || !email.includes("@")
    ? "Zadejte platný email."
    : !invoiceEmailValid(billing)
      ? "Zadejte platný fakturační email (nebo pole nechte prázdné)."
      : !immediateAccessConsent
        ? "Pro dokončení objednávky potvrďte souhlas se zpřístupněním kurzů ihned po zaplacení."
        : null;
  if (emailError) {
    const db = drizzle(c.env.DB);
    const invite = inviteToken ? await resolveInviteDiscount(db, inviteToken) : null;
    const view = await checkoutSelectView(db, "individual", {
      error: emailError,
      prefillEmail: email,
      prefillCode: promoCode,
      prefillCompany: billingToPrefill(billing),
      prefillBilling: !!billing,
      inviteToken: invite ? invite.token : undefined,
      invitePercent: invite?.percent,
      inviteLabel: invite?.label,
    });
    return c.html(<Layout title="Roční přístup">{view}</Layout>, 400);
  }

  const db = drizzle(c.env.DB);
  const prices = await getPrices(db);
  const settings = await getDiscountSettings(db);
  const discount = await resolveCheckoutDiscount(db, settings, promoCode || null, inviteToken);
  const finalPrice = discount ? applyDiscount(prices.individual, discount.percent) : prices.individual;
  const consentAt = new Date();
  if (paymentMethod === "stripe") {
    return await startStripeCheckout(c, "individual", email, undefined, finalPrice, discount, billing, signals, consentAt);
  } else if (paymentMethod === "fio") {
    const bank = await getActiveBank(db);
    return await startFioCheckout(c, "individual", email, undefined, extendedDeadline, finalPrice, discount, billing, bank, signals, consentAt);
  }

  return c.text("Neznámý způsob platby.", 400);
});

// ─── B2B: /checkout/organization ─────────────────────────────────

checkoutRoutes.get("/checkout/organization", async (c) => {
  const db = drizzle(c.env.DB);
  const inviteToken = c.req.query("invite") ?? undefined;
  const invite = await resolveInviteDiscount(db, inviteToken ?? null);
  const view = await checkoutSelectView(db, "organization", {
    inviteToken: invite ? invite.token : undefined,
    inviteLabel: invite?.label,
    invitePercent: invite?.percent,
  });
  return c.html(<Layout title="Firemní licence — kurzy.vibecoding.cz">{view}</Layout>);
});

checkoutRoutes.post("/checkout/organization", async (c) => {
  const form = await c.req.formData();
  const email = String(form.get("email") ?? "").toLowerCase().trim();
  const domainRaw = String(form.get("domain") ?? "").toLowerCase().trim();
  const paymentMethod = String(form.get("paymentMethod") ?? "stripe");
  const extendedDeadline = form.get("extendedDeadline") === "1";
  const promoCode = String(form.get("promoCode") ?? "").trim();
  const inviteToken = String(form.get("inviteToken") ?? "").trim() || null;

  const billing = parseBilling(form);
  const signals = captureSignalsFromForm(c, form);
  const db = drizzle(c.env.DB);
  const renderError = async (msg: string) => {
    const invite = inviteToken ? await resolveInviteDiscount(db, inviteToken) : null;
    const view = await checkoutSelectView(db, "organization", {
      error: msg,
      prefillEmail: email,
      prefillDomain: domainRaw,
      prefillCode: promoCode,
      prefillCompany: billingToPrefill(billing),
      prefillBilling: !!billing,
      inviteToken: invite ? invite.token : undefined,
      invitePercent: invite?.percent,
      inviteLabel: invite?.label,
    });
    return c.html(<Layout title="Firemní licence">{view}</Layout>, 400);
  };

  if (!email || !email.includes("@")) return renderError("Zadejte platný email.");
  if (!invoiceEmailValid(billing)) return renderError("Zadejte platný fakturační email (nebo pole nechte prázdné).");
  // Povinný souhlas se zpřístupněním obsahu — HTML `required` platí jen v prohlížeči.
  if (form.get("immediateAccessConsent") !== "1") {
    return renderError("Pro dokončení objednávky potvrďte souhlas se zpřístupněním kurzů ihned po zaplacení.");
  }
  if (!domainRaw || !domainRaw.includes(".")) return renderError("Zadejte platnou firemní doménu (např. firma.cz).");
  if (isFreemailDomain(domainRaw)) return renderError(FREEMAIL_REJECTION_MESSAGE);

  const prices = await getPrices(db);
  const settings = await getDiscountSettings(db);
  const discount = await resolveCheckoutDiscount(db, settings, promoCode || null, inviteToken);
  const finalPrice = discount ? applyDiscount(prices.organization, discount.percent) : prices.organization;
  const consentAt = new Date();
  if (paymentMethod === "stripe") {
    return await startStripeCheckout(c, "organization", email, domainRaw, finalPrice, discount, billing, signals, consentAt);
  } else if (paymentMethod === "fio") {
    const bank = await getActiveBank(db);
    return await startFioCheckout(c, "organization", email, domainRaw, extendedDeadline, finalPrice, discount, billing, bank, signals, consentAt);
  }

  return c.text("Neznámý způsob platby.", 400);
});

function billingToPrefill(b: BillingData | null) {
  if (!b) return undefined;
  return {
    companyName: b.companyName ?? undefined,
    companyIco: b.companyIco ?? undefined,
    companyDic: b.companyDic ?? undefined,
    companyAddress: b.companyAddress ?? undefined,
    companyCity: b.companyCity ?? undefined,
    companyZip: b.companyZip ?? undefined,
    contactName: b.contactName ?? undefined,
    invoiceEmail: b.invoiceEmail ?? undefined,
  };
}

// Sestaví view pro výběr platební metody s aktuální slevou.
async function checkoutSelectView(
  db: ReturnType<typeof drizzle>,
  type: "individual" | "organization",
  opts: {
    error?: string;
    prefillEmail?: string;
    prefillDomain?: string;
    prefillCode?: string;
    prefillCompany?: {
      companyName?: string;
      companyIco?: string;
      companyDic?: string;
      companyAddress?: string;
      companyCity?: string;
      companyZip?: string;
      contactName?: string;
    };
    prefillBilling?: boolean;
    inviteToken?: string;
    inviteLabel?: string | null;
    invitePercent?: number;
  },
) {
  const prices = await getPrices(db);
  const settings = await getDiscountSettings(db);
  const stage = await getDiscountState(db, settings);
  const priceOriginal = type === "organization" ? prices.organization : prices.individual;

  // Invite token (pokud platný) má přednost a určí cenu i popisek rovnou.
  const hasInvite = !!opts.inviteToken && (opts.invitePercent ?? 0) > 0;
  const effectivePercent = hasInvite
    ? (opts.invitePercent ?? 0)
    : stage.kind === "auto"
      ? stage.percent
      : 0;
  const priceFinal = effectivePercent > 0
    ? applyDiscount(priceOriginal, effectivePercent)
    : priceOriginal;
  const effectiveLabel = hasInvite
    ? (opts.inviteLabel || "Osobní sleva")
    : stage.kind === "auto"
      ? stage.label
      : undefined;
  // Promo input ukazujeme jen mimo invite režim.
  const showCodeInput = !hasInvite && ((stage.kind === "auto" && stage.codeActive) || stage.kind === "code-only");

  return (
    <CheckoutSelect
      type={type}
      error={opts.error}
      prefillEmail={opts.prefillEmail}
      prefillDomain={opts.prefillDomain}
      prefillCode={opts.prefillCode}
      prefillCompany={opts.prefillCompany}
      prefillBilling={opts.prefillBilling}
      priceOriginal={priceOriginal}
      priceFinal={priceFinal}
      discountPercent={effectivePercent}
      discountLabel={effectiveLabel}
      showCodeInput={showCodeInput}
      inviteToken={opts.inviteToken}
    />
  );
}

// ─── Stripe startér (unified pro B2C + B2B) ─────────────────────

async function startStripeCheckout(
  c: AppContext,
  type: "individual" | "organization",
  email: string,
  domain: string | undefined,
  price: number,
  discount: AppliedDiscount | null,
  billing: BillingData | null,
  signals: ConversionSignals,
  // Čas výslovného souhlasu se zpřístupněním obsahu (§ 1837 písm. l). Putuje
  // přes Stripe metadata do webhooku, kde teprve vzniká purchase řádek.
  immediateAccessConsentAt: Date,
) {
  const stripe = getStripe(c.env.STRIPE_SECRET_KEY);
  const isOrg = type === "organization";
  const productName = isOrg
    ? "Videokurz Claude Code — Firemní licence"
    : "Videokurz Claude Code — Jednotlivec";

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    payment_method_types: ["card"],
    customer_email: email,
    line_items: [
      {
        price_data: {
          currency: "czk",
          product_data: { name: productName },
          unit_amount: price * 100,
          recurring: { interval: "year" },
        },
        quantity: 1,
      },
    ],
    ...(isOrg
      ? {
          custom_fields: [
            {
              key: "domain",
              label: { type: "custom", custom: "Emailová doména firmy (např. firma.cz)" },
              type: "text",
            },
          ],
        }
      : {}),
    success_url: `${c.env.BETTER_AUTH_URL}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${c.env.BETTER_AUTH_URL}/#cenik`,
    metadata: {
      type,
      ...(domain ? { prefillDomain: domain } : {}),
      ...(discount ? { discountPercent: String(discount.percent) } : {}),
      ...(discount?.code ? { discountCode: discount.code } : {}),
      ...(discount?.source === "invite" && discount.code
        ? { inviteToken: discount.code.replace(/^invite:/, "") }
        : {}),
      ...billingToStripeMetadata(billing),
      ...signalsToStripeMetadata(signals),
      // Souhlas se zpřístupněním obsahu — checkbox je povinný, sem se dostaneme
      // jen po jeho zaškrtnutí. Unix sekundy kvůli limitu délky metadat.
      ia_consent_at: String(Math.floor(immediateAccessConsentAt.getTime() / 1000)),
    },
  });

  return c.redirect(session.url!, 303);
}

// ─── FIO startér ─────────────────────────────────────────────────

async function startFioCheckout(
  c: AppContext,
  type: "individual" | "organization",
  email: string,
  domain: string | undefined,
  extendedDeadline: boolean,
  price: number,
  discount: AppliedDiscount | null,
  billing: BillingData | null,
  bank: TransferBank,
  signals: ConversionSignals,
  // Čas výslovného souhlasu se zpřístupněním obsahu (§ 1837 písm. l).
  immediateAccessConsentAt: Date,
) {
  const db = drizzle(c.env.DB);
  const dueDays = extendedDeadline ? FIO_EXTENDED_DUE_DAYS : FIO_DEFAULT_DUE_DAYS;
  const expiresAt = new Date(Date.now() + dueDays * 86400 * 1000);
  const createdAt = new Date();

  // Dedup: pokud už existuje pending převodová objednávka pro stejný email+type
  // se stále platnou splatností, přesměruj na ni místo vytváření nové. Bereme
  // libovolnou banku — uživatel má dorazit na svou existující platební stránku.
  const existingPending = await db
    .select({
      id: purchase.id,
      vs: purchase.variableSymbol,
      accessToken: purchase.accessToken,
      consent: purchase.immediateAccessConsent,
    })
    .from(purchase)
    .where(
      and(
        eq(purchase.email, email),
        eq(purchase.type, type),
        inArray(purchase.paymentMethod, ["fio", "creditas"]),
        eq(purchase.status, "pending"),
        gt(purchase.expiresAt, new Date())
      )
    )
    .limit(1);
  if (existingPending.length > 0) {
    // Souhlas doplň, pokud ho objednávka ještě nemá. Nastane u objednávek
    // založených před migrací 0033, které jsou ve svém dedup okně (7–21 dní)
    // pořád pending: zákazník teď checkbox zaškrtl, ale dostane redirect na
    // starou objednávku — bez tohoto zápisu by se jeho souhlas ztratil a
    // přístup by se aktivoval bez důkazu. Podmínka `eq(consent, false)` drží
    // zápis idempotentní, takže **existující** souhlas se nikdy nepřepíše
    // (důkazní záznam si musí podržet svůj původní čas).
    if (!existingPending[0].consent) {
      await db
        .update(purchase)
        .set({
          immediateAccessConsent: true,
          immediateAccessConsentAt,
        })
        .where(
          and(
            eq(purchase.id, existingPending[0].id),
            eq(purchase.immediateAccessConsent, false)
          )
        );
    }
    // Preferuj token (nehádatelný); na VS spadni jen u starých objednávek bez tokenu.
    const ref = existingPending[0].accessToken ?? existingPending[0].vs;
    if (ref) return c.redirect(`/checkout/pay/${ref}`, 303);
  }

  // ZD generujeme pro KAŽDOU FIO objednávku — slouží jako doklad pro účtárnu
  // firmy kupujícího před přijetím platby. Když billing není vyplněno, ZD má
  // jen e-mail v "odběrateli", což stačí jako interní doklad.
  // Sekvenci alokujeme jednou — pokud selže VS retry, použijeme stejné ZD číslo.
  const proformaNumber = await nextProformaNumber(db, createdAt);
  const proformaIssuedAt = createdAt;

  // Nehádatelný token pro pay/proforma stránku (oprava IDOR — VS šlo enumerovat).
  // Generujeme jednou; nanoid kolize je prakticky nemožná, retry řeší jen VS.
  const accessToken = nanoid();

  // Generování VS s odolností proti TOCTOU: při UNIQUE violation opakuj s novým VS (max 5 pokusů).
  let vs: string | null = null;
  let insertOrgDone = false;
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate =
      bank === "creditas" ? generateCreditasVariableSymbol() : generateVariableSymbol();
    try {
      if (type === "organization" && domain && !insertOrgDone) {
        const existingOrg = await db
          .select({ id: organization.id })
          .from(organization)
          .where(eq(organization.domain, domain))
          .limit(1);
        if (existingOrg.length === 0) {
          await db.insert(organization).values({
            publicId: nanoid(),
            domain,
            stripeSubscriptionId: null,
            status: "pending",
            createdAt,
          });
        }
        insertOrgDone = true;
      }

      await db.insert(purchase).values({
        email,
        userId: null,
        type,
        paymentMethod: bank,
        variableSymbol: candidate,
        fioTransactionId: null,
        stripePaymentId: null,
        stripeSubscriptionId: null,
        status: "pending",
        expiresAt,
        createdAt,
        // Uložíme očekávanou částku z doby objednávky. Drží se až do reálného
        // spárování platby, kdy ji přepíše skutečná částka z banky. Díky tomu
        // pay/proforma stránka neukáže driftující cenu, když se mezitím změní ceník.
        amountPaid: price,
        discountPercent: discount?.percent ?? 0,
        discountCode: discount?.code ?? null,
        companyName: billing?.companyName ?? null,
        companyIco: billing?.companyIco ?? null,
        companyDic: billing?.companyDic ?? null,
        companyAddress: billing?.companyAddress ?? null,
        companyCity: billing?.companyCity ?? null,
        companyZip: billing?.companyZip ?? null,
        contactName: billing?.contactName ?? null,
        invoiceEmail: billing?.invoiceEmail ?? null,
        proformaNumber,
        proformaIssuedAt,
        accessToken,
        // Konverzní signály zachycené při objednávce (fáze 3). Konverze se
        // reportuje až po spárování platby (cron/verify), kdy se přidá i čas.
        marketingConsent: signals.marketingConsent,
        // Důkaz souhlasu podle § 1837 písm. l). Dedup větev výše řeší případ,
        // kdy se místo nové objednávky recykluje existující pending.
        immediateAccessConsent: true,
        immediateAccessConsentAt,
        fbc: signals.fbc,
        fbp: signals.fbp,
        gclid: signals.gclid,
        gbraid: signals.gbraid,
        wbraid: signals.wbraid,
        clientIp: signals.clientIp,
        userAgent: signals.userAgent,
      });
      vs = candidate;
      break;
    } catch (err) {
      // UNIQUE(variableSymbol) kolize — zkusit znovu s jiným VS
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("UNIQUE") || msg.includes("unique")) {
        continue;
      }
      throw err;
    }
  }
  if (!vs) {
    console.error("[fio] Failed to generate unique VS after 5 attempts");
    return c.text("Chyba při vytváření objednávky. Zkuste to prosím znovu.", 500);
  }

  const payUrl = `${c.env.BETTER_AUTH_URL}/checkout/pay/${accessToken}`;
  const proformaUrl = `${c.env.BETTER_AUTH_URL}/checkout/proforma/${accessToken}`;
  c.executionCtx.waitUntil(
    sendEmail(c.env, {
      to: email,
      subject: "Potvrzení objednávky — kurzy.vibecoding.cz",
      html: fioPendingHtml(payUrl, price, formatDueDate(expiresAt), proformaUrl, proformaNumber),
    })
  );

  if (type === "organization" && domain) {
    c.executionCtx.waitUntil(
      sendEmail(c.env, {
        to: [...ADMIN_EMAILS],
        subject: `Nová firemní objednávka (${bank === "creditas" ? "Creditas" : "FIO"})`,
        html: adminNewOrgHtml(domain, email, bank, `${c.env.BETTER_AUTH_URL}/admin`),
      })
    );
  }

  return c.redirect(`/checkout/pay/${accessToken}`, 303);
}

// ─── Lookup pay/proforma stránky (token nebo legacy VS) ─────────────
//
// Nové objednávky se odkazují přes nehádatelný accessToken (nanoid 21 zn.).
// Staré e-maily nesou ještě 8místný VS (33/34 + 6 číslic) — ty podporujeme
// zpětně, ale s per-IP rate-limitem, aby nešel VS prostor enumerovat a číst
// z pay/proforma stránek PII (oprava IDOR).

// VS je čistě číselný (prefix 33/34 + 6 číslic). Cokoli jiného je token.
function looksLikeLegacyVs(ref: string): boolean {
  return /^\d{6,10}$/.test(ref);
}

// Vrací true, pokud má být požadavek zamítnut (rate-limit aktivní).
//
// POZOR: KV není atomické (get+put jsou dvě operace) — souběžný burst ze
// stejné IP může počítadlo podtéct a propustit víc než limit. Tady to ale
// vadí minimálně: rate-limit je jen ZTÍŽENÍ enumerace legacy VS, NE bezpečnostní
// hranice — tou je nehádatelný accessToken (token větev limitu nepodléhá).
// Zvyšujeme počítadlo PŘED kontrolou (put-then-check), ať se souběžné požadavky
// aspoň navzájem započítají, jakmile se zápis propíše; pro best-effort obranu
// proti enumeraci to stačí.
async function checkPayLookupRateLimit(kv: KVNamespace, ip: string): Promise<boolean> {
  const key = `pay_lookup_rate:${ip}`;
  const count = Number((await kv.get(key)) ?? "0");
  await kv.put(key, String(count + 1), { expirationTtl: 60 });
  return count >= 10; // max 10 legacy-VS lookupů / minuta / IP
}

/**
 * Najde objednávku podle pay/proforma reference (token nebo legacy VS).
 * Vrací `null` při nenalezení a `"rate_limited"` při překročení limitu na
 * legacy VS lookup. Token lookup limitu nepodléhá (je nehádatelný).
 */
async function findPurchaseByPayRef(
  c: AppContext,
  db: ReturnType<typeof drizzle>,
  ref: string,
): Promise<typeof purchase.$inferSelect | null | "rate_limited"> {
  if (looksLikeLegacyVs(ref)) {
    // Spoléhej JEN na CF-Connecting-IP (Cloudflare ho nastavuje důvěryhodně).
    // x-forwarded-for jde klientem podvrhnout → čistý bucket každý request,
    // takže když CF-Connecting-IP chybí, raději přísně zamítni (legacy VS je
    // okrajová zpětně-kompatibilní cesta, přísnost tu neuškodí). (greptile P2)
    const ip = c.req.header("CF-Connecting-IP");
    if (!ip) return "rate_limited";
    if (await checkPayLookupRateLimit(c.env.KV, ip)) return "rate_limited";
    const rows = await db
      .select()
      .from(purchase)
      .where(eq(purchase.variableSymbol, ref))
      .limit(1);
    return rows[0] ?? null;
  }
  const rows = await db
    .select()
    .from(purchase)
    .where(eq(purchase.accessToken, ref))
    .limit(1);
  return rows[0] ?? null;
}

// ─── FIO platební stránka ────────────────────────────────────────

checkoutRoutes.get("/checkout/pay/:vs", async (c) => {
  const ref = c.req.param("vs");
  const db = drizzle(c.env.DB);

  const found = await findPurchaseByPayRef(c, db, ref);

  if (found === "rate_limited") {
    return c.html(
      <Layout title="Příliš mnoho požadavků">
        <section class="max-w-md mx-auto px-4 py-16 text-center">
          <h1 class="text-2xl font-bold mb-4">Příliš mnoho požadavků</h1>
          <p class="text-gray-600">Zkuste to prosím za chvíli, nebo otevřete odkaz přímo z e-mailu.</p>
        </section>
      </Layout>,
      429
    );
  }

  if (!found) {
    return c.html(
      <Layout title="Objednávka nenalezena">
        <section class="max-w-md mx-auto px-4 py-16 text-center">
          <h1 class="text-2xl font-bold mb-4">Objednávka nenalezena</h1>
          <p class="text-gray-600">Zkontrolujte odkaz z emailu nebo vytvořte novou objednávku.</p>
          <a href="/" class="mt-6 inline-block text-indigo-600 hover:underline">Zpět na hlavní stránku</a>
        </section>
      </Layout>,
      404
    );
  }

  const p = found;

  if (p.status === "active") {
    return c.redirect(`/login?email=${encodeURIComponent(p.email)}`, 303);
  }
  if (p.status === "expired" || p.status === "refunded") {
    return c.html(
      <Layout title="Objednávka již není aktivní">
        <section class="max-w-md mx-auto px-4 py-16 text-center">
          <h1 class="text-2xl font-bold mb-4">Objednávka již není aktivní</h1>
          <p class="text-gray-600 mb-6">Stav: {p.status === "expired" ? "propadla" : "refundována"}. Vytvořte novou objednávku.</p>
          <a href={p.type === "organization" ? "/checkout/organization" : "/checkout/individual"} class="btn-on-dark no-underline inline-block bg-indigo-600 text-white px-6 py-3 rounded-lg">Nová objednávka</a>
        </section>
      </Layout>,
      410
    );
  }

  const prices = await getPrices(db);
  const fullPrice = p.type === "organization" ? prices.organization : prices.individual;
  const price = expectedPaymentAmount(p.amountPaid, fullPrice, p.discountPercent ?? 0);
  const dueDays = Math.round((p.expiresAt.getTime() - p.createdAt.getTime()) / 86400000);
  const isExtended = dueDays > FIO_DEFAULT_DUE_DAYS;
  const bank = bankDetails(p.paymentMethod === "creditas" ? "creditas" : "fio");
  const spd = generateSPD(bank.iban, price, p.variableSymbol!, `Videokurz ${p.email}`);
  const qrSvg = generateQRSvg(spd);

  let domain: string | undefined;
  if (p.type === "organization") {
    domain = emailDomain(p.email);
  }

  // Sklik conversionHit „při objednávce" — i pro zatím nezaplacené převody
  // (rozhodnutí provozovatele). Dedup přes sessionStorage na VS (pay stránka se
  // zobrazuje opakovaně). E-mail se hashuje server-side pro identity matching.
  const sklikConv = await sklikConversionSnippetFor(c.env, {
    value: price,
    orderId: p.variableSymbol!,
    email: p.email,
  });

  return c.html(
    <Layout title={p.proformaNumber ? `Zálohový doklad ${p.proformaNumber}` : "Platba bankovním převodem"}>
      <PaymentDetails
        variableSymbol={p.variableSymbol!}
        payRef={p.accessToken ?? p.variableSymbol!}
        amount={price}
        account={bank.account}
        iban={bank.iban}
        bic={bank.bic}
        qrSvg={qrSvg}
        type={p.type as "individual" | "organization"}
        email={p.email}
        domain={domain}
        dueDate={formatDueDate(p.expiresAt)}
        issueDate={formatDueDate(p.proformaIssuedAt ?? p.createdAt)}
        isExtended={isExtended}
        proformaNumber={p.proformaNumber}
        supplier={{
          name: SUPPLIER.name,
          address: SUPPLIER.address,
          city: SUPPLIER.city,
          zip: SUPPLIER.zip,
          ico: SUPPLIER.ico,
          email: SUPPLIER.email,
        }}
        companyName={p.companyName}
        companyIco={p.companyIco}
        companyDic={p.companyDic}
        companyAddress={p.companyAddress}
        companyCity={p.companyCity}
        companyZip={p.companyZip}
        contactName={p.contactName}
      />
      {sklikConv && <div dangerouslySetInnerHTML={{ __html: sklikConv }} />}
    </Layout>
  );
});

// ─── Verify endpoint (htmx) ──────────────────────────────────────

checkoutRoutes.post("/api/fio/verify/:vs", async (c) => {
  // Parametr se historicky jmenuje :vs, ale nese stejnou referenci jako
  // pay/proforma stránky — nehádatelný accessToken, u starých objednávek VS.
  const ref = c.req.param("vs");
  const origin = c.req.header("Origin");
  const requestOrigin = new URL(c.req.url).origin;
  const isHtmx = c.req.header("HX-Request") === "true";
  if (!isHtmx) {
    return c.html(<VerifyError message="Ověření platby spusťte z platební stránky." />, 403);
  }
  if (origin && origin !== requestOrigin) {
    return c.html(<VerifyError message="Ověření platby není povoleno z této stránky." />, 403);
  }

  const db = drizzle(c.env.DB);

  const rateLimitKey = `fio_rate_limit:${ref}`;
  const lastCheck = await c.env.KV.get(rateLimitKey);
  if (lastCheck) {
    const waitMs = FIO_RATE_LIMIT_MS - (Date.now() - Number(lastCheck));
    if (waitMs > 0) {
      return c.html(<VerifyRateLimit waitSeconds={Math.ceil(waitMs / 1000)} />);
    }
  }
  await c.env.KV.put(rateLimitKey, String(Date.now()), {
    expirationTtl: fioRateLimitTtlSeconds(),
  });

  // Stejný lookup jako pay/proforma: token větev je nehádatelná, legacy VS
  // podléhá per-IP limitu, aby nešel VS prostor enumerovat a číst z odpovědí
  // PII kupujícího (oprava IDOR).
  const found = await findPurchaseByPayRef(c, db, ref);

  if (found === "rate_limited") {
    return c.html(<VerifyRateLimit waitSeconds={60} />);
  }
  if (!found) {
    return c.html(<VerifyError message="Objednávka nenalezena." />);
  }
  const p = found;

  if (p.status === "active") {
    return c.html(<VerifySuccess email={p.email} />);
  }
  if (p.status !== "pending") {
    return c.html(<VerifyError message="Objednávka již není aktivní." />);
  }

  const bank: TransferBank = p.paymentMethod === "creditas" ? "creditas" : "fio";

  const verifyPrices = await getPrices(db);
  const fullExpected = p.type === "organization" ? verifyPrices.organization : verifyPrices.individual;
  const expectedAmount = expectedPaymentAmount(p.amountPaid, fullExpected, p.discountPercent ?? 0);

  // Načti transakce z banky, na kterou byla objednávka vystavena, a spáruj.
  let matchedTx: { id: string; amount: number; date: string | null } | null = null;
  if (bank === "creditas") {
    const creRes = await fetchCreditasTransactions(
      c.env.CREDITAS_API_TOKEN ?? "dev",
      c.env.CREDITAS_IDENTIFIKATOR ?? "",
      FIO_LOOKBACK_DAYS,
    );
    if (!creRes.ok) {
      return c.html(<VerifyError message="Dočasně nelze ověřit. Zkuste to za chvíli." />);
    }
    const m = matchCreditasPayment(creRes.transactions, p.variableSymbol!, expectedAmount);
    if (m.found && m.transaction) matchedTx = { id: m.transaction.id, amount: m.transaction.amount, date: m.transaction.date };
  } else {
    const fioRes = await fetchFioTransactions(
      c.env.FIO_API_TOKEN,
      FIO_LOOKBACK_DAYS,
      fioProxyFromEnv(c.env),
    );
    if (!fioRes.ok) {
      if (fioRes.status === 429) {
        return c.html(<VerifyRateLimit waitSeconds={30} />);
      }
      return c.html(<VerifyError message="Dočasně nelze ověřit. Zkuste to za chvíli." />);
    }
    const m = matchPayment(fioRes.transactions, p.variableSymbol!, expectedAmount);
    if (m.found && m.transaction) matchedTx = { id: String(m.transaction.id), amount: m.transaction.amount, date: m.transaction.date };
  }

  if (!matchedTx) {
    return c.html(<VerifyNotFound />);
  }

  const now = new Date();
  const newExpiresAt = new Date(now.getTime() + ACCESS_DURATION_DAYS * 86400 * 1000);
  const activated = await activateFioPurchaseIfPending(db, {
    purchaseId: p.id,
    expiresAt: newExpiresAt,
    transactionId: matchedTx.id,
    amountPaid: matchedTx.amount,
    bank,
  });

  if (!activated) {
    return c.html(<VerifySuccess email={p.email} />);
  }

  // Čas konverze = den bankovní transakce (R6). Uložíme na row a reportujeme
  // konverzi. activated=true zajišťuje, že se to stane jen při reálné aktivaci
  // (refresh stránky druhý report nevyvolá); reportPurchase je navíc idempotentní.
  const conversionOccurredAt = bankDateToConversionInstant(matchedTx.date);
  await db.update(purchase).set({ conversionOccurredAt }).where(eq(purchase.id, p.id));
  await reportPurchase(db, c.env, p.id, {
    valueOverride: matchedTx.amount,
    conversionOccurredAt,
  });

  // Invite token (uložený v discountCode jako "invite:<token>") se spotřebuje
  // až teď, po napárování platby a aktivaci nákupu.
  if (p.discountCode?.startsWith("invite:")) {
    const token = p.discountCode.slice("invite:".length);
    await consumeInviteToken(db, token, p.id);
  }

  c.executionCtx.waitUntil(
    sendEmail(c.env, {
      to: p.email,
      subject: "Platba přijata — přihlaste se do kurzu",
      html: purchaseConfirmedHtml(
        `${c.env.BETTER_AUTH_URL}/login?email=${encodeURIComponent(p.email)}`,
        p.type as "individual" | "organization",
        isConsumerPurchase(p),
      ),
    })
  );

  return c.html(<VerifySuccess email={p.email} />);
});

// ─── ARES lookup endpoint ────────────────────────────────────────

checkoutRoutes.get("/api/ares-lookup", async (c) => {
  const ico = c.req.query("ico")?.trim();
  const name = c.req.query("name")?.trim();
  if (!ico && !name) {
    return c.json({ error: "Zadejte IČO nebo název firmy" }, 400);
  }
  try {
    const results = ico ? await lookupByIco(ico) : await lookupByName(name!);
    return c.json({ results });
  } catch (err) {
    console.error("[ares] lookup failed:", err);
    return c.json({ error: "Chyba při vyhledávání v ARES", results: [] }, 500);
  }
});

// ─── Zálohový doklad render ──────────────────────────────────────

checkoutRoutes.get("/checkout/proforma/:vs", async (c) => {
  const ref = c.req.param("vs");
  const db = drizzle(c.env.DB);

  const found = await findPurchaseByPayRef(c, db, ref);

  if (found === "rate_limited") {
    return c.html(
      <Layout title="Příliš mnoho požadavků">
        <section class="max-w-md mx-auto px-4 py-16 text-center">
          <h1 class="text-2xl font-bold mb-4">Příliš mnoho požadavků</h1>
          <p class="text-gray-600">Zkuste to prosím za chvíli, nebo otevřete odkaz přímo z e-mailu.</p>
        </section>
      </Layout>,
      429,
    );
  }

  if (!found || !found.proformaNumber) {
    return c.html(
      <Layout title="Zálohový doklad nenalezen">
        <section class="max-w-md mx-auto px-4 py-16 text-center">
          <h1 class="text-2xl font-bold mb-4">Zálohový doklad nenalezen</h1>
          <p class="text-gray-600">Zkontrolujte odkaz z emailu nebo nás kontaktujte.</p>
        </section>
      </Layout>,
      404,
    );
  }

  const p = found;
  const prices = await getPrices(db);
  const fullPrice = p.type === "organization" ? prices.organization : prices.individual;
  const amount = expectedPaymentAmount(p.amountPaid, fullPrice, p.discountPercent ?? 0);
  const domain = p.type === "organization" ? emailDomain(p.email) : null;

  const html = generateProformaHtml({
    proformaNumber: p.proformaNumber!,
    issueDate: p.proformaIssuedAt ?? p.createdAt,
    dueDate: p.expiresAt,
    companyName: p.companyName,
    companyIco: p.companyIco,
    companyDic: p.companyDic,
    companyAddress: p.companyAddress,
    companyCity: p.companyCity,
    companyZip: p.companyZip,
    contactName: p.contactName,
    contactEmail: p.email,
    type: p.type as "individual" | "organization",
    domain,
    amount,
    variableSymbol: p.variableSymbol!,
    bank: p.paymentMethod === "creditas" ? "creditas" : "fio",
  });

  return c.html(html);
});

export { checkoutRoutes };
