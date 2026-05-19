import { createMiddleware } from "hono/factory";
import type { Env } from "../types";

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Guards the partner-API endpoints used by vibecoding-site admin to read
 * videokurzy orders. Caller must provide `X-Partner-Key` matching
 * `VIBECODING_PARTNER_KEY`. Separate from AUTH_INTERNAL_SECRET so it can
 * be rotated independently and scoped to read-only data access.
 */
export const requirePartnerKey = createMiddleware<{ Bindings: Env }>(
  async (c, next) => {
    const provided = c.req.header("X-Partner-Key") ?? "";
    const expected = c.env.VIBECODING_PARTNER_KEY ?? "";
    if (!expected || !timingSafeEqual(provided, expected)) {
      return c.json({ error: "forbidden" }, 403);
    }
    await next();
  },
);
