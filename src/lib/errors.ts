import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";

// Globální error handling — pomocné funkce a doménové chybové třídy.
// Použití: viz app.onError / app.notFound v src/index.tsx.

// Rozlišení formátu chybové odpovědi podle prefixu cesty:
// /api/ a /internal/ → JSON; vše ostatní → HTML stránka (ErrorPage).
export function wantsJson(c: Context): boolean {
  const p = new URL(c.req.url).pathname;
  return p.startsWith("/api/") || p.startsWith("/internal/");
}

// Doménové chyby jako tenké subclassy HTTPException. Hono je zachytí i bez
// onError (vrátí jejich .getResponse()), takže i kdyby onError selhal, nepadne
// to do holého 500.
//   `code`   — strojový identifikátor → jde do JSON { error: code }
//   `expose` — smí se lidská message ukázat klientovi? (default ne, kvůli leaku)
export class AppError extends HTTPException {
  readonly code: string;
  readonly expose: boolean;
  constructor(
    status: ContentfulStatusCode,
    code: string,
    opts?: { message?: string; expose?: boolean }
  ) {
    super(status, { message: opts?.message ?? code });
    this.code = code;
    this.expose = opts?.expose ?? false;
  }
}

export class NotFoundError extends AppError {
  constructor(message?: string) {
    super(404, "not_found", { message, expose: true });
  }
}

export class ValidationError extends AppError {
  constructor(code = "invalid_request", message?: string) {
    super(400, code, { message, expose: true });
  }
}

// Jednotný log serverových (5xx) chyb. Zachovává tvar klíčů scope/event/...,
// který už používají internal.tsx a profile.tsx.
export function logServerError(
  scope: string,
  event: string,
  fields: Record<string, unknown>
): void {
  console.warn(JSON.stringify({ scope, event, ...fields }));
}
