import { Hono } from "hono";
import type { Env, Variables } from "./types";
import { authMiddleware } from "./middleware/auth";
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
import partnerRoutes from "./routes/partner-api";
import profileRoutes from "./routes/profile";
import { handleQueue } from "./queue";
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
  const body = await c.res.text();
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
app.route("/", internalRoutes);
app.route("/", partnerRoutes);
app.route("/", profileRoutes);

// Static pages
app.get("/privacy", (c) => c.html(<PrivacyPage />));
app.get("/terms", (c) => c.html(<TermsPage />));

// Health check
app.get("/health", (c) => c.json({ status: "ok", version: "0.1.0" }));

export default {
  fetch: app.fetch,
  queue: handleQueue,
  scheduled: handleScheduled,
};
