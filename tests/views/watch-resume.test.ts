import { describe, expect, it } from "vitest";
import { renderToString } from "hono/jsx/dom/server";
import { WatchPage } from "../../src/views/watch";

describe("WatchPage resume overlay", () => {
  const html = renderToString(
    WatchPage({
      user: { name: "Tester", email: "t@test.cz" },
      lesson: { id: 777, title: "Lekce", slug: "lekce", durationSeconds: 600, moduleId: 1, moduleTitle: "Modul" },
      chapters: [],
      bodyMarkdown: null,
      embedUrl: "https://player.example/embed/lib/vid?token=x&t=323",
      completed: false,
      prevSlug: null,
      nextSlug: null,
      hasPaidAccess: true,
      loggedIn: true,
      resumePosition: 323,
    })
  );

  it("vykreslí overlay kartu s tlačítky a časem", () => {
    expect(html).toContain('id="resume-overlay"');
    expect(html).toContain("Pokračovat");
    expect(html).toContain("Přehrát od začátku");
    expect(html).toContain("Minule v"); // eyebrow s časem
    expect(html).toContain('role="dialog"');
  });

  it("reset URL má interpolované reálné lesson id (ne literál ${lesson.id})", () => {
    expect(html).toContain("/api/watch/777");
    expect(html).not.toContain("${lesson.id}");
  });
});
