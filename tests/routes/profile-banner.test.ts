import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("POST /api/profile/recovery-banner/dismiss", () => {
  it("requires auth", async () => {
    const res = await SELF.fetch(
      "https://test.local/api/profile/recovery-banner/dismiss",
      { method: "POST", redirect: "manual" },
    );
    expect([302, 401]).toContain(res.status);
  });
});
