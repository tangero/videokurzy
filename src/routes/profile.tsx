import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { authMiddleware, requireAuth } from "../middleware/auth";
import {
  listUserEmails,
  promotePrimary,
  removeUserEmail,
  normalizeEmail,
} from "../lib/user-emails";
import { logIdentityEvent } from "../lib/audit";
import { createAuth } from "../lib/auth";
import { isAllowedCallback } from "../lib/callback-allowlist";
import type { Env, Variables } from "../types";

/**
 * User-facing profile endpoints for managing the email addresses associated
 * with the signed-in account. Session-auth protected (Better Auth cookie).
 *
 * - GET    /api/profile/emails            — list emails
 * - POST   /api/profile/emails            — start verify-add flow (magic link)
 * - PATCH  /api/profile/emails            — promote an email to primary
 * - DELETE /api/profile/emails            — remove a secondary email
 *
 * POST sends a magic link to the new email; the link, once clicked, hits the
 * consumer Worker which calls back into `/internal/auth/verify-add-email` to
 * attach the (now-verified) email to the ORIGINAL user.
 */
const profile = new Hono<{ Bindings: Env; Variables: Variables }>();

profile.use("/api/profile/*", authMiddleware, requireAuth);

profile.get("/api/profile/emails", async (c) => {
  const user = c.get("user")!;
  const db = drizzle(c.env.DB);
  const emails = await listUserEmails(db, user.id);
  return c.json({ emails });
});

profile.post("/api/profile/emails", async (c) => {
  const user = c.get("user")!;
  const body = await c.req
    .json<{ email?: string; callbackUrl?: string }>()
    .catch(() => ({}) as { email?: string; callbackUrl?: string });
  const email = body.email ? normalizeEmail(body.email) : "";
  const callbackUrl = body.callbackUrl;
  if (!email) return c.json({ error: "email required" }, 400);
  if (!callbackUrl || !isAllowedCallback(callbackUrl)) {
    return c.json({ error: "callbackUrl not allowed" }, 400);
  }

  const auth = createAuth(c.env, c.executionCtx);
  // Bake intent + userId into the callback so the consumer knows this verify
  // is for an "add email" flow targeting the ORIGINAL user (not the ad-hoc
  // session created by magicLinkVerify).
  const verifyCallback = new URL(callbackUrl);
  verifyCallback.searchParams.set("intent", "add-email");
  verifyCallback.searchParams.set("userId", user.id);

  try {
    await auth.api.signInMagicLink({
      body: { email, callbackURL: verifyCallback.toString() },
      headers: new Headers(),
    });
  } catch (err) {
    const correlationId = crypto.randomUUID();
    console.warn(JSON.stringify({
      scope: "profile/emails/add",
      event: "magic_link_failed",
      correlationId,
      email,
      message: (err as Error)?.message,
    }));
    return c.json({ error: "send_failed", correlationId }, 502);
  }
  return c.json({ ok: true, pending: true });
});

profile.patch("/api/profile/emails", async (c) => {
  const user = c.get("user")!;
  const body = await c.req
    .json<{ email?: string; promote?: boolean }>()
    .catch(() => ({}) as { email?: string; promote?: boolean });
  if (!body.email || !body.promote) {
    return c.json({ error: "email and promote:true required" }, 400);
  }
  const db = drizzle(c.env.DB);
  try {
    await promotePrimary(db, { userId: user.id, email: body.email });
    await logIdentityEvent(db, {
      userId: user.id,
      action: "email_promoted_primary",
      actor: "self",
      details: { email: normalizeEmail(body.email) },
    });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
  return c.json({ ok: true });
});

profile.delete("/api/profile/emails", async (c) => {
  const user = c.get("user")!;
  const body = await c.req
    .json<{ email?: string }>()
    .catch(() => ({}) as { email?: string });
  if (!body.email) return c.json({ error: "email required" }, 400);
  const db = drizzle(c.env.DB);
  try {
    await removeUserEmail(db, { userId: user.id, email: body.email });
    await logIdentityEvent(db, {
      userId: user.id,
      action: "email_removed",
      actor: "self",
      details: { email: normalizeEmail(body.email) },
    });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
  return c.json({ ok: true });
});

export default profile;
