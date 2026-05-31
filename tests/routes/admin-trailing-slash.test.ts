import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("GET /admin/", () => {
  it("redirects to the canonical admin path before auth routing", async () => {
    const res = await SELF.fetch("https://test.local/admin/", {
      redirect: "manual",
    });

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/admin");
  });
});
