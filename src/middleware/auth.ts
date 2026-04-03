import { createMiddleware } from "hono/factory";
import { drizzle } from "drizzle-orm/d1";
import type { Env, Variables } from "../types";
import { createAuth } from "../lib/auth";
import { linkPurchasesToUser } from "../lib/access";

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
    const userObj = {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name ?? null,
      role: (session.user as Record<string, unknown>).role as string ?? "user",
    };
    c.set("user", userObj);

    // Link any unlinked purchases to this user (fire-and-forget)
    const db = drizzle(c.env.DB);
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
