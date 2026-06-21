// Podepsané tokeny pro dvoukrokové potvrzení self-service výmazu účtu.
//
// Bezstavový HMAC token (nic se neukládá do DB) přes sdílenou utilitu
// lib/signed-token.ts — nese userId + e-mail + expiraci a podpis nad nimi.
// Klik na potvrzovací odkaz token ověří a teprve pak výmaz provede. Doménová
// separace prefixem „delete:" odděluje od ostatních token-typů.

import type { Env } from "../types";
import { signToken, verifyToken } from "./signed-token";

const DELETION_PURPOSE = "delete:";

export interface DeletionIntent {
  userId: string;
  email: string;
  expiresAt: number;
}

// Token výmazu platí krátce — je to destruktivní, nevratná akce.
export const DELETION_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minut

export async function signDeletionIntent(
  env: Pick<Env, "AUTH_INTERNAL_SECRET">,
  intent: DeletionIntent,
): Promise<string> {
  return signToken(env.AUTH_INTERNAL_SECRET, DELETION_PURPOSE, {
    userId: intent.userId,
    email: intent.email.toLowerCase(),
    expiresAt: intent.expiresAt,
  });
}

export async function verifyDeletionIntent(
  env: Pick<Env, "AUTH_INTERNAL_SECRET">,
  token: string,
): Promise<DeletionIntent | null> {
  const payload = (await verifyToken(env.AUTH_INTERNAL_SECRET, DELETION_PURPOSE, token)) as
    | Partial<DeletionIntent>
    | null;
  if (!payload) return null;
  if (!payload.userId || !payload.email || typeof payload.expiresAt !== "number") {
    return null;
  }
  if (payload.expiresAt < Date.now()) return null;

  return {
    userId: payload.userId,
    email: payload.email.toLowerCase(),
    expiresAt: payload.expiresAt,
  };
}
