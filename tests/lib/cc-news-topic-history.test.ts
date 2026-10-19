import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";
import { ccChangeItem } from "../../src/db/schema";
import {
  buildToolHistory, docsLink, extractTerms, loadTopicHistory, phaseOf, termKind, termMentions, weekDetail, type HistoryItem,
} from "../../src/lib/cc-news/topic-history";

const NOW = new Date("2026-10-18T12:00:00Z");
const it_ = (o: Partial<HistoryItem> & { id: string; publishedAt: number }): HistoryItem => ({
  tool: "claude-code", version: "2.1.0", type: "Added", text: "x", significance: 2, reason: null, followsId: null, relation: null, followReason: null, ...o,
});

describe("buildToolHistory", () => {
  it("týdny od první změny do teď, nové / opravy / zásadní a podíl na všech změnách nástroje", () => {
    const items = [
      it_({ id: "a", publishedAt: Date.UTC(2026, 8, 1), significance: 3 }),
      it_({ id: "b", publishedAt: Date.UTC(2026, 8, 2), type: "Fixed", significance: 1 }),
      it_({ id: "c", publishedAt: Date.UTC(2026, 9, 6), version: "2.1.9" }),
      it_({ id: "g", tool: "grok-build", publishedAt: Date.UTC(2026, 9, 6) }),
    ];
    const totals = new Map([[Date.UTC(2026, 7, 31), 20]]);
    const h = buildToolHistory("claude-code", items, totals, NOW);
    expect(h.total).toBe(3);
    expect(h.weeks[0]).toMatchObject({ key: "2026-w36", added: 1, fixed: 1, major: 1, share: 10, toolTotal: 20 });
    expect(h.weeks.at(-1)!.key).toBe("2026-w42");
    expect(h.milestones.map((m) => m.id)).toEqual(["a"]);
    expect(h.since).toBe(Date.UTC(2026, 8, 1));
  });

  it("bez položek je téma u nástroje prázdné", () => {
    expect(buildToolHistory("grok-build", [], new Map(), NOW)).toMatchObject({ total: 0, weeks: [], since: null });
  });
});

describe("fáze z týdenní historie", () => {
  it("špička překrývající se s posledními týdny se počítá do vrcholu (bez falešného rekordu)", () => {
    // Uzavřené týdny 2026-w34 až w41: [1,1,1,20,20,1,1,2]; poslední 4 týdny mají průměr 6, dřívější vrchol 10,5.
    const counts = [1, 1, 1, 20, 20, 1, 1, 2];
    const items = counts.flatMap((n, w) =>
      Array.from({ length: n }, (_, k) => it_({ id: `w${w}-${k}`, publishedAt: Date.UTC(2026, 7, 17) + w * 7 * 86_400_000 })),
    );
    const h = buildToolHistory("claude-code", items, new Map(), NOW);
    expect(h.recentPerWeek).toBe(6);
    expect(h.phase).not.toBe("peak");
  });
});

describe("phaseOf", () => {
  it("špička, růst, klid a dlouhé ticho", () => {
    expect(phaseOf(10, 3, 8, 0)).toBe("peak");
    expect(phaseOf(5, 3, 8, 0)).toBe("rising");
    expect(phaseOf(1, 3, 8, 0)).toBe("quiet");
    expect(phaseOf(3, 3, 8, 0)).toBe("steady");
    expect(phaseOf(0, 3, 8, 20)).toBe("dormant");
  });
});

describe("slovník tématu", () => {
  it("rozpozná tvary API a vyřadí běžná slova, produkty a soubory", () => {
    expect(termKind("PreToolUse")).toBe("event");
    expect(termKind("onFailure")).toBe("key");
    expect(termKind("tool.check")).toBe("dotted");
    expect(termKind("/hooks")).toBe("command");
    expect(termKind("CLAUDE_ENV_FILE")).toBe("env");
    expect(termKind("prompt")).toBeNull();
    expect(termKind("PowerShell")).toBeNull();
    expect(termKind("settings.json")).toBeNull();
  });

  it("počítá zmínky po nástrojích s první zmínkou", () => {
    const items = [
      it_({ id: "a", publishedAt: Date.UTC(2025, 9, 8), text: "`PreToolUse` hooks can modify inputs" }),
      it_({ id: "b", publishedAt: Date.UTC(2026, 0, 7), text: "PreToolUse and `onFailure`" }),
      it_({ id: "g", tool: "grok-build", version: "1.0.4", publishedAt: Date.UTC(2026, 7, 13), text: "PreToolUse rewrite" }),
    ];
    const pre = extractTerms(items).find((t) => t.term === "PreToolUse")!;
    expect(pre.uses["claude-code"]).toMatchObject({ count: 2, first: Date.UTC(2025, 9, 8) });
    expect(pre.uses["grok-build"]).toMatchObject({ count: 1, version: "1.0.4" });
    expect(termMentions(items, "PreToolUse").map((i) => i.id)).toEqual(["a", "b", "g"]);
    // Celé slovo: PreToolUseFailure se za PreToolUse nepočítá.
    expect(termMentions([it_({ id: "x", publishedAt: 1, text: "PreToolUseFailure" })], "PreToolUse")).toEqual([]);
  });

  it("dokumentace = nejčastější adresa v textech změn", () => {
    const items = [
      it_({ id: "a", publishedAt: 1, text: "Released hooks. Docs: https://code.claude.com/docs/en/hooks" }),
      it_({ id: "b", publishedAt: 2, text: "See https://code.claude.com/docs/en/hooks." }),
      it_({ id: "c", publishedAt: 3, text: "https://code.claude.com/docs/en/settings" }),
    ];
    expect(docsLink(items, "claude-code")).toBe("https://code.claude.com/docs/en/hooks");
    expect(docsLink(items, "grok-build")).toBeNull();
  });
});

describe("weekDetail", () => {
  it("vybraný týden, jinak poslední aktivní; sousední aktivní týdny přeskakují prázdné", () => {
    const items = [
      it_({ id: "a", publishedAt: Date.UTC(2026, 8, 1), significance: 3 }),
      it_({ id: "b", publishedAt: Date.UTC(2026, 9, 6), version: "2.1.9", type: "Fixed", significance: 1 }),
      it_({ id: "c", publishedAt: Date.UTC(2026, 9, 7), version: "2.1.10" }),
    ];
    const h = buildToolHistory("claude-code", items, new Map(), NOW);
    const last = weekDetail(h, items, null)!;
    expect(last).toMatchObject({ key: "2026-w41", versions: ["2.1.9", "2.1.10"], prevKey: "2026-w36", nextKey: null });
    expect(last.fixed.map((i) => i.id)).toEqual(["b"]);
    expect(last.added.map((i) => i.id)).toEqual(["c"]);
    expect(weekDetail(h, items, "2026-w36")!.major.map((i) => i.id)).toEqual(["a"]);
    expect(weekDetail(h, items, "2026-w99")!.key).toBe("2026-w41");
  });
});

describe("loadTopicHistory", () => {
  it("načte téma všech nástrojů a podíl z týdenních součtů", async () => {
    await env.DB.exec("DELETE FROM cc_change_item");
    const db = drizzle(env.DB);
    const row = (id: string, tool: string, topic: string, at: Date) => ({ id, tool, version: "1.0.0", publishedAt: at, ord: 0, type: "Added", text: "PreToolUse x", topic, significance: 2 });
    await db.insert(ccChangeItem).values([
      row("a", "claude-code", "hooks", new Date("2026-10-06T10:00:00Z")),
      row("b", "claude-code", "tui", new Date("2026-10-07T10:00:00Z")),
      row("c", "grok-build", "hooks", new Date("2026-10-08T10:00:00Z")),
    ] as never);
    const h = await loadTopicHistory(db, "hooks", NOW);
    expect(h.tools.map((t) => t.tool)).toEqual(["claude-code", "grok-build", "codex", "antigravity", "muse-code"]);
    expect(h.tools[0]!.weeks.find((w) => w.key === "2026-w41")).toMatchObject({ share: 50, toolTotal: 2 });
    expect(h.tools[1]!.weeks.find((w) => w.key === "2026-w41")).toMatchObject({ share: 100 });
    expect(h.terms.find((t) => t.term === "PreToolUse")).toBeTruthy();
  });
});
