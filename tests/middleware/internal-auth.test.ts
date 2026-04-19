import { env } from "cloudflare:test";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { Env } from "../../src/types";
import { requireInternalSecret } from "../../src/middleware/internal-auth";

function buildApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.use("/internal/*", requireInternalSecret);
  app.get("/internal/ping", (c) => c.json({ ok: true }));
  return app;
}

describe("requireInternalSecret", () => {
  it("403 without header", async () => {
    const res = await buildApp().request(
      "/internal/ping",
      {},
      { ...env, AUTH_INTERNAL_SECRET: "correct" },
    );
    expect(res.status).toBe(403);
  });

  it("403 with wrong secret", async () => {
    const res = await buildApp().request(
      "/internal/ping",
      { headers: { "X-Internal-Secret": "wrong" } },
      { ...env, AUTH_INTERNAL_SECRET: "correct" },
    );
    expect(res.status).toBe(403);
  });

  it("200 with correct secret", async () => {
    const res = await buildApp().request(
      "/internal/ping",
      { headers: { "X-Internal-Secret": "correct" } },
      { ...env, AUTH_INTERNAL_SECRET: "correct" },
    );
    expect(res.status).toBe(200);
  });

  it("403 if AUTH_INTERNAL_SECRET env is empty", async () => {
    const res = await buildApp().request(
      "/internal/ping",
      { headers: { "X-Internal-Secret": "anything" } },
      { ...env, AUTH_INTERNAL_SECRET: "" },
    );
    expect(res.status).toBe(403);
  });
});
