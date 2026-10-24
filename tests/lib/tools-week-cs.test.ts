import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import { selectionKvKey, type WeekSelection } from "../../src/lib/cc-news/weekly";
import { buildEcosystemMatrix, loadToolWeekCards } from "../../src/lib/cc-news/ecosystem";
import type { TopicsOverview } from "../../src/lib/cc-news/topics-overview";
import { CS_SYSTEM, csUserMessage, validateCsPoints, writeToolWeekCs } from "../../src/lib/tools/week-cs";
import { buildToolWeek, toolSelectionId, toolWeekCsKvKey, toolWeekKvKey } from "../../src/lib/tools/weekly-tool";

const WEEK = { year: 2026, week: 42 };

const sel = (features: number, minor = 0): WeekSelection => ({
  v: 1, tool: "codex", itemId: toolSelectionId("codex", WEEK), week: WEEK, weekLabel: "Week 42",
  range: { from: "0.50.0", to: "0.51.0" }, from: "2026-10-12T00:00:00Z", to: "2026-10-18T00:00:00Z",
  releases: 2, entries: 10,
  features: Array.from({ length: features }, (_, i) => ({
    title: `Feature ${i}`, lede: `Does thing ${i}`, docLink: null, versions: ["0.51.0"], sources: [],
  })),
  minorWins: Array.from({ length: minor }, (_, i) => ({ text: `Minor ${i}`, versions: ["0.50.0"] })),
  topics: [], allowedVersions: ["0.50.0", "0.51.0"], knownPages: [],
});

beforeEach(async () => {
  const keys = await env.KV.list({ prefix: "tools:" });
  await Promise.all(keys.keys.map((k) => env.KV.delete(k.name)));
  await env.KV.delete(selectionKvKey(toolSelectionId("codex", WEEK)));
});

describe("validateCsPoints", () => {
  it("ořízne mezery, em dash nahradí krátkou pomlčkou a zahodí prázdné", () => {
    expect(validateCsPoints({ points: ["  Nový  příkaz — `codex resume`. ", "", 3] }, sel(2))).toEqual(["Nový příkaz - `codex resume`."]);
  });

  it("víc vět, než má výběr položek, nebo žádná věta je chyba", () => {
    expect(() => validateCsPoints({ points: ["a", "b", "c"] }, sel(1, 1))).toThrow(/nejvýš 2/);
    expect(() => validateCsPoints({ points: [] }, sel(2))).toThrow(/žádnou/);
    expect(() => validateCsPoints({ text: "x" }, sel(2))).toThrow(/points/);
    expect(() => validateCsPoints({ points: ["1", "2", "3", "4", "5", "6"] }, sel(8))).toThrow(/nejvýš 5/);
  });
});

describe("writeToolWeekCs", () => {
  it("napíše souhrn z ověřeného výběru a uloží ho do KV", async () => {
    await env.KV.put(selectionKvKey(toolSelectionId("codex", WEEK)), JSON.stringify(sel(2, 1)));
    const calls: { system: string; user: string }[] = [];
    const llm = async (system: string, user: string) => {
      calls.push({ system, user });
      return JSON.stringify({ points: ["První věta.", "Druhá věta."] });
    };
    const cs = await writeToolWeekCs(env as never, "codex", WEEK, new Date("2026-10-19T04:00:00Z"), llm);
    expect(cs?.points).toEqual(["První věta.", "Druhá věta."]);
    expect(calls[0]!.system).toBe(CS_SYSTEM("Codex CLI"));
    expect(calls[0]!.user).toBe(csUserMessage(sel(2, 1)));
    expect(calls[0]!.user).toContain("FEATURE: Feature 1 — Does thing 1 (verze 0.51.0)");
    expect(calls[0]!.user).toContain("MINOR: Minor 0");
    expect(await env.KV.get(toolWeekCsKvKey("codex", WEEK), "json")).toMatchObject({ v: 1, tool: "codex", points: cs!.points });
  });

  it("bez výběru starý souhrn smaže a model nevolá", async () => {
    await env.KV.put(toolWeekCsKvKey("codex", WEEK), JSON.stringify({ points: ["staré"] }));
    const llm = async () => { throw new Error("nemá se volat"); };
    expect(await writeToolWeekCs(env as never, "codex", WEEK, new Date(), llm)).toBeNull();
    expect(await env.KV.get(toolWeekCsKvKey("codex", WEEK))).toBeNull();
  });

  it("nové sestavení týdne zneplatní český souhrn", async () => {
    await env.KV.put(toolWeekCsKvKey("codex", WEEK), JSON.stringify({ points: ["staré"] }));
    const llm = async () => { throw new Error("prázdný týden model nevolá"); };
    await buildToolWeek(drizzle(env.DB), env as never, "codex", WEEK, new Date("2026-10-19T04:00:00Z"), { classify: llm, write: llm });
    expect(await env.KV.get(toolWeekCsKvKey("codex", WEEK))).toBeNull();
  });
});

describe("loadToolWeekCards", () => {
  const NOW = new Date("2026-10-24T10:00:00Z"); // poslední uzavřený týden = 2026-w42

  it("český souhrn má přednost, jinak anglické názvy novinek; hledá i starší týdny", async () => {
    await env.KV.put(toolWeekCsKvKey("codex", WEEK), JSON.stringify({ v: 1, tool: "codex", week: WEEK, builtAt: "", points: ["Česky."] }));
    await env.KV.put(toolWeekKvKey("codex", WEEK), JSON.stringify({ features: [{ title: "Feature A" }] }));
    // Grok Build: týden 42 prázdný, týden 41 má novinky bez souhrnu.
    await env.KV.put(toolWeekKvKey("grok-build", { year: 2026, week: 41 }), JSON.stringify({ features: [{ title: "Older feature" }] }));
    const cards = await loadToolWeekCards(env.KV, NOW);
    expect(cards.map((c) => c.tool)).toEqual(["grok-build", "codex", "antigravity", "muse-code"]);
    expect(cards.find((c) => c.tool === "codex")).toMatchObject({
      week: WEEK, points: ["Česky."], pending: false, englishUrl: "https://www.vibecoding.cz/en/codex-weekly-2026-w42/",
    });
    expect(cards.find((c) => c.tool === "grok-build")).toMatchObject({ week: { year: 2026, week: 41 }, points: ["Older feature"], pending: true });
    expect(cards.find((c) => c.tool === "antigravity")).toMatchObject({ week: null, points: [] });
  });
});

describe("buildEcosystemMatrix", () => {
  it("sloupec Claude Code z témat, ostatní z podílů; nástroj bez změn má null, Ostatní na konci", () => {
    const o = {
      from: 0, to: 0, stripFrom: 0, total: 10,
      topics: [
        { key: "hooks", share: 50 }, { key: "mcp", share: 10 }, { key: "other", share: 40 },
      ],
      tools: [
        { tool: "codex", name: "Codex CLI", total: 4, top: [], deltas: {}, shares: { mcp: 75, other: 25 } },
        { tool: "grok-build", name: "Grok Build", total: 0, top: [], deltas: {}, shares: {} },
      ],
    } as unknown as TopicsOverview;
    const m = buildEcosystemMatrix(o);
    expect(m.tools.map((t) => t.tool)).toEqual(["claude-code", "codex", "grok-build"]);
    expect(m.rows.map((r) => r.key)).toEqual(["mcp", "hooks", "other"]);
    expect(m.rows[0]!.shares).toEqual([10, 75, null]);
    expect(m.rows[1]!.shares).toEqual([50, 0, null]);
    expect(m.max).toBe(75);
  });
});
