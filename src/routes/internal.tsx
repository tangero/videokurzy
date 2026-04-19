import { Hono } from "hono";
import { createAuth } from "../lib/auth";
import { isAllowedCallback } from "../lib/callback-allowlist";
import { requireInternalSecret } from "../middleware/internal-auth";
import type { Env } from "../types";

/**
 * Internal (service-to-service) endpoints, guarded by `X-Internal-Secret` header.
 *
 * `/internal/auth/magic-link` lets the consumer Worker trigger a magic-link
 * email for a user. It validates the callback URL against the allowlist before
 * delegating to Better Auth; the callback is then baked into the magic link so
 * the user lands on the intended destination after verification.
 */
const internal = new Hono<{ Bindings: Env }>();

internal.use("/internal/*", requireInternalSecret);

internal.post("/internal/auth/magic-link", async (c) => {
  const body = await c.req
    .json<{ email?: string; callbackUrl?: string }>()
    .catch(() => ({}) as { email?: string; callbackUrl?: string });

  const email = body.email?.trim().toLowerCase();
  const callbackUrl = body.callbackUrl;

  if (!email || !callbackUrl) {
    return c.json({ error: "email and callbackUrl required" }, 400);
  }
  if (!isAllowedCallback(callbackUrl)) {
    return c.json({ error: "callbackUrl not allowed" }, 400);
  }

  const auth = createAuth(c.env, c.executionCtx);
  try {
    await auth.api.signInMagicLink({
      body: { email, callbackURL: callbackUrl },
      headers: new Headers(),
    });
  } catch (err) {
    console.warn("[internal/magic-link] send failed", err);
    return c.json({ error: "send_failed" }, 502);
  }
  return c.json({ ok: true });
});

export default internal;
