// Sdílené primitivy pro podepsané bezstavové tokeny (HMAC-SHA256 + base64url +
// constant-time porovnání). Token = `base64url(JSON payload).base64url(HMAC)`.
//
// Doménová separace přes `purpose` prefix: podpis se počítá nad `${purpose}${body}`,
// takže token jednoho účelu (např. výmaz účtu) nelze použít pro jiný (schválení
// článku) ani při sdíleném secretu. Každý volající si drží svůj stabilní prefix.
//
// Tahle utilita sjednocuje dříve duplikované kopie z account-deletion.ts a
// cc-news/approval.ts.

export function base64UrlEncodeBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export const base64UrlEncodeText = (value: string): string =>
  base64UrlEncodeBytes(new TextEncoder().encode(value));

export function base64UrlDecodeText(value: string): string | null {
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

export async function hmacSha256Base64Url(secret: string, body: string): Promise<string> {
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

export function constantTimeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  const length = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;
  for (let i = 0; i < length; i++) diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  return diff === 0;
}

/** Podepíše JSON payload pro daný účel → token `body.sig`. */
export async function signToken(
  secret: string,
  purpose: string,
  payload: unknown
): Promise<string> {
  const body = base64UrlEncodeText(JSON.stringify(payload));
  const sig = await hmacSha256Base64Url(secret, `${purpose}${body}`);
  return `${body}.${sig}`;
}

/**
 * Ověří token pro daný účel: tvar, podpis (constant-time), parsovatelnost JSON.
 * Vrací rozparsovaný payload (jako unknown — volající validuje pole/expiraci),
 * nebo null. Expiraci NEkontroluje (každý účel má vlastní pole/sémantiku).
 */
export async function verifyToken(
  secret: string,
  purpose: string,
  token: string
): Promise<unknown | null> {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  if (!body || !sig) return null;

  const expectedSig = await hmacSha256Base64Url(secret, `${purpose}${body}`);
  if (!constantTimeEqual(sig, expectedSig)) return null;

  const decoded = base64UrlDecodeText(body);
  if (!decoded) return null;
  try {
    return JSON.parse(decoded) as unknown;
  } catch {
    return null;
  }
}
