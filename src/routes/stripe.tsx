import { Hono } from "hono";
import Stripe from "stripe";
import type { Env, Variables } from "../types";

const stripeRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

function getStripe(secretKey: string) {
  return new Stripe(secretKey, { apiVersion: "2025-03-31.basil" });
}

// B2C checkout
stripeRoutes.post("/api/checkout/individual", async (c) => {
  const stripe = getStripe(c.env.STRIPE_SECRET_KEY);

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    payment_method_types: ["card"],
    line_items: [
      {
        price_data: {
          currency: "czk",
          product_data: {
            name: "Videokurz Claude Code s Patrickem — Jednotlivec",
          },
          unit_amount: 200000, // 2000 CZK in hellers
          recurring: { interval: "year" },
        },
        quantity: 1,
      },
    ],
    success_url: `${c.env.BETTER_AUTH_URL}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${c.env.BETTER_AUTH_URL}/#cenik`,
    metadata: {
      type: "individual",
    },
  });

  return c.redirect(session.url!, 303);
});

// B2B checkout
stripeRoutes.post("/api/checkout/organization", async (c) => {
  const stripe = getStripe(c.env.STRIPE_SECRET_KEY);

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    payment_method_types: ["card"],
    line_items: [
      {
        price_data: {
          currency: "czk",
          product_data: {
            name: "Videokurz Claude Code s Patrickem — Firemní licence",
          },
          unit_amount: 1500000, // 15000 CZK in hellers
          recurring: { interval: "year" },
        },
        quantity: 1,
      },
    ],
    custom_fields: [
      {
        key: "domain",
        label: { type: "custom", custom: "Emailová doména firmy (např. firma.cz)" },
        type: "text",
      },
    ],
    success_url: `${c.env.BETTER_AUTH_URL}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${c.env.BETTER_AUTH_URL}/#cenik`,
    metadata: {
      type: "organization",
    },
  });

  return c.redirect(session.url!, 303);
});

// Checkout success page
stripeRoutes.get("/checkout/success", (c) => {
  return c.html(
    <html lang="cs">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Platba proběhla | kurz.vibecoding.cz</title>
        <script src="https://cdn.tailwindcss.com"></script>
      </head>
      <body class="bg-gray-50 min-h-screen flex items-center justify-center">
        <div class="text-center max-w-md px-4">
          <div class="text-4xl mb-4">&#10003;</div>
          <h1 class="text-2xl font-bold mb-2">Platba proběhla!</h1>
          <p class="text-gray-600 mb-6">
            Zkontrolujte svůj email — posíláme vám přihlašovací odkaz k videokurzu.
          </p>
          <a href="/login" class="text-blue-600 hover:underline">
            Přihlásit se
          </a>
        </div>
      </body>
    </html>
  );
});

// Stripe webhook
stripeRoutes.post("/api/webhooks/stripe", async (c) => {
  const stripe = getStripe(c.env.STRIPE_SECRET_KEY);
  const body = await c.req.text();
  const sig = c.req.header("stripe-signature");

  if (!sig) return c.text("Missing signature", 400);

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, c.env.STRIPE_WEBHOOK_SECRET);
  } catch {
    return c.text("Invalid signature", 400);
  }

  // Enqueue for async processing
  await c.env.WEBHOOK_QUEUE.send({
    type: event.type,
    data: event.data.object,
  });

  return c.json({ received: true });
});

export { stripeRoutes };
