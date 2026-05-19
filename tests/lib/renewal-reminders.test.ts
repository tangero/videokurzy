import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/d1";
import { purchase } from "../../src/db/schema";
import { sendRenewalReminders } from "../../src/lib/renewal-reminders";

describe("sendRenewalReminders", () => {
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM purchase");
    vi.restoreAllMocks();
  });

  it("sends reminders for expiring comp grants", async () => {
    const db = drizzle(env.DB);
    await db.insert(purchase).values({
      email: "admin-grant@example.cz",
      type: "individual",
      paymentMethod: "stripe",
      stripePaymentId: null,
      status: "active",
      kind: "comp",
      grantedBy: "patrick@vibecoding.cz",
      expiresAt: new Date("2026-05-31T10:00:00.000Z"),
      createdAt: new Date("2026-05-01T10:00:00.000Z"),
    });

    const sent = vi.fn();
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      sent(JSON.parse(String(init.body)));
      return new Response("{}", { status: 200 });
    });

    const kv = new Map<string, string>();
    const result = await sendRenewalReminders(db, {
      ...env,
      BETTER_AUTH_URL: "https://kurzy.vibecoding.cz",
      RESEND_API_KEY: "test_resend",
      KV: {
        get: async (key: string) => kv.get(key) ?? null,
        put: async (key: string, value: string) => {
          kv.set(key, value);
        },
      },
    } as never, new Date("2026-05-17T10:00:00.000Z"));

    expect(result).toEqual({ sent: 1, errors: 0 });
    expect(sent).toHaveBeenCalledWith(expect.objectContaining({
      to: ["admin-grant@example.cz"],
      subject: "Váš přístup ke kurzu končí za 14 dní",
    }));
  });
});
