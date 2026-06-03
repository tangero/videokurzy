import { env, SELF } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import { discountInvite } from "../../src/db/schema";

describe("checkout with ?invite=", () => {
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM discount_invite");
  });

  async function seedInvite(token: string) {
    const db = drizzle(env.DB);
    await db.insert(discountInvite).values({
      token,
      email: "absolvent@example.cz",
      percent: 50,
      label: "Osobní sleva",
      expiresAt: new Date("2026-12-31T00:00:00.000Z"),
      createdAt: new Date("2026-06-03T10:00:00.000Z"),
    });
  }

  it("shows discounted B2C price and a hidden inviteToken field", async () => {
    await seedInvite("inv-b2c");
    const res = await SELF.fetch(
      "https://test.local/checkout/individual?invite=inv-b2c",
    );
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain(`${(1000).toLocaleString("cs-CZ")} Kč`);
    expect(html).toContain('name="inviteToken"');
    expect(html).toContain('value="inv-b2c"');
    expect(html).toContain("Osobní sleva");
  });

  it("shows discounted B2B price for organization checkout", async () => {
    await seedInvite("inv-b2b");
    const res = await SELF.fetch(
      "https://test.local/checkout/organization?invite=inv-b2b",
    );
    const html = await res.text();
    expect(html).toContain(`${(7500).toLocaleString("cs-CZ")} Kč`);
    expect(html).toContain('value="inv-b2b"');
  });

  it("ignores an invalid invite token (full price, no hidden field)", async () => {
    const res = await SELF.fetch(
      "https://test.local/checkout/individual?invite=does-not-exist",
    );
    const html = await res.text();
    expect(html).not.toContain('name="inviteToken"');
    expect(html).toContain(`${(2000).toLocaleString("cs-CZ")} Kč`);
  });
});
