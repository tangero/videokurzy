import { Hono } from "hono";
import type { Env, Variables } from "./types";
import { authMiddleware } from "./middleware/auth";
import { authRoutes } from "./routes/auth";
import { landingRoutes } from "./routes/landing";
import { dashboardRoutes } from "./routes/dashboard";
import { watchRoutes } from "./routes/watch";
import { progressRoutes } from "./routes/progress";
import { stripeRoutes } from "./routes/stripe";
import { adminRoutes } from "./routes/admin";
import { handleQueue } from "./queue";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// Auth middleware on all routes (sets user if logged in)
app.use("*", authMiddleware);

// Routes
app.route("/", authRoutes);
app.route("/", landingRoutes);
app.route("/", dashboardRoutes);
app.route("/", watchRoutes);
app.route("/", progressRoutes);
app.route("/", stripeRoutes);
app.route("/", adminRoutes);

// Health check
app.get("/health", (c) => c.json({ status: "ok", version: "0.1.0" }));

export default {
  fetch: app.fetch,
  queue: handleQueue,
};
