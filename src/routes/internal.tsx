import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { createAuth } from "../lib/auth";
import { isAllowedCallback } from "../lib/callback-allowlist";
import { requireInternalSecret } from "../middleware/internal-auth";
import { addUserEmail } from "../lib/user-emails";
import { logIdentityEvent } from "../lib/audit";
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
    const status = (err as { status?: number; statusCode?: number }).status
      ?? (err as { statusCode?: number }).statusCode
      ?? 502;
    const correlationId = crypto.randomUUID();
    console.warn(JSON.stringify({
      scope: "internal/magic-link",
      event: "send_failed",
      correlationId,
      email,
      status,
      message: (err as Error)?.message,
    }));
    // Relay 4xx from auth library (rate limit, invalid input); upstream 5xx stays 502
    const outStatus = status >= 400 && status < 500 ? (status as 400 | 401 | 403 | 429) : 502;
    return c.json({ error: "send_failed", correlationId }, outStatus);
  }
  return c.json({ ok: true });
});

internal.post("/internal/auth/verify-token", async (c) => {
  const body = await c.req
    .json<{ token?: string }>()
    .catch(() => ({}) as { token?: string });
  if (!body.token) {
    return c.json({ error: "token required" }, 400);
  }

  const auth = createAuth(c.env, c.executionCtx);
  try {
    const result = await auth.api.magicLinkVerify({
      query: { token: body.token },
      headers: new Headers(),
      asResponse: true,
    });
    const setCookie = result.headers.get("set-cookie");
    // result.headers contains the Set-Cookie from magic-link verify; Better Auth
    // uses it to read the fresh session on the follow-up getSession call.
    const session = await auth.api.getSession({ headers: result.headers });
    if (!session?.user) {
      const correlationId = crypto.randomUUID();
      console.warn(JSON.stringify({
        scope: "internal/verify-token",
        event: "no_session_after_verify",
        correlationId,
      }));
      return c.json({ error: "invalid_token", correlationId }, 401);
    }
    return c.json({
      user: {
        id: session.user.id,
        email: session.user.email,
        name: session.user.name ?? null,
        role: (session.user as { role?: string }).role ?? "user",
      },
      sessionToken: session.session.token,
      expiresAt: session.session.expiresAt,
      setCookie,
    });
  } catch (err) {
    const status = (err as { status?: number; statusCode?: number }).status
      ?? (err as { statusCode?: number }).statusCode
      ?? 401;
    const correlationId = crypto.randomUUID();
    console.warn(JSON.stringify({
      scope: "internal/verify-token",
      event: "verify_failed",
      correlationId,
      status,
      message: (err as Error)?.message,
    }));
    return c.json({ error: "invalid_token", correlationId }, 401);
  }
});

internal.get("/internal/auth/me", async (c) => {
  const auth = createAuth(c.env, c.executionCtx);
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session?.user) return c.json({ error: "unauthenticated" }, 401);
  return c.json({
    user: {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name ?? null,
      role: (session.user as { role?: string }).role ?? "user",
    },
    expiresAt: session.session.expiresAt,
  });
});

internal.post("/internal/auth/revoke", async (c) => {
  const auth = createAuth(c.env, c.executionCtx);
  try {
    const res = await auth.api.signOut({
      headers: c.req.raw.headers,
      asResponse: true,
    });
    const setCookie = res.headers.get("set-cookie");
    return c.json({ ok: true, setCookie });
  } catch (err) {
    // Idempotent: "no session" is an expected state. Still log so real
    // failures (DB outage, Better Auth internal crash) are traceable.
    const correlationId = crypto.randomUUID();
    console.warn(JSON.stringify({
      scope: "internal/revoke",
      event: "signout_failed_or_no_session",
      correlationId,
      message: (err as Error)?.message,
    }));
    return c.json({ ok: true, setCookie: null });
  }
});

/**
 * Verify a magic-link token that was sent to confirm ownership of a
 * secondary email. Unlike /internal/auth/verify-token, we do NOT want to
 * create a new session for the verified email — instead we attach the
 * email to the ORIGINAL user (body.userId) and then revoke the ad-hoc
 * session Better Auth creates during verify.
 *
 * Consumer flow:
 *  1. User (signed in as A) calls POST /api/profile/emails with email B.
 *  2. Magic link sent to B. Callback URL includes `intent=add-email` and
 *     `userId=A`.
 *  3. Consumer Worker receives the callback, detects intent, and calls this
 *     endpoint with the token and userId=A.
 *  4. We verify the token (proves B ownership), attach B to user A, and
 *     throw away the temp session. The user remains signed in as A.
 */
internal.post("/internal/auth/verify-add-email", async (c) => {
  const body = await c.req
    .json<{ token?: string; userId?: string }>()
    .catch(() => ({}) as { token?: string; userId?: string });
  if (!body.token || !body.userId) {
    return c.json({ error: "token and userId required" }, 400);
  }

  const auth = createAuth(c.env, c.executionCtx);
  try {
    const result = await auth.api.magicLinkVerify({
      query: { token: body.token },
      headers: new Headers(),
      asResponse: true,
    });
    const session = await auth.api.getSession({ headers: result.headers });
    if (!session?.user) {
      const correlationId = crypto.randomUUID();
      console.warn(JSON.stringify({
        scope: "internal/verify-add-email",
        event: "no_session_after_verify",
        correlationId,
      }));
      return c.json({ error: "invalid_token", correlationId }, 401);
    }

    const db = drizzle(c.env.DB);
    try {
      await addUserEmail(db, {
        userId: body.userId,
        email: session.user.email,
        via: "self-add",
        verified: true,
      });
    } catch (err) {
      const correlationId = crypto.randomUUID();
      console.warn(JSON.stringify({
        scope: "internal/verify-add-email",
        event: "add_email_failed",
        correlationId,
        message: (err as Error)?.message,
      }));
      return c.json({ error: "add_failed", correlationId }, 400);
    }

    await logIdentityEvent(db, {
      userId: body.userId,
      action: "email_added",
      actor: "self",
      details: { email: session.user.email },
    });

    // Revoke the ad-hoc session created by verify. Consumer keeps the
    // primary-user session cookie; silently swallow errors — best-effort.
    await auth.api
      .signOut({ headers: result.headers })
      .catch(() => {});

    return c.json({ ok: true, email: session.user.email });
  } catch (err) {
    const correlationId = crypto.randomUUID();
    console.warn(JSON.stringify({
      scope: "internal/verify-add-email",
      event: "verify_failed",
      correlationId,
      message: (err as Error)?.message,
    }));
    return c.json({ error: "verify_failed", correlationId }, 401);
  }
});

export default internal;
