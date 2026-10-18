import { describe, expect, it } from "vitest";
import { CcTopicsPage } from "../../src/views/cc-news";
import { TopicHistoryPage } from "../../src/views/cc-topic";
import { buildToolHistory, extractTerms, weekDetail, type HistoryItem } from "../../src/lib/cc-news/topic-history";

const user = { name: "Test", email: "t@example.com" };

describe("stránky vývoje témat", () => {
  it("přehled odkazuje na jednotlivá témata s počtem změn", () => {
    const html = String(<CcTopicsPage user={user} topics={[{ key: "prompt_cache", label: "Prompt cache", description: "cache", count: 49, lastAt: Date.UTC(2026, 9, 16) }]} />);
    expect(html).toContain('href="/novinky-cc/temata/prompt_cache"');
    expect(html).toContain("49 změn");
  });

  it("stránka tématu: osa, detail týdne s vazbou, srovnání a detail pojmu", () => {
    const now = new Date("2026-10-18T12:00:00Z");
    const items: HistoryItem[] = [
      { id: "2.0.10#a", tool: "claude-code", version: "2.0.10", publishedAt: Date.UTC(2025, 9, 8), type: "Added", text: "`PreToolUse` hooks can now modify tool inputs", significance: 3, reason: "PreToolUse hooky mohou upravovat vstupy", followsId: null, relation: null, followReason: null },
      { id: "2.1.295#b", tool: "claude-code", version: "2.1.295", publishedAt: Date.UTC(2026, 9, 8), type: "Added", text: "Added `onFailure` for PreToolUse hooks", significance: 2, reason: "Volba onFailure", followsId: "2.0.10#a", relation: "rozšiřuje", followReason: "stejná událost" },
      { id: "2.1.296#c", tool: "claude-code", version: "2.1.296", publishedAt: Date.UTC(2026, 9, 9), type: "Fixed", text: "Fixed a hook crash", significance: 1, reason: "Oprava pádu", followsId: null, relation: null, followReason: null },
      { id: "1.0.4#d", tool: "grok-build", version: "1.0.4", publishedAt: Date.UTC(2026, 7, 13), type: "Added", text: "PreToolUse hooks can now rewrite a tool's input", significance: 3, reason: "Grok: přepis vstupu", followsId: null, relation: null, followReason: null },
    ];
    const totals = new Map<number, number>();
    const main = buildToolHistory("claude-code", items, totals, now);
    const grok = buildToolHistory("grok-build", items, totals, now);
    const props = { user, topic: { key: "hooks", label: "Hooks", about: "Skripty při událostech." }, main, others: [grok], terms: extractTerms(items), items };

    const articles = [{ tool: "claude-code" as const, toolName: "Claude Code", title: "Mody pro Claude Code", url: "https://www.vibecoding.cz/articles/claude-code/mody/", publishedAt: Date.UTC(2026, 9, 2), rubricUrl: "https://www.vibecoding.cz/claude-code/" }];
    const html = String(<TopicHistoryPage {...props} detail={weekDetail(main, items, null)} articles={articles} />);
    expect(html.indexOf("Nejnovější na vibecoding.cz")).toBeLessThan(html.indexOf("Opravy (1)"));
    expect(html).toContain('href="https://www.vibecoding.cz/articles/claude-code/mody/"');
    expect(html).toContain("Skripty při událostech.");
    expect(html).toContain('href="https://www.vibecoding.cz/cheat-sheet/claude-code/?lang=cs#hooks"');
    expect(html).toContain('href="/novinky-cc/temata/hooks?tyden=2026-w41#detail"');
    expect(html).toContain("Týden 41");
    expect(html).toContain("navazuje na");
    expect(html).toContain("(rozšiřuje)");
    expect(html).toContain("Opravy (1)");
    expect(html).toContain("Srovnání nástrojů");
    expect(html).toContain('?pojem=PreToolUse#detail');

    const termHtml = String(<TopicHistoryPage {...props} detail={null} term="PreToolUse" />);
    expect(termHtml).toContain("td-other");
    expect(termHtml).toContain("Grok: přepis vstupu");
    expect(termHtml).toContain("is-marked");
  });
});
