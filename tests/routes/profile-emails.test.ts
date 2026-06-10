import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("Profile emails API — auth guards", () => {
  it("GET /api/profile/emails redirects/401 without session", async () => {
    const res = await SELF.fetch("https://test.local/api/profile/emails", {
      redirect: "manual",
    });
    // requireAuth either redirects to /login (302) or returns 401
    expect([302, 401]).toContain(res.status);
  });

  it("POST /api/profile/emails requires auth", async () => {
    const res = await SELF.fetch("https://test.local/api/profile/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "x@y.cz",
        callbackUrl: "https://vibecoding.cz/verify",
      }),
      redirect: "manual",
    });
    expect([302, 401]).toContain(res.status);
  });

  it("PATCH /api/profile/emails requires auth", async () => {
    const res = await SELF.fetch("https://test.local/api/profile/emails", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "x@y.cz", promote: true }),
      redirect: "manual",
    });
    expect([302, 401]).toContain(res.status);
  });

  it("DELETE /api/profile/emails requires auth", async () => {
    const res = await SELF.fetch("https://test.local/api/profile/emails", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "x@y.cz" }),
      redirect: "manual",
    });
    expect([302, 401]).toContain(res.status);
  });
});

describe("POST /internal/auth/verify-add-email", () => {
  it("403 without internal secret", async () => {
    const res = await SELF.fetch(
      "https://test.local/internal/auth/verify-add-email",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: "t", userId: "u" }),
      },
    );
    expect(res.status).toBe(403);
  });

  it("400 without token or userId", async () => {
    const res = await SELF.fetch(
      "https://test.local/internal/auth/verify-add-email",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Secret": env.AUTH_INTERNAL_SECRET,
        },
        body: JSON.stringify({}),
      },
    );
    expect(res.status).toBe(400);
  });

  it("401 with invalid token", async () => {
    const res = await SELF.fetch(
      "https://test.local/internal/auth/verify-add-email",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Secret": env.AUTH_INTERNAL_SECRET,
        },
        body: JSON.stringify({ token: "invalid", userId: "u1" }),
      },
    );
    expect(res.status).toBe(401);
  });

  it("401 with expired token and deletes it", async () => {
    await env.DB.prepare(
      "INSERT INTO verification (id, identifier, value, expiresAt, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)",
    )
      .bind(
        "expired-add-email-token-row",
        "expired-add-email-token",
        JSON.stringify({ email: "expired-add@example.com", attempt: 0 }),
        Date.now() - 60_000,
        Date.now() - 120_000,
        Date.now() - 120_000,
      )
      .run();

    const res = await SELF.fetch(
      "https://test.local/internal/auth/verify-add-email",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Secret": env.AUTH_INTERNAL_SECRET,
        },
        body: JSON.stringify({
          token: "expired-add-email-token",
          userId: "user-1",
        }),
      },
    );

    expect(res.status).toBe(401);
    const body = await res.json<{ error: string; correlationId?: string }>();
    expect(body.error).toBe("invalid_token");

    const row = await env.DB.prepare(
      "SELECT id FROM verification WHERE identifier = ?",
    )
      .bind("expired-add-email-token")
      .first();
    expect(row).toBeNull();
  });
});

describe("Self-service výmaz účtu", () => {
  it("POST /api/profile/delete vyžaduje auth", async () => {
    const res = await SELF.fetch("https://test.local/api/profile/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      redirect: "manual",
    });
    expect([302, 401]).toContain(res.status);
  });

  it("GET /profile/delete/confirm s neplatným tokenem → 400 a nic nesmaže", async () => {
    const res = await SELF.fetch(
      "https://test.local/profile/delete/confirm?token=neplatny",
      { redirect: "manual" },
    );
    expect(res.status).toBe(400);
    const html = await res.text();
    expect(html).toContain("neplatný");
  });

  it("GET /profile/delete/confirm bez tokenu → 400", async () => {
    const res = await SELF.fetch(
      "https://test.local/profile/delete/confirm",
      { redirect: "manual" },
    );
    expect(res.status).toBe(400);
  });

  it("GET /profile přesměruje nepřihlášeného na /login", async () => {
    const res = await SELF.fetch("https://test.local/profile", {
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login");
  });
});
