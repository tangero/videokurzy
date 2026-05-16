import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("GET /watch/:slug chapters", () => {
  it("renders lesson chapters as clickable navigation", async () => {
    await env.DB.prepare(
      "INSERT INTO course (id, title, slug, description, published) VALUES (?, ?, ?, ?, ?)"
    )
      .bind(101, "Test kurz", "test-kurz", "Kurz pro test", 1)
      .run();
    await env.DB.prepare(
      "INSERT INTO module (id, courseId, title, slug, sortOrder) VALUES (?, ?, ?, ?, ?)"
    )
      .bind(201, 101, "Test modul", "test-modul", 1)
      .run();
    await env.DB.prepare(
      "INSERT INTO lesson (id, moduleId, publicId, title, slug, bunnyVideoId, durationSeconds, isFree, sortOrder, chapters) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
      .bind(
        301,
        201,
        "lesson-301",
        "Kapitoly v prehravaci",
        "kapitoly-v-prehravaci",
        "video-301",
        620,
        1,
        1,
        JSON.stringify([
          { title: "Prvni prompt", start: 15, end: 145 },
          { title: "Kontrola vysledku", start: 146, end: 310 },
        ])
      )
      .run();

    const res = await SELF.fetch("https://test.local/watch/kapitoly-v-prehravaci");
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(html).toContain("Obsah epizody");
    expect(html).toContain("Prvni prompt");
    expect(html).toContain('data-chapter-start="15"');
    expect(html).toContain("0:15");
    expect(html).toContain("Kontrola vysledku");
  });
});
