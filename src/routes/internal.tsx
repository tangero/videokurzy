import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { and, desc, eq } from "drizzle-orm";
import { createAuth } from "../lib/auth";
import { isAllowedCallback } from "../lib/callback-allowlist";
import { requireInternalSecret } from "../middleware/internal-auth";
import { addUserEmail, normalizeEmail } from "../lib/user-emails";
import { logIdentityEvent } from "../lib/audit";
import { purchase } from "../db/schema";
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

export interface AddEmailIntentPayload {
  userId: string;
  email: string;
  expiresAt: number;
}

function base64UrlEncodeBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlEncodeText(value: string): string {
  return base64UrlEncodeBytes(new TextEncoder().encode(value));
}

function base64UrlDecodeText(value: string): string | null {
  try {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

async function hmacSha256Base64Url(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return base64UrlEncodeBytes(new Uint8Array(sig));
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  const length = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;
  for (let i = 0; i < length; i++) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return diff === 0;
}

export async function signAddEmailIntent(
  env: Pick<Env, "AUTH_INTERNAL_SECRET">,
  payload: AddEmailIntentPayload,
): Promise<string> {
  const body = base64UrlEncodeText(JSON.stringify({
    userId: payload.userId,
    email: normalizeEmail(payload.email),
    expiresAt: payload.expiresAt,
  }));
  const sig = await hmacSha256Base64Url(env.AUTH_INTERNAL_SECRET, body);
  return `${body}.${sig}`;
}

export async function verifyAddEmailIntent(
  env: Pick<Env, "AUTH_INTERNAL_SECRET">,
  token: string,
): Promise<AddEmailIntentPayload | null> {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  if (!body || !sig) return null;

  const expectedSig = await hmacSha256Base64Url(env.AUTH_INTERNAL_SECRET, body);
  if (!constantTimeEqual(sig, expectedSig)) return null;

  const decoded = base64UrlDecodeText(body);
  if (!decoded) return null;

  let payload: Partial<AddEmailIntentPayload>;
  try {
    payload = JSON.parse(decoded) as Partial<AddEmailIntentPayload>;
  } catch {
    return null;
  }

  if (!payload.userId || !payload.email || typeof payload.expiresAt !== "number") return null;
  if (payload.expiresAt < Date.now()) return null;

  return {
    userId: payload.userId,
    email: normalizeEmail(payload.email),
    expiresAt: payload.expiresAt,
  };
}

export const signAddEmailIntentForTest = signAddEmailIntent;
export const verifyAddEmailIntentForTest = verifyAddEmailIntent;

async function validateMagicLinkToken(
  env: Env,
  token: string,
): Promise<"valid" | "invalid"> {
  const row = await env.DB.prepare(
    "SELECT expiresAt FROM verification WHERE identifier = ?",
  )
    .bind(token)
    .first<{ expiresAt: number }>();

  if (!row) return "invalid";

  if (Number(row.expiresAt) < Date.now()) {
    await env.DB.prepare("DELETE FROM verification WHERE identifier = ?")
      .bind(token)
      .run();
    return "invalid";
  }

  return "valid";
}

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

  if ((await validateMagicLinkToken(c.env, body.token)) === "invalid") {
    const correlationId = crypto.randomUUID();
    console.warn(JSON.stringify({
      scope: "internal/verify-token",
      event: "invalid_or_expired_token",
      correlationId,
    }));
    return c.json({ error: "invalid_token", correlationId }, 401);
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
 * Attaches a magic-link-verified email to the userId carried by a signed
 * add-email intent. The optional body.userId is only a compatibility check.
 */
internal.post("/internal/auth/verify-add-email", async (c) => {
  const body = await c.req
    .json<{ token?: string; userId?: string; intent?: string }>()
    .catch(() => ({}) as { token?: string; userId?: string; intent?: string });
  if (!body.token) {
    return c.json({ error: "token required" }, 400);
  }

  if ((await validateMagicLinkToken(c.env, body.token)) === "invalid") {
    const correlationId = crypto.randomUUID();
    console.warn(JSON.stringify({
      scope: "internal/verify-add-email",
      event: "invalid_or_expired_token",
      correlationId,
    }));
    return c.json({ error: "invalid_token", correlationId }, 401);
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

    if (!body.intent) {
      return c.json({ error: "intent required" }, 400);
    }
    const intent = await verifyAddEmailIntent(c.env, body.intent);
    if (!intent) {
      const correlationId = crypto.randomUUID();
      console.warn(JSON.stringify({
        scope: "internal/verify-add-email",
        event: "invalid_intent",
        correlationId,
      }));
      return c.json({ error: "invalid_intent", correlationId }, 401);
    }
    if (body.userId && body.userId !== intent.userId) {
      return c.json({ error: "user_mismatch" }, 401);
    }
    const verifiedEmail = normalizeEmail(session.user.email);
    if (normalizeEmail(intent.email) !== verifiedEmail) {
      return c.json({ error: "email_mismatch" }, 401);
    }

    const db = drizzle(c.env.DB);
    try {
      await addUserEmail(db, {
        userId: intent.userId,
        email: verifiedEmail,
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
      userId: intent.userId,
      action: "email_added",
      actor: "self",
      details: { email: verifiedEmail },
    });

    // Revoke the ad-hoc session created by verify. Consumer keeps the
    // primary-user session cookie; silently swallow errors — best-effort.
    await auth.api
      .signOut({ headers: result.headers })
      .catch(() => {});

    return c.json({ ok: true, email: verifiedEmail });
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

/**
 * List active enrollments (purchases) for the caller's session. Consumer
 * worker on vibecoding.cz queries this for the /profil/kurzy dashboard.
 */
internal.get("/internal/user/enrollments", async (c) => {
  const auth = createAuth(c.env, c.executionCtx);
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session?.user) return c.json({ error: "unauthenticated" }, 401);

  const db = drizzle(c.env.DB);
  const now = new Date();
  const rows = await db
    .select()
    .from(purchase)
    .where(and(eq(purchase.userId, session.user.id), eq(purchase.status, "active")))
    .orderBy(desc(purchase.createdAt))
    .all();

  const enrollments = rows
    .filter((r) => !r.expiresAt || r.expiresAt > now)
    .map((r) => ({
      id: String(r.id),
      title: "Claude Code s Patrickem",
      meta: r.expiresAt
        ? `Aktivní do ${r.expiresAt.toLocaleDateString("cs-CZ")}`
        : "Aktivní",
      type: r.type,
      expiresAt: r.expiresAt,
    }));

  return c.json({ enrollments });
});

/**
 * Trigger FIO payment scan. Guarded by X-Internal-Secret. Vrátí počty
 * spárovaných / nezískaných objednávek + případné chyby. Hodí se pro:
 *  - Ruční znovuzpracování (např. po výpadku denního cronu).
 *  - Debugging FIO matchování během vývoje.
 */
internal.post("/internal/fio/scan", async (c) => {
  const { scanFioPayments } = await import("../scheduled");
  const db = drizzle(c.env.DB);
  try {
    const result = await scanFioPayments(db, c.env);
    return c.json({ ok: true, ...result });
  } catch (err) {
    return c.json({ ok: false, error: (err as Error).message }, 500);
  }
});

export default internal;
