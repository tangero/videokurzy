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
    expect(html).toContain("<h1>Mapa vývojářských nástrojů</h1>");
    expect(html).toContain('<a href="/novinky-cc/ekosystem" aria-current="page">');
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

describe("CcEcosystemPage: nejistá data vydání", () => {
  it("karta Muse Code vysvětlí odvozená data, mapa má hvězdičku a průměr položek na vydání", () => {
    const overview = {
      from: Date.UTC(2026, 8, 21), to: Date.UTC(2026, 9, 19), stripFrom: 0, total: 520,
      topics: [{ key: "hooks", label: "Hooks", share: 50 }],
      tools: [{ tool: "muse-code", name: "Muse Code", total: 970, top: [], deltas: {}, shares: { hooks: 40 } }],
      releases: { "claude-code": 10, "muse-code": 10 },
    } as never;
    const html = render(
      CcEcosystemPage({
        user: USER, latest: null, overview, catchup: null,
        cards: [{ tool: "muse-code", name: "Muse Code", week: { year: 2026, week: 41 }, points: ["Věta."], pending: false, englishUrl: null }],
        matrix: {
          tools: [{ tool: "claude-code", name: "Claude Code", total: 520, releases: 10 }, { tool: "muse-code", name: "Muse Code", total: 970, releases: 10 }],
          rows: [{ key: "hooks", label: "Hooks", shares: [50, 40] }], max: 50,
        },
        dates: {
          "muse-code": {
            syncedAt: "",
            approx: [{ version: "1.4.0", at: "2026-09-30T20:08:37Z", basis: "upper" }, { version: "1.4.5", at: "2026-10-11T23:15:23Z", basis: "upper" }],
            missing: [{ version: "1.4.12", at: "2026-10-22T17:43:38Z" }],
          },
        },
      }),
    );
    expect(html).toContain("970 položek changelogu v 10 vydáních za 4 týdny");
    expect(html).toContain("Changelog Muse Code neuvádí data vydání");
    expect(html).toContain("Verze 1.4.0 a 1.4.5 tam data nemají");
    expect(html).toContain("vyšly nejpozději tehdy, mohly i dřív");
    expect(html).toContain("Novější verzi 1.4.12 changelog zatím nepopisuje");
    // Týden 41 (5.–11. 10.) obsahuje 1.4.5 s odhadnutým datem.
    expect(html).toContain("verze 1.4.5 s odhadnutým datem");
    expect(html).toContain("<sup");
    expect(html).toContain("Průměrný počet položek na vydání: Claude Code 52 a Muse Code 97");
  });
});
