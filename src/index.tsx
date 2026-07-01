import { Hono } from "hono";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Env, Variables } from "./types";
import { authMiddleware } from "./middleware/auth";
import { wantsJson, AppError, logServerError } from "./lib/errors";
import { analyticsSnippet } from "./lib/analytics-snippet";
import { ErrorPage } from "./views/error";
import { authRoutes } from "./routes/auth";
import { landingRoutes } from "./routes/landing";
import { dashboardRoutes } from "./routes/dashboard";
import { watchRoutes } from "./routes/watch";
import { watchChybaRoutes } from "./routes/watch-chyba";
import { watchChyba2Routes } from "./routes/watch-chyba2";
import { progressRoutes } from "./routes/progress";
import { stripeRoutes } from "./routes/stripe";
import { checkoutRoutes } from "./routes/checkout";
import { devRoutes } from "./routes/dev";
import { adminRoutes } from "./routes/admin";
import { leadRoutes } from "./routes/leads";
import internalRoutes from "./routes/internal";
import { ccNewsRoutes } from "./routes/cc-news";
import partnerRoutes from "./routes/partner-api";
import profileRoutes from "./routes/profile";
import { handleQueue, handleDlq } from "./queue";
import { handleInvoiceQueue, handleInvoiceDlq } from "./invoice-queue";
import { handleScheduled } from "./scheduled";
import { PrivacyPage } from "./views/privacy";
import { TermsPage } from "./views/terms";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// Prepend DOCTYPE to all HTML responses (Hono JSX doesn't add it automatically).
// Pokud body už začíná s <!DOCTYPE, ponecháme. Vždy ale vytvoříme novou Response,
// protože `c.res.text()` consume body — bez re-create by zůstal prázdný stream
// a Cloudflare worker by vrátil 500 "Worker threw exception".
app.use("*", async (c, next) => {
  await next();
  const ct = c.res.headers.get("content-type") ?? "";
  if (!ct.includes("text/html")) return;
  let body = await c.res.text();

  // Consent lišta + marketingové pixely se vkládají centrálně před </body> všech
  // HTML stránek (pixely se načtou jen po souhlasu — řeší inline loader). Tím se
  // nemusí měnit ~45 call sites <Layout>. Snippet je prázdný, dokud nejsou
  // nakonfigurované pixel IDs (env), takže lokálně/v testech se nevkládá nic.
  const snippet = analyticsSnippet(c.env);
  if (snippet) {
    body = body.includes("</body>")
      ? body.replace("</body>", `${snippet}</body>`)
      : body + snippet;
  }

  const finalBody = body.startsWith("<!DOCTYPE") ? body : "<!DOCTYPE html>" + body;
  c.res = new Response(finalBody, {
    status: c.res.status,
    statusText: c.res.statusText,
    headers: c.res.headers,
  });
});

// Auth middleware on all routes (sets user if logged in)
app.use("*", authMiddleware);

// Routes
app.route("/", authRoutes);
app.route("/", landingRoutes);
app.route("/", dashboardRoutes);
app.route("/", watchRoutes);
app.route("/", watchChybaRoutes);
app.route("/", watchChyba2Routes);
app.route("/", progressRoutes);
app.route("/", stripeRoutes);
app.route("/", checkoutRoutes);
app.route("/", devRoutes);
app.route("/", leadRoutes);
app.route("/", adminRoutes);
app.route("/", ccNewsRoutes); // PŘED internalRoutes — lidský HMAC link, ne service secret
app.route("/", internalRoutes);
app.route("/", partnerRoutes);
app.route("/", profileRoutes);

// Static pages
app.get("/privacy", (c) => c.html(<PrivacyPage />));
app.get("/terms", (c) => c.html(<TermsPage />));

// Health check
app.get("/health", (c) => c.json({ status: "ok", version: "0.1.0" }));

// Test-only routy pro ověření globálního 500 handleru. Guard: jen v testovacím
// prostředí (AUTH_INTERNAL_SECRET má v [env.test.vars] unikátní hodnotu).
// V produkci je secret jiný → handler vrátí 404 a routa fakticky neexistuje.
const isTestEnv = (c: Context<{ Bindings: Env; Variables: Variables }>) =>
  c.env.AUTH_INTERNAL_SECRET === "test-internal-secret";
app.all("/__throw", (c) => {
  if (!isTestEnv(c)) return c.notFound();
  throw new Error("boom");
});
app.all("/api/__throw", (c) => {
  if (!isTestEnv(c)) return c.notFound();
  throw new Error("boom");
});

// Globální chybové HTML (404/500). onError/notFound obcházejí trailing DOCTYPE
// middleware (běží jako top-level dispatch, ne v řetězci), proto si DOCTYPE
// prependujeme sami.
function htmlError(c: Context<{ Bindings: Env; Variables: Variables }>, code: 404 | 500) {
  const user = c.get("user") ?? null;
  const body = "<!DOCTYPE html>" + (<ErrorPage code={code} user={user} />).toString();
  return c.html(body, code);
}

// Neexistující routa
app.notFound((c) => {
  if (wantsJson(c)) return c.json({ error: "not_found" }, 404);
  return htmlError(c, 404);
});

// Neošetřené výjimky z handlerů i middleware
app.onError((err, c) => {
  // htmx: vracet malý fragment, ne celou stránku, ať se do swap targetu nevloží
  // celý <html> (pojistka, kdyby throw přišel z htmx kontextu).
  const isHtmx = c.req.header("HX-Request") === "true";

  if (err instanceof HTTPException) {
    const status = err.status;
    const code = err instanceof AppError ? err.code : "error";

    if (status >= 500) {
      const correlationId = crypto.randomUUID();
      logServerError("http", "exception", { correlationId, status, code, message: err.message });
      if (wantsJson(c)) return c.json({ error: code, correlationId }, status);
      if (isHtmx) return c.html("<p>Došlo k chybě, zkuste to znovu.</p>", status);
      return htmlError(c, 500);
    }

    if (wantsJson(c)) return c.json({ error: code }, status);
    if (isHtmx) return c.html("<p>Došlo k chybě.</p>", status);
    // ErrorPage zná jen 404|500 → ostatní 4xx mapujeme na 404 stránku.
    return htmlError(c, 404);
  }

  const correlationId = crypto.randomUUID();
  logServerError("http", "unhandled", {
    correlationId,
    message: (err as Error)?.message,
    stack: (err as Error)?.stack,
  });
  if (wantsJson(c)) return c.json({ error: "internal_error", correlationId }, 500);
  if (isHtmx) return c.html("<p>Došlo k chybě, zkuste to znovu.</p>", 500);
  return htmlError(c, 500);
});

export default {
  fetch: app.fetch,
  // Jeden queue() export obsluhuje všechny fronty — rozliš podle konkrétního
  // názvu (ne suffixu), ať invoice zprávy nespadnou do webhook handleru.
  queue: (batch: MessageBatch<unknown>, env: Env, _ctx: ExecutionContext) => {
    switch (batch.queue) {
      case "videokurzy-invoices":
        return handleInvoiceQueue(batch as Parameters<typeof handleInvoiceQueue>[0], env);
      case "videokurzy-invoices-dlq":
        return handleInvoiceDlq(batch as Parameters<typeof handleInvoiceDlq>[0], env);
      case "videokurzy-webhooks":
        return handleQueue(batch as Parameters<typeof handleQueue>[0], env);
      case "videokurzy-webhooks-dlq":
        return handleDlq(batch as Parameters<typeof handleDlq>[0], env);
      default:
        // Neznámá fronta — NEsměrovat do webhook handleru (invoice {jobId} zprávy
        // by tam propadly jako neznámý typ a tiše se ACKly). Retry, ať se na chybu
        // přijde a zpráva nezmizí.
        console.error(`[queue] neznámá fronta '${batch.queue}' — retry všech zpráv`);
        for (const message of batch.messages) message.retry();
        return;
    }
  },
  scheduled: handleScheduled,
};
