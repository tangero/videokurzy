import { createMiddleware } from "hono/factory";
import type { Env } from "../types";

/**
 * Timing-safe string comparison. Avoids short-circuit leaks that
 * reveal secret length or prefix via response timing.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Guards service-to-service endpoints. Caller must provide
 * `X-Internal-Secret` header matching `AUTH_INTERNAL_SECRET` env var.
 * Rejects with 403 (never reveals why — just "forbidden").
 */
export const requireInternalSecret = createMiddleware<{ Bindings: Env }>(
  async (c, next) => {
    const provided = c.req.header("X-Internal-Secret") ?? "";
    const expected = c.env.AUTH_INTERNAL_SECRET ?? "";
    if (!expected || !timingSafeEqual(provided, expected)) {
      return c.json({ error: "forbidden" }, 403);
    }
    await next();
  },
);
