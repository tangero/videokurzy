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
          {
            slug: "2026-w24",
            title: "Safe mode, zanořené subagenty a přesun sezení",
            excerpt: "Týden 24 byl věcný a cílený.",
            versionRange: "v2.1.166 → v2.1.176",
            publishedAt: Date.parse("2026-06-21"),
          },
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
    // obsah seznamu — skutečný nadpis + perex z front matteru, ne „Week 24"
    expect(html).toContain("Safe mode, zanořené subagenty a přesun sezení");
    expect(html).toContain("Týden 24 byl věcný a cílený.");
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
    // Žádná karta článku; odkaz na vývoj témat (/novinky-cc/temata) je v hlavičce vždy.
    expect(html).not.toMatch(/href="\/novinky-cc\/(?!temata|ekosystem")/);
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

describe("CcNewsListPage — trendy, aktuální vydání a archiv", () => {
  const trends = {
    from: Date.UTC(2026, 8, 14), to: Date.UTC(2026, 9, 12), total: 10, prevTotal: 10,
    topics: [
      { key: "cloud", label: "Cloud a vzdálené relace", share: 60, prevShare: 10, delta: 50, direction: "up" as const, added: 2, fixed: 4, major: 1, highlight: "Rutiny v cloudu dostaly plánovač." },
      { key: "tui", label: "Terminál a ovládání", share: 40, prevShare: 90, delta: -50, direction: "down" as const, added: 0, fixed: 4, major: 0, highlight: null },
      { key: "mcp", label: "MCP", share: 0, prevShare: 0, delta: 0, direction: "flat" as const, added: 0, fixed: 0, major: 0, highlight: null },
    ],
    rising: [] as never[],
  };
  trends.rising = [trends.topics[0]] as never[];
  const items = [
    { slug: "2026-w41-novinky", title: "Týden 41", excerpt: "Perex.", versionRange: "v2.1.290–v2.1.300", publishedAt: Date.UTC(2026, 9, 12),
      topics: [{ key: "cloud", label: "Cloud a vzdálené relace" }], points: ["Rutiny v cloudu mají `plánovač`."] },
    { slug: "2026-w40-novinky", title: "Týden 40", excerpt: "Starší perex.", versionRange: null, publishedAt: Date.UTC(2026, 9, 5), topics: [], points: [] },
  ];

  it("pořadí aktuální vydání → trendy → archiv → materiály", () => {
    const html = render(CcNewsListPage({ user: USER, items, trends }));
    const at = (s: string) => html.indexOf(s);
    expect(at("Kam teď míří vývoj")).toBeGreaterThan(-1);
    expect(at("Aktuální vydání")).toBeLessThan(at("Kam teď míří vývoj"));
    expect(at("Kam teď míří vývoj")).toBeLessThan(at("Starší vydání"));
    expect(at("Starší vydání")).toBeLessThan(at("Materiály ke stažení"));
  });

  it("panel ukazuje rostoucí téma s podílem, větou a pruhy nové/opravy", () => {
    const html = render(CcNewsListPage({ user: USER, items, trends }));
    expect(html).toContain("Rutiny v cloudu dostaly plánovač.");
    expect(html).toContain("60,0 %");
    expect(html).toContain("+50,0 b.");
    expect(html).toContain('href="/novinky-cc/temata/cloud"');
    expect(html).toContain("cc-bar-new");
    expect(html).toContain("2 nových, 4 oprav");
    // Téma bez změn v okně se v pruzích nezobrazí.
    expect(html).not.toContain(">MCP<");
    expect(html).toContain("jazykový model");
  });

  it("aktuální vydání nese hlavní novinky a štítky témat; starší jsou v kompaktním archivu", () => {
    const html = render(CcNewsListPage({ user: USER, items, trends }));
    expect(html).toContain("Rutiny v cloudu mají <code>plánovač</code>.");
    expect(html).toContain("cc-chip");
    expect(html).toContain('href="/novinky-cc/2026-w40-novinky"');
    expect(html).toContain("cc-archive");
  });

  it("bez trendů se panel nevykreslí", () => {
    const html = render(CcNewsListPage({ user: USER, items, trends: null }));
    expect(html).not.toContain("Kam teď míří vývoj");
    expect(html).toContain("Aktuální vydání");
  });
});
