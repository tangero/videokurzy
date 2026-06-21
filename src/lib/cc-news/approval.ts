// Podepsaný JEDNORÁZOVÝ schvalovací token pro článek „Novinky v Claude Code"
// (W-005, R4). Stejný HMAC-SHA256 + base64url + constant-time vzor jako
// lib/account-deletion.ts; token je bezstavový podpis nad (itemId, nonce,
// expiresAt). Doménová separace klíče prefixem „cc-news-approve:" zabrání
// záměně s jinými tokeny (výmaz účtu, add-email) i při sdíleném secretu.
//
// Jednorázovost se VYNUCUJE přes `approveNonce` na řádce cc_news_item: token
// nese nonce, schválení ho porovná s DB a po publikaci nonce smaže — druhý klik
// stejného linku už neprojde. Odhlašovací token (W-007) bude mít vlastní prefix
// „cc-news-unsub:", aby ho nešlo použít ke schválení.

import type { Env } from "../../types";

export interface ApprovalIntent {
  itemId: string;
  nonce: string;
  expiresAt: number;
}

// Schvalovací link platí omezeně (redakční smyčka je v řádu dní, ne minut).
export const APPROVAL_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 dní
const PURPOSE = "cc-news-approve:";

function base64UrlEncodeBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

const base64UrlEncodeText = (value: string): string =>
  base64UrlEncodeBytes(new TextEncoder().encode(value));

function base64UrlDecodeText(value: string): string | null {
  try {
    const padded = value
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(Math.ceil(value.length / 4) * 4, "=");
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
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return base64UrlEncodeBytes(new Uint8Array(sig));
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  const length = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;
  for (let i = 0; i < length; i++) diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  return diff === 0;
}

type SecretEnv = Pick<Env, "AUTH_INTERNAL_SECRET">;

/** Podepíše schvalovací intent → token `body.sig`. */
export async function signApprovalIntent(
  env: SecretEnv,
  intent: ApprovalIntent
): Promise<string> {
  const body = base64UrlEncodeText(
    JSON.stringify({
      itemId: intent.itemId,
      nonce: intent.nonce,
      expiresAt: intent.expiresAt,
    })
  );
  const sig = await hmacSha256Base64Url(env.AUTH_INTERNAL_SECRET, `${PURPOSE}${body}`);
  return `${body}.${sig}`;
}

/**
 * Ověří token: tvar, podpis (constant-time), platnost JSON a expiraci. Vrací
 * intent, nebo null. NEověřuje jednorázovost — tu zajistí porovnání `nonce`
 * proti DB řádce při schválení (viz draft.ts / route).
 */
export async function verifyApprovalIntent(
  env: SecretEnv,
  token: string,
  now: number = Date.now()
): Promise<ApprovalIntent | null> {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  if (!body || !sig) return null;

  const expectedSig = await hmacSha256Base64Url(env.AUTH_INTERNAL_SECRET, `${PURPOSE}${body}`);
  if (!constantTimeEqual(sig, expectedSig)) return null;

  const decoded = base64UrlDecodeText(body);
  if (!decoded) return null;

  let payload: Partial<ApprovalIntent>;
  try {
    payload = JSON.parse(decoded) as Partial<ApprovalIntent>;
  } catch {
    return null;
  }

  if (!payload.itemId || !payload.nonce || typeof payload.expiresAt !== "number") {
    return null;
  }
  if (payload.expiresAt < now) return null;

  return { itemId: payload.itemId, nonce: payload.nonce, expiresAt: payload.expiresAt };
}

// ---------------------------------------------------------------------------
// Odhlašovací token (W-007, GDPR). ODDĚLENÝ účel od schválení — token pro jednu
// akci nelze použít k druhé. Nese normalizovaný e-mail; klik vloží suppression.
// Bez expirace (odhlásit se musí jít kdykoli z libovolně starého e-mailu).
// ---------------------------------------------------------------------------
const UNSUB_PURPOSE = "cc-news-unsub:";

export async function signUnsubToken(env: SecretEnv, email: string): Promise<string> {
  const body = base64UrlEncodeText(JSON.stringify({ email: email.trim().toLowerCase() }));
  const sig = await hmacSha256Base64Url(env.AUTH_INTERNAL_SECRET, `${UNSUB_PURPOSE}${body}`);
  return `${body}.${sig}`;
}

export async function verifyUnsubToken(env: SecretEnv, token: string): Promise<string | null> {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  if (!body || !sig) return null;

  const expectedSig = await hmacSha256Base64Url(env.AUTH_INTERNAL_SECRET, `${UNSUB_PURPOSE}${body}`);
  if (!constantTimeEqual(sig, expectedSig)) return null;

  const decoded = base64UrlDecodeText(body);
  if (!decoded) return null;
  try {
    const payload = JSON.parse(decoded) as { email?: string };
    return payload.email ? payload.email.trim().toLowerCase() : null;
  } catch {
    return null;
  }
}
