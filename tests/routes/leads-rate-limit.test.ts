import { describe, it, expect } from "vitest";
import { env, SELF } from "cloudflare:test";

// Per-IP rate limit on leads endpoints: allow 5, block the 6th.
//
// Každý požadavek používá jiný email, aby email-dedup větev nezkratovala a každý
// request reálně dorazil k IP rate-limit kontrole. Aby se nevolal reálný Resend
// (test API klíč → odeslání selže a waitUntil shodí response na 503),
// pre-seedujeme dedup klíč daného emailu — handler pak odeslání přeskočí.
function uniqueEmail(): string {
  return `lead-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
}

async function postLead(path: string, ip: string): Promise<Response> {
  const email = uniqueEmail();
  // Pre-seed dedup, ať handler neodesílá přes Resend (jen testujeme rate limit).
  const dedupKey = path.includes("newsletter")
    ? `lead:newsletter:${email}`
    : `lead:preview:${email}`;
  await env.KV.put(dedupKey, "1");

  // Handlers parse form-encoded bodies (c.req.parseBody()), not JSON.
  return SELF.fetch(`https://example.com${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "CF-Connecting-IP": ip,
    },
    body: new URLSearchParams({ email }).toString(),
  });
}

async function hammer(path: string, ip: string): Promise<Response> {
  let last: Response | undefined;
  for (let i = 0; i < 6; i++) {
    last = await postLead(path, ip);
  }
  return last!;
}

describe("leads per-IP rate limit", () => {
  it("returns 429 on the 6th /api/leads/preview-completed from the same IP", async () => {
    const ip = `10.0.0.${Math.floor(Math.random() * 255)}-${Date.now()}`;
    const last = await hammer("/api/leads/preview-completed", ip);
    expect(last.status).toBe(429);
  });

  it("returns 429 on the 6th /api/leads/newsletter from the same IP", async () => {
    const ip = `10.0.1.${Math.floor(Math.random() * 255)}-${Date.now()}`;
    const last = await hammer("/api/leads/newsletter", ip);
    expect(last.status).toBe(429);
  });

  it("keeps preview and newsletter buckets independent", async () => {
    const ip = `10.0.2.${Math.floor(Math.random() * 255)}-${Date.now()}`;
    // Fill the preview bucket to its limit.
    await hammer("/api/leads/preview-completed", ip);
    // Newsletter from the same IP should still accept its first request.
    const res = await postLead("/api/leads/newsletter", ip);
    expect(res.status).toBe(200);
  });
});
