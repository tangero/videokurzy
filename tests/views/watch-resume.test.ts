import { describe, expect, it } from "vitest";
import { renderToString } from "hono/jsx/dom/server";
import { WatchPage } from "../../src/views/watch";

describe("WatchPage resume lišta", () => {
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

  it("vykreslí lištu pod videem s textem a tlačítkem od začátku", () => {
    expect(html).toContain('id="resume-bar"');
    expect(html).toContain("Pokračuj v přehrávání");
    expect(html).toContain("Přehrát od začátku");
  });

  it("nepřekrývá přehrávač overlayem (nativní play button zůstane přístupný)", () => {
    expect(html).not.toContain("resume-overlay");
    expect(html).not.toContain('role="dialog"');
  });

  it("reset URL má interpolované reálné lesson id (ne literál ${lesson.id})", () => {
    expect(html).toContain("/api/watch/777");
    expect(html).not.toContain("${lesson.id}");
  });
});
