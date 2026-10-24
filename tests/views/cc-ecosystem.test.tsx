import { describe, expect, it } from "vitest";
import { CcEcosystemPage } from "../../src/views/cc-ecosystem";
import { CcNewsListPage, nextIssueDate } from "../../src/views/cc-news";
import type { ToolWeekCard } from "../../src/lib/cc-news/ecosystem";

const USER = { name: "Pat", email: "pat@example.cz" };
const render = (node: unknown) => String(node);

const cards: ToolWeekCard[] = [
  { tool: "codex", name: "Codex CLI", week: { year: 2026, week: 42 }, points: ["Nový příkaz `codex resume`."], pending: false, englishUrl: "https://www.vibecoding.cz/en/codex-weekly-2026-w42/" },
  { tool: "grok-build", name: "Grok Build", week: { year: 2026, week: 41 }, points: ["Custom agents"], pending: true, englishUrl: null },
  { tool: "antigravity", name: "Antigravity CLI", week: null, points: [], pending: false, englishUrl: null },
];

describe("CcEcosystemPage", () => {
  it("karty všech nástrojů, mapa témat a stavy bez souhrnu", () => {
    const html = render(
      CcEcosystemPage({
        user: USER,
        latest: { slug: "2026-w42", title: "Týden s hooks", excerpt: null, versionRange: null, publishedAt: Date.UTC(2026, 9, 19), points: ["Bod jedna."] },
        cards,
        overview: null,
        matrix: {
          tools: [{ tool: "claude-code", name: "Claude Code", total: 10 }, { tool: "codex", name: "Codex CLI", total: 0 }],
          rows: [{ key: "hooks", label: "Hooks", shares: [50, null] }],
          max: 50,
        },
        catchup: null,
      }),
    );
    expect(html).toContain("Mapa ekosystému");
    expect(html).toContain('href="/novinky-cc/2026-w42"');
    expect(html).toContain("<code>codex resume</code>");
    expect(html).toContain('id="grok-build"');
    expect(html).toContain("Český souhrn se připravuje");
    expect(html).toContain('lang="en"');
    expect(html).toContain("Za poslední čtyři týdny žádné novinky.");
    expect(html).toContain("codex-weekly-2026-w42");
    // Bez přehledu se mapa nevykreslí (nemá období).
    expect(html).not.toContain("Kam kdo investuje");
    expect(html).toContain('name="robots"');
  });
});

describe("/novinky-cc: pruh ostatních nástrojů", () => {
  it("první věta každého nástroje s odkazem na kotvu mapy", () => {
    const html = render(
      CcNewsListPage({
        user: USER,
        items: [{ slug: "2026-w42", title: "T", excerpt: null, versionRange: null, publishedAt: Date.UTC(2026, 9, 19) }],
        ecosystem: cards,
      }),
    );
    expect(html).toContain("Ostatní nástroje tento týden");
    expect(html).toContain('href="/novinky-cc/ekosystem#codex"');
    expect(html).toContain('href="/novinky-cc/dohanani"');
  });

  it("další vydání = pondělí následujícího týdne", () => {
    expect(nextIssueDate(Date.UTC(2026, 9, 19, 5))).toBe(Date.UTC(2026, 9, 26)); // pondělí → pondělí
    expect(nextIssueDate(Date.UTC(2026, 9, 21, 12))).toBe(Date.UTC(2026, 9, 26)); // středa → pondělí
    expect(nextIssueDate(Date.UTC(2026, 9, 25, 23))).toBe(Date.UTC(2026, 9, 26)); // neděle → zítra
  });
});
