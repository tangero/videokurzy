// Podepsaný JEDNORÁZOVÝ schvalovací token pro článek „Novinky v Claude Code"
// (W-005, R4). Bezstavový podpis nad (itemId, nonce, expiresAt) přes sdílenou
// utilitu lib/signed-token.ts. Doménová separace prefixem „cc-news-approve:"
// zabrání záměně s jinými tokeny (výmaz účtu, add-email, odhlášení) i při
// sdíleném secretu.
//
// Jednorázovost se VYNUCUJE přes `approveNonce` na řádce cc_news_item: token
// nese nonce, schválení ho porovná s DB a po publikaci nonce smaže — druhý klik
// stejného linku už neprojde. Odhlašovací token má vlastní prefix
// „cc-news-unsub:", aby ho nešlo použít ke schválení.

import type { Env } from "../../types";
import { signToken, verifyToken } from "../signed-token";

export interface ApprovalIntent {
  itemId: string;
  nonce: string;
  expiresAt: number;
}

// Schvalovací link platí omezeně (redakční smyčka je v řádu dní, ne minut).
export const APPROVAL_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 dní
const APPROVE_PURPOSE = "cc-news-approve:";
const UNSUB_PURPOSE = "cc-news-unsub:";

type SecretEnv = Pick<Env, "AUTH_INTERNAL_SECRET">;

/** Podepíše schvalovací intent → token `body.sig`. */
export async function signApprovalIntent(
  env: SecretEnv,
  intent: ApprovalIntent
): Promise<string> {
  return signToken(env.AUTH_INTERNAL_SECRET, APPROVE_PURPOSE, {
    itemId: intent.itemId,
    nonce: intent.nonce,
    expiresAt: intent.expiresAt,
  });
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
  const payload = (await verifyToken(env.AUTH_INTERNAL_SECRET, APPROVE_PURPOSE, token)) as
    | Partial<ApprovalIntent>
    | null;
  if (!payload) return null;
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
export async function signUnsubToken(env: SecretEnv, email: string): Promise<string> {
  return signToken(env.AUTH_INTERNAL_SECRET, UNSUB_PURPOSE, {
    email: email.trim().toLowerCase(),
  });
}

export async function verifyUnsubToken(env: SecretEnv, token: string): Promise<string | null> {
  const payload = (await verifyToken(env.AUTH_INTERNAL_SECRET, UNSUB_PURPOSE, token)) as
    | { email?: string }
    | null;
  if (!payload?.email) return null;
  return payload.email.trim().toLowerCase();
}
