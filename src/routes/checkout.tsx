import { Hono } from "hono";
import type { Context } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { and, eq, gt } from "drizzle-orm";
import Stripe from "stripe";
import { nanoid } from "nanoid";
import type { Env, Variables } from "../types";
import { purchase, organization, siteConfig } from "../db/schema";
import {
  PAYMENT_ACCOUNT,
  PAYMENT_IBAN,
  PRICE_INDIVIDUAL,
  PRICE_ORGANIZATION,
  FIO_DEFAULT_DUE_DAYS,
  FIO_EXTENDED_DUE_DAYS,
  FIO_RATE_LIMIT_MS,
  FIO_LOOKBACK_DAYS,
  ACCESS_DURATION_DAYS,
} from "../config/payment";
import { isFreemailDomain, FREEMAIL_REJECTION_MESSAGE } from "../config/freemail-domains";
import { ADMIN_EMAILS } from "../config/admin";
import {
  generateVariableSymbol,
  generateSPD,
  fetchFioTransactions,
  matchPayment,
} from "../lib/fio";
import { generateQRSvg } from "../lib/qr";
import { sendEmail, fioPendingHtml, purchaseConfirmedHtml, adminNewOrgHtml } from "../lib/email";
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

function getStripe(secretKey: string) {
  return new Stripe(secretKey, { apiVersion: "2026-03-25.dahlia" });
}

function formatDueDate(d: Date): string {
  return d.toLocaleDateString("cs-CZ", { day: "numeric", month: "long", year: "numeric" });
}

function emailDomain(email: string): string {
  return email.toLowerCase().split("@")[1] ?? "";
}

// ─── B2C: /checkout/individual ───────────────────────────────────

checkoutRoutes.get("/checkout/individual", (c) => {
  return c.html(
    <Layout title="Roční přístup — kurzy.vibecoding.cz">
      <CheckoutSelect type="individual" />
    </Layout>
  );
});

checkoutRoutes.post("/checkout/individual", async (c) => {
  const form = await c.req.formData();
  const email = String(form.get("email") ?? "").toLowerCase().trim();
  const paymentMethod = String(form.get("paymentMethod") ?? "stripe");
  const extendedDeadline = form.get("extendedDeadline") === "1";

  if (!email || !email.includes("@")) {
    return c.html(
      <Layout title="Roční přístup">
        <CheckoutSelect type="individual" error="Zadejte platný email." prefillEmail={email} />
      </Layout>,
      400
    );
  }

  const db = drizzle(c.env.DB);
  const prices = await getPrices(db);
  if (paymentMethod === "stripe") {
    return await startStripeCheckout(c, "individual", email, undefined, prices.individual);
  } else if (paymentMethod === "fio") {
    return await startFioCheckout(c, "individual", email, undefined, extendedDeadline, prices.individual);
  }

  return c.text("Neznámý způsob platby.", 400);
});

// ─── B2B: /checkout/organization ─────────────────────────────────

checkoutRoutes.get("/checkout/organization", (c) => {
  return c.html(
    <Layout title="Firemní licence — kurzy.vibecoding.cz">
      <CheckoutSelect type="organization" />
    </Layout>
  );
});

checkoutRoutes.post("/checkout/organization", async (c) => {
  const form = await c.req.formData();
  const email = String(form.get("email") ?? "").toLowerCase().trim();
  const domainRaw = String(form.get("domain") ?? "").toLowerCase().trim();
  const paymentMethod = String(form.get("paymentMethod") ?? "stripe");
  const extendedDeadline = form.get("extendedDeadline") === "1";

  if (!email || !email.includes("@")) {
    return c.html(
      <Layout title="Firemní licence">
        <CheckoutSelect type="organization" error="Zadejte platný email." prefillEmail={email} prefillDomain={domainRaw} />
      </Layout>,
      400
    );
  }

  if (!domainRaw || !domainRaw.includes(".")) {
    return c.html(
      <Layout title="Firemní licence">
        <CheckoutSelect type="organization" error="Zadejte platnou firemní doménu (např. firma.cz)." prefillEmail={email} prefillDomain={domainRaw} />
      </Layout>,
      400
    );
  }

  if (isFreemailDomain(domainRaw)) {
    return c.html(
      <Layout title="Firemní licence">
        <CheckoutSelect type="organization" error={FREEMAIL_REJECTION_MESSAGE} prefillEmail={email} prefillDomain={domainRaw} />
      </Layout>,
      400
    );
  }

  const db = drizzle(c.env.DB);
  const prices = await getPrices(db);
  if (paymentMethod === "stripe") {
    return await startStripeCheckout(c, "organization", email, domainRaw, prices.organization);
  } else if (paymentMethod === "fio") {
    return await startFioCheckout(c, "organization", email, domainRaw, extendedDeadline, prices.organization);
  }

  return c.text("Neznámý způsob platby.", 400);
});

// ─── Stripe startér (unified pro B2C + B2B) ─────────────────────

async function startStripeCheckout(
  c: AppContext,
  type: "individual" | "organization",
  email: string,
  domain: string | undefined,
  price: number
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
  price: number
) {
  const db = drizzle(c.env.DB);
  const dueDays = extendedDeadline ? FIO_EXTENDED_DUE_DAYS : FIO_DEFAULT_DUE_DAYS;
  const expiresAt = new Date(Date.now() + dueDays * 86400 * 1000);
  const createdAt = new Date();

  // Dedup: pokud už existuje pending FIO objednávka pro stejný email+type se stále platnou splatností,
  // přesměruj na ni místo vytváření nové.
  const existingPending = await db
    .select({ vs: purchase.variableSymbol })
    .from(purchase)
    .where(
      and(
        eq(purchase.email, email),
        eq(purchase.type, type),
        eq(purchase.paymentMethod, "fio"),
        eq(purchase.status, "pending"),
        gt(purchase.expiresAt, new Date())
      )
    )
    .limit(1);
  if (existingPending.length > 0 && existingPending[0].vs) {
    return c.redirect(`/checkout/pay/${existingPending[0].vs}`, 303);
  }

  // Generování VS s odolností proti TOCTOU: při UNIQUE violation opakuj s novým VS (max 5 pokusů).
  let vs: string | null = null;
  let insertOrgDone = false;
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = generateVariableSymbol();
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
        paymentMethod: "fio",
        variableSymbol: candidate,
        fioTransactionId: null,
        stripePaymentId: null,
        stripeSubscriptionId: null,
        status: "pending",
        expiresAt,
        createdAt,
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

  const payUrl = `${c.env.BETTER_AUTH_URL}/checkout/pay/${vs}`;
  c.executionCtx.waitUntil(
    sendEmail(c.env, {
      to: email,
      subject: "Potvrzení objednávky — kurzy.vibecoding.cz",
      html: fioPendingHtml(payUrl, price, formatDueDate(expiresAt)),
    })
  );

  if (type === "organization" && domain) {
    c.executionCtx.waitUntil(
      sendEmail(c.env, {
        to: [...ADMIN_EMAILS],
        subject: "Nová firemní objednávka (FIO)",
        html: adminNewOrgHtml(domain, email, "fio", `${c.env.BETTER_AUTH_URL}/admin`),
      })
    );
  }

  return c.redirect(`/checkout/pay/${vs}`, 303);
}

// ─── FIO platební stránka ────────────────────────────────────────

checkoutRoutes.get("/checkout/pay/:vs", async (c) => {
  const vs = c.req.param("vs");
  const db = drizzle(c.env.DB);

  const rows = await db
    .select()
    .from(purchase)
    .where(eq(purchase.variableSymbol, vs))
    .limit(1);

  if (rows.length === 0) {
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

  const p = rows[0];

  if (p.status === "active") {
    return c.redirect(`/login?email=${encodeURIComponent(p.email)}`, 303);
  }
  if (p.status === "expired" || p.status === "refunded") {
    return c.html(
      <Layout title="Objednávka již není aktivní">
        <section class="max-w-md mx-auto px-4 py-16 text-center">
          <h1 class="text-2xl font-bold mb-4">Objednávka již není aktivní</h1>
          <p class="text-gray-600 mb-6">Stav: {p.status === "expired" ? "propadla" : "refundována"}. Vytvořte novou objednávku.</p>
          <a href={p.type === "organization" ? "/checkout/organization" : "/checkout/individual"} class="inline-block bg-indigo-600 text-white px-6 py-3 rounded-lg">Nová objednávka</a>
        </section>
      </Layout>,
      410
    );
  }

  const prices = await getPrices(db);
  const price = p.type === "organization" ? prices.organization : prices.individual;
  const dueDays = Math.round((p.expiresAt.getTime() - p.createdAt.getTime()) / 86400000);
  const isExtended = dueDays > FIO_DEFAULT_DUE_DAYS;
  const spd = generateSPD(PAYMENT_IBAN, price, p.variableSymbol!, `Videokurz ${p.email}`);
  const qrSvg = generateQRSvg(spd);

  let domain: string | undefined;
  if (p.type === "organization") {
    domain = emailDomain(p.email);
  }

  return c.html(
    <Layout title="Platba bankovním převodem">
      <PaymentDetails
        variableSymbol={p.variableSymbol!}
        amount={price}
        account={PAYMENT_ACCOUNT}
        qrSvg={qrSvg}
        type={p.type as "individual" | "organization"}
        email={p.email}
        domain={domain}
        dueDate={formatDueDate(p.expiresAt)}
        isExtended={isExtended}
      />
    </Layout>
  );
});

// ─── Verify endpoint (htmx) ──────────────────────────────────────

checkoutRoutes.post("/api/fio/verify/:vs", async (c) => {
  const vs = c.req.param("vs");
  const db = drizzle(c.env.DB);

  const rateLimitKey = `fio_rate_limit:${vs}`;
  const lastCheck = await c.env.KV.get(rateLimitKey);
  if (lastCheck) {
    const waitMs = FIO_RATE_LIMIT_MS - (Date.now() - Number(lastCheck));
    if (waitMs > 0) {
      return c.html(<VerifyRateLimit waitSeconds={Math.ceil(waitMs / 1000)} />);
    }
  }
  await c.env.KV.put(rateLimitKey, String(Date.now()), { expirationTtl: 60 });

  const rows = await db
    .select()
    .from(purchase)
    .where(eq(purchase.variableSymbol, vs))
    .limit(1);

  if (rows.length === 0) {
    return c.html(<VerifyError message="Objednávka nenalezena." />);
  }
  const p = rows[0];

  if (p.status === "active") {
    return c.html(<VerifySuccess email={p.email} />);
  }
  if (p.status !== "pending") {
    return c.html(<VerifyError message="Objednávka již není aktivní." />);
  }

  const fioRes = await fetchFioTransactions(c.env.FIO_API_TOKEN, FIO_LOOKBACK_DAYS);
  if (!fioRes.ok) {
    if (fioRes.status === 429) {
      return c.html(<VerifyRateLimit waitSeconds={30} />);
    }
    return c.html(<VerifyError message="Dočasně nelze ověřit. Zkuste to za chvíli." />);
  }

  const verifyPrices = await getPrices(db);
  const expectedAmount = p.type === "organization" ? verifyPrices.organization : verifyPrices.individual;
  const match = matchPayment(fioRes.transactions, p.variableSymbol!, expectedAmount);

  if (!match.found || !match.transaction) {
    return c.html(<VerifyNotFound />);
  }

  const now = new Date();
  const newExpiresAt = new Date(now.getTime() + ACCESS_DURATION_DAYS * 86400 * 1000);
  await db
    .update(purchase)
    .set({
      status: "active",
      expiresAt: newExpiresAt,
      fioTransactionId: String(match.transaction.id),
    })
    .where(eq(purchase.id, p.id));

  c.executionCtx.waitUntil(
    sendEmail(c.env, {
      to: p.email,
      subject: "Platba přijata — přihlaste se do kurzu",
      html: purchaseConfirmedHtml(`${c.env.BETTER_AUTH_URL}/login?email=${encodeURIComponent(p.email)}`, p.type as "individual" | "organization"),
    })
  );

  return c.html(<VerifySuccess email={p.email} />);
});

export { checkoutRoutes };
