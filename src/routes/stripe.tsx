import { Hono } from "hono";
import Stripe from "stripe";
import type { Env, Variables } from "../types";
import { sklikConversionSnippetFor } from "../lib/analytics-snippet";

const stripeRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

function getStripe(secretKey: string) {
  return new Stripe(secretKey, { apiVersion: "2026-03-25.dahlia" });
}

// Legacy endpointy — přesměrovat na novou mezistránku (/checkout/*) s výběrem platební metody.
// Ponecháno pro případ cached linků z emailů nebo externích integrací.
stripeRoutes.post("/api/checkout/individual", (c) => c.redirect("/checkout/individual", 303));
stripeRoutes.get("/api/checkout/individual", (c) => c.redirect("/checkout/individual", 303));
stripeRoutes.post("/api/checkout/organization", (c) => c.redirect("/checkout/organization", 303));
stripeRoutes.get("/api/checkout/organization", (c) => c.redirect("/checkout/organization", 303));

// Checkout success page
stripeRoutes.get("/checkout/success", async (c) => {
  // Sklik conversionHit: hodnotu bereme z ověřené Stripe session (autoritativní,
  // řeší race i fingování). conversionHit jen když je session reálně zaplacená.
  let sklik = "";
  const sessionId = c.req.query("session_id");
  if (sessionId) {
    try {
      const stripe = getStripe(c.env.STRIPE_SECRET_KEY);
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      if (session.payment_status === "paid") {
        const valueCzk = Math.round((session.amount_total ?? 0) / 100);
        const email = session.customer_details?.email ?? session.customer_email ?? null;
        sklik = await sklikConversionSnippetFor(c.env, { value: valueCzk, orderId: sessionId, email });
      }
    } catch (err) {
      console.error("[sklik] success page session retrieve failed:", err);
    }
  }

  return c.html(
    <html lang="cs">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Platba proběhla | kurzy.vibecoding.cz</title>
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
        {sklik && <div dangerouslySetInnerHTML={{ __html: sklik }} />}
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
    // constructEventAsync (ne sync) je nutné v Cloudflare Workers —
    // Stripe SDK v11+ používá Web Crypto (SubtleCrypto), která je async-only.
    event = await stripe.webhooks.constructEventAsync(body, sig, c.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("Stripe webhook signature verification failed:", err);
    return c.text("Invalid signature", 400);
  }

  // Enqueue for async processing. eventId/eventCreated se nesou kvůli fakturaci
  // (paidAt z času Stripe události, ne z času běhu konzumenta).
  await c.env.WEBHOOK_QUEUE.send({
    type: event.type,
    data: event.data.object,
    eventId: event.id,
    eventCreated: event.created,
  });

  return c.json({ received: true });
});

export { stripeRoutes };
