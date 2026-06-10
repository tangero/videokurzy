// Podepsané tokeny pro dvoukrokové potvrzení self-service výmazu účtu.
//
// Stejný HMAC-SHA256 + base64url + constant-time vzor jako add-email intent
// v routes/internal.tsx. Token je bezstavový (nic se neukládá do DB) — nese
// userId + e-mail + expiraci a podpis nad nimi. Klik na potvrzovací odkaz token
// ověří a teprve pak výmaz provede.

import type { Env } from "../types";

export interface DeletionIntent {
  userId: string;
  email: string;
  expiresAt: number;
}

// Token výmazu platí krátce — je to destruktivní, nevratná akce.
export const DELETION_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minut

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

export async function signDeletionIntent(
  env: Pick<Env, "AUTH_INTERNAL_SECRET">,
  intent: DeletionIntent,
): Promise<string> {
  const body = base64UrlEncodeText(
    JSON.stringify({
      userId: intent.userId,
      email: intent.email.toLowerCase(),
      expiresAt: intent.expiresAt,
    }),
  );
  // Doménová separace klíče: prefix "delete:" zabrání, aby šel token z jiného
  // intentu (add-email) zneužít jako token výmazu i při sdíleném secretu.
  const sig = await hmacSha256Base64Url(env.AUTH_INTERNAL_SECRET, `delete:${body}`);
  return `${body}.${sig}`;
}

export async function verifyDeletionIntent(
  env: Pick<Env, "AUTH_INTERNAL_SECRET">,
  token: string,
): Promise<DeletionIntent | null> {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  if (!body || !sig) return null;

  const expectedSig = await hmacSha256Base64Url(env.AUTH_INTERNAL_SECRET, `delete:${body}`);
  if (!constantTimeEqual(sig, expectedSig)) return null;

  const decoded = base64UrlDecodeText(body);
  if (!decoded) return null;

  let payload: Partial<DeletionIntent>;
  try {
    payload = JSON.parse(decoded) as Partial<DeletionIntent>;
  } catch {
    return null;
  }

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
