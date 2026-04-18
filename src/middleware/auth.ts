import { createMiddleware } from "hono/factory";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import type { Env, Variables } from "../types";
import { createAuth } from "../lib/auth";
import { linkPurchasesToUser } from "../lib/access";
import { user } from "../db/schema";
import { ADMIN_EMAILS } from "../config/admin";

const ADMIN_EMAIL_SET = new Set<string>(ADMIN_EMAILS);

export const authMiddleware = createMiddleware<{
  Bindings: Env;
  Variables: Variables;
}>(async (c, next) => {
  const auth = createAuth(c.env, c.executionCtx);
  c.set("auth", auth);

  const session = await auth.api.getSession({
    headers: c.req.raw.headers,
  });

  if (session?.user) {
    const email = session.user.email;
    const currentRole = (session.user as Record<string, unknown>).role as string ?? "user";
    const shouldPromote = ADMIN_EMAIL_SET.has(email) && currentRole !== "admin";
    const effectiveRole = shouldPromote ? "admin" : currentRole;

    const userObj = {
      id: session.user.id,
      email,
      name: session.user.name ?? null,
      role: effectiveRole,
    };
    c.set("user", userObj);

    const db = drizzle(c.env.DB);

    if (shouldPromote) {
      c.executionCtx.waitUntil(
        db.update(user).set({ role: "admin" }).where(eq(user.id, userObj.id)).catch(() => {})
      );
    }

    c.executionCtx.waitUntil(
      linkPurchasesToUser(userObj.id, userObj.email, db).catch(() => {})
    );
  } else {
    c.set("user", null);
  }

  await next();
});

export const requireAuth = createMiddleware<{
  Bindings: Env;
  Variables: Variables;
}>(async (c, next) => {
  const user = c.get("user");

  if (!user) {
    const isHtmx = c.req.header("HX-Request") === "true";
    if (isHtmx) {
      c.header("HX-Redirect", "/login");
      return c.body(null, 200);
    }
    return c.redirect("/login");
  }

  await next();
});

export const requireAdmin = createMiddleware<{
  Bindings: Env;
  Variables: Variables;
}>(async (c, next) => {
  const user = c.get("user");

  if (!user || user.role !== "admin") {
    return c.text("Forbidden", 403);
  }

  await next();
});
