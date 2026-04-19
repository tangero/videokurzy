import { Hono } from "hono";
import type { Env, Variables } from "./types";
import { authMiddleware } from "./middleware/auth";
import { authRoutes } from "./routes/auth";
import { landingRoutes } from "./routes/landing";
import { dashboardRoutes } from "./routes/dashboard";
import { watchRoutes } from "./routes/watch";
import { progressRoutes } from "./routes/progress";
import { stripeRoutes } from "./routes/stripe";
import { checkoutRoutes } from "./routes/checkout";
import { devRoutes } from "./routes/dev";
import { adminRoutes } from "./routes/admin";
import { leadRoutes } from "./routes/leads";
import { handleQueue } from "./queue";
import { handleScheduled } from "./scheduled";
import { PrivacyPage } from "./views/privacy";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// Prepend DOCTYPE to all HTML responses (Hono JSX doesn't add it automatically)
app.use("*", async (c, next) => {
  await next();
  const ct = c.res.headers.get("content-type") ?? "";
  if (ct.includes("text/html")) {
    const body = await c.res.text();
    if (!body.startsWith("<!DOCTYPE")) {
      c.res = new Response("<!DOCTYPE html>" + body, {
        status: c.res.status,
        statusText: c.res.statusText,
        headers: c.res.headers,
      });
    }
  }
});

// Auth middleware on all routes (sets user if logged in)
app.use("*", authMiddleware);

// Routes
app.route("/", authRoutes);
app.route("/", landingRoutes);
app.route("/", dashboardRoutes);
app.route("/", watchRoutes);
app.route("/", progressRoutes);
app.route("/", stripeRoutes);
app.route("/", checkoutRoutes);
app.route("/", devRoutes);
app.route("/", leadRoutes);
app.route("/", adminRoutes);

// Static pages
app.get("/privacy", (c) => c.html(<PrivacyPage />));

// Health check
app.get("/health", (c) => c.json({ status: "ok", version: "0.1.0" }));

export default {
  fetch: app.fetch,
  queue: handleQueue,
  scheduled: handleScheduled,
};
