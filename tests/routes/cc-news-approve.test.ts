import { env, SELF } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { ccNewsItem } from "../../src/db/schema";
import { prepareDraftAndApproval } from "../../src/lib/cc-news/draft";

// Reálné „teď" — endpoint /approve ověřuje token proti Date.now() workeru
// (miniflare isolate, nelze injektovat). Fixní datum by po 7denním TTL tokenu
// způsobilo clock-dependent selhání (token „expiruje"). Hodnota NOW nevstupuje
// do žádné asserce (kontrolují se jen status kódy + publikace).
const NOW = new Date();

describe("GET /internal/cc-news/approve (R4 — lidský HMAC link)", () => {
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM cc_news_item");
    const db = drizzle(env.DB);
    await db.insert(ccNewsItem).values({
      id: "item-1",
      sourceId: "/docs/en/whats-new/2026-w24",
      contentHash: "h",
      weekLabel: "Week 24",
      versionRange: null,
      status: "draft",
      createdAt: NOW,
    });
  });

  async function approvePath(): Promise<string> {
    const db = drizzle(env.DB);
    const r = await prepareDraftAndApproval(
      db,
      env as never,
      "item-1",
      "# článek",
      { slug: "2026-w24", weekLabel: "Week 24", versionRange: null },
      NOW
    );
    return r.approveUrl.replace(/^https?:\/\/[^/]+/, "");
  }

  it("400 bez tokenu", async () => {
    const res = await SELF.fetch("https://test.local/internal/cc-news/approve");
    expect(res.status).toBe(400);
  });

  it("publikuje na platný link BEZ internal secret (klik z e-mailu)", async () => {
    const path = await approvePath();
    const res = await SELF.fetch(`https://test.local${path}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toMatch(/publikován/i);

    const db = drizzle(env.DB);
    const rows = await db.select().from(ccNewsItem).where(eq(ccNewsItem.id, "item-1"));
    expect(rows[0].status).toBe("published");
  });

  it("druhý klik vrátí 409 (jednorázovost)", async () => {
    const path = await approvePath();
    await SELF.fetch(`https://test.local${path}`);
    const second = await SELF.fetch(`https://test.local${path}`);
    expect(second.status).toBe(409);
  });

  it("401 na zfalšovaný token", async () => {
    const res = await SELF.fetch("https://test.local/internal/cc-news/approve?token=garbage.sig");
    expect(res.status).toBe(401);
  });
});
