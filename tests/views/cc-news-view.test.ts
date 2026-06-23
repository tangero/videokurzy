import { describe, expect, it } from "vitest";
import { CcNewsListPage, CcNewsArticlePage } from "../../src/views/cc-news";

const USER = { name: "Pat", email: "pat@example.cz" };

// Hono JSX komponenta je volatelná jako funkce; vrací objekt s .toString().
function render(node: unknown): string {
  return String(node);
}

describe("CcNewsListPage — design serveru", () => {
  it("renderuje serverovou hlavičku, patičku a navigaci (Layout)", () => {
    const html = render(
      CcNewsListPage({
        user: USER,
        items: [
          { slug: "2026-w24", weekLabel: "Week 24", versionRange: "v2.1.166 → v2.1.176", publishedAt: Date.parse("2026-06-21") },
        ],
      }),
    );
    // hlavička + patička serveru
    expect(html).toContain("site-header");
    expect(html).toContain("site-footer");
    expect(html).toContain("kurzy.vibecoding.cz");
    // přihlášený uživatel → odkazy „můj kurz" / „odhlásit"
    expect(html).toContain("/dashboard");
    expect(html).toContain("/logout");
    // obsah seznamu
    expect(html).toContain("Week 24");
    expect(html).toContain("/novinky-cc/2026-w24");
    expect(html).toContain("v2.1.166");
    // gated obsah → noindex (audit P3)
    expect(html).toContain('name="robots"');
    expect(html).toContain("noindex");
    // karta-odkaz má hover třídu (audit P2)
    expect(html).toContain("cc-news-card");
    // seznam zachovává list sémantiku ul/li (code-review #2)
    expect(html).toContain("cc-news-list");
    expect(html).toContain("<ul");
    expect(html).toContain("<li>");
    // materiály ke stažení (cheat-sheet + 2 PDF), externí, nová záložka
    expect(html).toContain("Materiály ke stažení");
    expect(html).toContain("https://www.vibecoding.cz/cheat-sheet/claude-code?lang=cs");
    expect(html).toContain("https://www.vibecoding.cz/download/claude-code-tahak.pdf");
    expect(html).toContain("https://www.vibecoding.cz/download/claude-code-pro-zacatecniky.pdf");
    expect(html).toContain('target="_blank"');
  });

  it("prázdný seznam ukáže hlášku, ne kartu", () => {
    const html = render(CcNewsListPage({ user: USER, items: [] }));
    expect(html).toContain("Zatím žádný publikovaný článek");
    expect(html).not.toContain("/novinky-cc/");
  });
});

describe("CcNewsArticlePage — design serveru", () => {
  it("vloží článek do Layoutu a zachová odkaz zpět na seznam", () => {
    const html = render(
      CcNewsArticlePage({
        user: USER,
        title: "Week 24",
        articleHtml: "<h1>Co je nového</h1><p>tělo</p>",
      }),
    );
    expect(html).toContain("site-header");
    expect(html).toContain("site-footer");
    // odkaz zpět na seznam (s touch-target třídou — audit P2)
    expect(html).toContain("/novinky-cc");
    expect(html).toContain("všechna vydání");
    expect(html).toContain("cc-news-back");
    // gated → noindex (audit P3)
    expect(html).toContain("noindex");
    // vykreslený obsah článku v sdílené prose třídě (.lesson-body, code-review #4)
    expect(html).toContain("lesson-body");
    expect(html).toContain("<h1>Co je nového</h1>");
    expect(html).toContain("tělo");
  });
});
