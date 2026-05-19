import { env } from "cloudflare:test";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { Env } from "../../src/types";
import { requirePartnerKey } from "../../src/middleware/partner-auth";

function buildApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.use("/api/partner/*", requirePartnerKey);
  app.get("/api/partner/ping", (c) => c.json({ ok: true }));
  return app;
}

describe("requirePartnerKey", () => {
  it("403 without header", async () => {
    const res = await buildApp().request(
      "/api/partner/ping",
      {},
      { ...env, VIBECODING_PARTNER_KEY: "correct" },
    );
    expect(res.status).toBe(403);
  });

  it("403 with wrong key", async () => {
    const res = await buildApp().request(
      "/api/partner/ping",
      { headers: { "X-Partner-Key": "wrong" } },
      { ...env, VIBECODING_PARTNER_KEY: "correct" },
    );
    expect(res.status).toBe(403);
  });

  it("200 with correct key", async () => {
    const res = await buildApp().request(
      "/api/partner/ping",
      { headers: { "X-Partner-Key": "correct" } },
      { ...env, VIBECODING_PARTNER_KEY: "correct" },
    );
    expect(res.status).toBe(200);
  });

  it("403 when env var is empty (closed by default)", async () => {
    const res = await buildApp().request(
      "/api/partner/ping",
      { headers: { "X-Partner-Key": "anything" } },
      { ...env, VIBECODING_PARTNER_KEY: "" },
    );
    expect(res.status).toBe(403);
  });
});
