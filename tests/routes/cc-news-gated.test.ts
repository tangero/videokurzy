import { env, SELF } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import { ccNewsItem } from "../../src/db/schema";
import { slugFromPath } from "../../src/routes/cc-news";
import { draftKvKey } from "../../src/lib/cc-news/draft";

const NOW = new Date("2026-06-21T12:00:00.000Z");

describe("slugFromPath", () => {
  it("derives slug from the repo article path", () => {
    expect(slugFromPath("src/content/novinky-cc/2026-w24.md")).toBe("2026-w24");
    expect(slugFromPath("2026-w24.md")).toBe("2026-w24");
    expect(slugFromPath(null)).toBeNull();
  });
});

describe("gated sekce Novinky v CC (R5 — jen přihlášení s přístupem)", () => {
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM cc_news_item");
    const db = drizzle(env.DB);
    await db.insert(ccNewsItem).values({
      id: "pub-1",
      sourceId: "/docs/en/whats-new/2026-w24",
      contentHash: "h",
      weekLabel: "Week 24",
      versionRange: "v2.1.166 → v2.1.176",
      status: "published",
      articlePath: "src/content/novinky-cc/2026-w24.md",
      publishedAt: NOW,
      createdAt: NOW,
    });
    await env.KV.put(draftKvKey("pub-1"), "# Week 24\nobsah");
  });

  it("nepřihlášený je z přehledu přesměrován (login/ceník)", async () => {
    const res = await SELF.fetch("https://test.local/novinky-cc", { redirect: "manual" });
    expect(res.status).toBe(302);
    const loc = res.headers.get("location") ?? "";
    expect(["/login", "/#cenik"]).toContain(loc);
  });

  it("nepřihlášený je z detailu přesměrován", async () => {
    const res = await SELF.fetch("https://test.local/novinky-cc/2026-w24", { redirect: "manual" });
    expect(res.status).toBe(302);
  });

  it("nepřihlášený NEvidí obsah článku (žádné prosáknutí markdownu)", async () => {
    const res = await SELF.fetch("https://test.local/novinky-cc/2026-w24", { redirect: "manual" });
    const text = await res.text();
    expect(text).not.toMatch(/obsah/);
  });
});
