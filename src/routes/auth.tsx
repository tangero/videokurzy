import { Hono } from "hono";
import type { Env, Variables } from "../types";
import { createAuth } from "../lib/auth";
import { LoginPage } from "../views/login";
import { MagicLinkSentPage } from "../views/login";

const auth = new Hono<{ Bindings: Env; Variables: Variables }>();

// Better Auth handler — handles all /api/auth/* routes
auth.all("/api/auth/*", async (c) => {
  const authInstance = createAuth(c.env, c.executionCtx);
  return authInstance.handler(c.req.raw);
});

// Login page
auth.get("/login", (c) => {
  const user = c.get("user");
  if (user) {
    return c.redirect("/dashboard");
  }
  return c.html(<LoginPage />);
});

// Magic link sent confirmation
auth.get("/login/sent", (c) => {
  return c.html(<MagicLinkSentPage />);
});

// Logout
auth.post("/logout", async (c) => {
  const authInstance = c.get("auth");
  await authInstance.api.signOut({
    headers: c.req.raw.headers,
  });
  return c.redirect("/");
});

export { auth as authRoutes };
