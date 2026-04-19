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
});
