import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

describe("GET /watch/:slug OG metadata", () => {
  beforeAll(async () => {
    await env.DB.prepare(
      "INSERT OR IGNORE INTO course (id, title, slug, description, published) VALUES (?, ?, ?, ?, ?)"
    )
      .bind(111, "OG kurz", "og-kurz", "Kurz pro OG test", 1)
      .run();
    await env.DB.prepare(
      "INSERT OR IGNORE INTO module (id, courseId, title, slug, sortOrder) VALUES (?, ?, ?, ?, ?)"
    )
      .bind(211, 111, "OG modul", "og-modul", 1)
      .run();
    const insert = env.DB.prepare(
      "INSERT OR IGNORE INTO lesson (id, moduleId, publicId, title, slug, bunnyVideoId, durationSeconds, isFree, sortOrder, chapters, bodyMarkdown) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    );
    await insert
      .bind(311, 211, "lesson-311", "AI first company", "ai-first-company-og", "video-311", 600, 0, 1, "[]",
        "Jak postavit **firmu** kolem AI.\n\n- tajný bod jen pro předplatitele")
      .run();
    await insert
      .bind(312, 211, "lesson-312", "Bezplatná epizoda", "bezplatna-og", "video-312", 300, 1, 2, "[]",
        "Úvodní díl zdarma.")
      .run();
  });

  it("serves a public page with OG/X tags for a paid lesson to anonymous visitors", async () => {
    const res = await SELF.fetch("https://test.local/watch/ai-first-company-og", { redirect: "manual" });
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(html).toContain('<meta property="og:title" content="AI first company"');
    expect(html).toContain('<meta property="og:description" content="Jak postavit firmu kolem AI. tajný bod');
    expect(html).toContain('<meta property="og:url" content="https://test.local/watch/ai-first-company-og"');
    expect(html).toContain('<meta property="og:image" content="https://test.local/og/watch/ai-first-company-og.jpg"');
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image"');
    expect(html).toContain('<meta name="twitter:image" content="https://test.local/og/watch/ai-first-company-og.jpg"');
    expect(html).toContain('href="/#cenik"');
    // Video se nepřehrává
    expect(html).not.toContain("lesson-video-player");
  });

  it("includes OG tags on a free lesson page", async () => {
    const res = await SELF.fetch("https://test.local/watch/bezplatna-og");
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(html).toContain('<meta property="og:title" content="Bezplatná epizoda"');
    expect(html).toContain('<meta property="og:description" content="Úvodní díl zdarma."');
    expect(html).toContain('<meta property="og:image" content="https://test.local/og/watch/bezplatna-og.jpg"');
  });

  it("returns 404 for the OG image of an unknown lesson", async () => {
    const res = await SELF.fetch("https://test.local/og/watch/neexistuje.jpg");
    expect(res.status).toBe(404);
  });
});
