import { describe, it, expect, vi } from "vitest";
import { SELF } from "cloudflare:test";

// Don't hit the real Resend API for the first 3 (allowed) magic-link sends.
// createAuth's sendMagicLink uses raw fetch to api.resend.com — stub global fetch
// for that host so allowed sends succeed and the 4th still hits the rate-limit
// branch BEFORE the better-auth proxy.
const realFetch = globalThis.fetch;
vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input.toString();
  if (url.includes("api.resend.com")) {
    return Promise.resolve(new Response(JSON.stringify({ id: "test" }), { status: 200 }));
  }
  return realFetch(input as any, init);
});

// Per-email rate limit on /login/send: allow 3, block the 4th.
describe("POST /login/send per-email rate limit", () => {
  it("returns 429 on the 4th request for the same email", async () => {
    const email = `ratelimit-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;

    let last: Response | undefined;
    for (let i = 0; i < 4; i++) {
      last = await SELF.fetch("https://example.com/login/send", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ email }).toString(),
      });
    }

    expect(last?.status).toBe(429);
  });

  it("keys the limit off the normalized (lowercased/trimmed) email", async () => {
    const base = `mixedcase-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    // Same normalized email in 4 different surface forms — handler lowercases+trims,
    // so all four hit the same KV key and the 4th must be blocked.
    const emails = [
      `${base}@example.com`,
      `${base.toUpperCase()}@EXAMPLE.COM`,
      `${base}@Example.com`,
      `  ${base}@example.com  `,
    ];

    let last: Response | undefined;
    for (const email of emails) {
      last = await SELF.fetch("https://example.com/login/send", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ email }).toString(),
      });
    }

    expect(last?.status).toBe(429);
  });
});
