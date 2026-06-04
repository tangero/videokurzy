import { Hono } from "hono";
import type { Env, Variables } from "../types";
import { sendResendEvent } from "../lib/resend";

const leadRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// Per-IP rate limit (Finding 19): leads endpointy mají jen KV dedup podle emailu,
// nemají per-IP limit — každé odeslání spustí Resend event → email bombing.
// Povol 5 požadavků za minutu na (IP, scope), 6. zablokuj. Scope drží nezávislé
// kbelíky pro jednotlivé endpointy.
async function checkIpRateLimit(
  env: Env,
  ip: string,
  scope: string,
): Promise<boolean> {
  const key = `leads_rate:${scope}:${ip}`;
  const count = Number((await env.KV.get(key)) ?? "0");
  if (count >= 5) return false;
  await env.KV.put(key, String(count + 1), { expirationTtl: 60 });
  return true;
}

/**
 * Email capture for non-logged-in users after completing free preview.
 * Fires a Resend Automation event and deduplicates via KV.
 */
leadRoutes.post("/api/leads/preview-completed", async (c) => {
  const body = await c.req.parseBody();
  const email = (body.email as string)?.trim().toLowerCase();

  if (!email || !email.includes("@")) {
    return c.html(
      <p class="text-red-600 text-sm">Zadejte platný email.</p>,
      422,
    );
  }

  const ip =
    c.req.header("CF-Connecting-IP") || c.req.header("x-forwarded-for") || "unknown";
  if (!(await checkIpRateLimit(c.env, ip, "preview"))) {
    return c.html(
      <p class="text-red-600 text-sm">Příliš mnoho požadavků. Zkuste to za chvíli.</p>,
      429,
    );
  }

  // Deduplicate — don't fire event twice for same email within 30 days
  const kvKey = `lead:preview:${email}`;
  const existing = await c.env.KV.get(kvKey);

  if (!existing) {
    await c.env.KV.put(kvKey, "1", { expirationTtl: 30 * 24 * 60 * 60 });

    c.executionCtx.waitUntil(
      sendResendEvent(c.env.RESEND_API_KEY, "free_preview.completed", email, {
        source: "email_capture",
      })
    );
  }

  return c.html(
    <div class="bg-green-50 border border-green-200 rounded-lg p-4 text-center">
      <p class="text-green-800 font-medium">
        Diky! Pošleme vám informace o kurzu.
      </p>
    </div>
  );
});

/**
 * Newsletter signup from landing page.
 * Fires a Resend Automation event for welcome/nurture sequence.
 */
leadRoutes.post("/api/leads/newsletter", async (c) => {
  const body = await c.req.parseBody();
  const email = (body.email as string)?.trim().toLowerCase();

  if (!email || !email.includes("@")) {
    return c.html(
      <p class="text-red-600 text-sm">Zadejte platný email.</p>,
      422,
    );
  }

  const ip =
    c.req.header("CF-Connecting-IP") || c.req.header("x-forwarded-for") || "unknown";
  if (!(await checkIpRateLimit(c.env, ip, "newsletter"))) {
    return c.html(
      <p class="text-red-600 text-sm">Příliš mnoho požadavků. Zkuste to za chvíli.</p>,
      429,
    );
  }

  const kvKey = `lead:newsletter:${email}`;
  const existing = await c.env.KV.get(kvKey);

  if (!existing) {
    await c.env.KV.put(kvKey, "1", { expirationTtl: 90 * 24 * 60 * 60 }); // 90 days

    c.executionCtx.waitUntil(
      sendResendEvent(c.env.RESEND_API_KEY, "newsletter.subscribed", email, {
        source: "landing_page",
      })
    );
  }

  return c.html(
    <div class="bg-green-50 border border-green-200 rounded-lg p-4 text-center">
      <p class="text-green-800 font-medium">
        Super! Brzy se ozveme s tipy k vibe codingu.
      </p>
    </div>
  );
});

export { leadRoutes };
