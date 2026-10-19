import { describe, expect, it } from "vitest";
import { CcCatchupPage, CatchupBlock, CatchupTimeline, timelineAxis } from "../../src/views/cc-catchup";
import type { Catchup, CatchupPair } from "../../src/lib/cc-news/catchup";

const user = { name: "Test", email: "t@example.com" };
const DAY = 86_400_000;
const TO = Date.UTC(2026, 9, 12);
const pair = (o: Partial<CatchupPair>): CatchupPair => ({
  tool: "grok-build", term: "PreToolUse", topic: "hooks", topicLabel: "Hooks", title: "hook před nástrojem může přepsat vstup",
  ccAt: Date.UTC(2025, 9, 8), ccVersion: "2.0.10", ccExact: false, otherAt: Date.UTC(2026, 7, 13), otherVersion: "1.0.4", lagDays: 309, ...o,
});
const catchup: Catchup = {
  to: TO,
  tools: [
    { tool: "grok-build", name: "Grok Build", since: Date.UTC(2026, 5, 19), pairs: [pair({}), pair({ term: "/undo", topic: "sessions", topicLabel: "Relace", lagDays: 107 }), pair({ term: "PostToolUse", lagDays: 335 })], medianLagDays: 309, now: [{ key: "hooks", label: "Hooks" }], lead: [{ key: "providers", label: "Přihlášení", n: 17 }, { key: "hooks", label: "Hooks", n: 13 }] },
    { tool: "codex", name: "Codex CLI", since: Date.UTC(2026, 9, 18), pairs: [], medianLagDays: null, now: [], lead: [] },
  ],
};

describe("dohánění mezi nástroji", () => {
  it("blok: slovní hodnocení, odkaz na časovou osu a prázdný stav nástroje bez párů", () => {
    const html = String(<CatchupBlock catchup={catchup} />);
    expect(html).toContain("Dohnal <b>3 funkce</b> Claude Code, medián zpoždění <b>10 měsíců</b>");
    expect(html).toContain("Teď dohání v tématu Hooks.");
    expect(html).toContain('href="/novinky-cc/dohanani#grok-build"');
    expect(html).toContain("<b>Přihlášení</b> (17) a <b>Hooks</b> (13)");
    expect(html).toContain("Změny sbíráme od 18. 10. 2026.");
    expect(html).toContain("cu-tool-wide");
  });

  it("časová osa: řádky se zpožděním, „nejpozději“ u nepřesného data, filtr tématu", () => {
    const html = String(<CatchupTimeline catchup={catchup} />);
    expect(html).toContain("<code>PreToolUse</code>");
    expect(html).toContain("10,2 měs.");
    expect(html).toContain("Claude Code nejpozději 8. 10. 2025, v2.0.10");
    const only = String(<CatchupTimeline catchup={catchup} onlyTopic="sessions" />);
    expect(only).toContain("/undo");
    expect(only).not.toContain("PreToolUse");
    expect(String(<CatchupTimeline catchup={catchup} onlyTopic="mcp" />)).toBe("");
  });

  it("osa začíná čtvrtletím první funkce CC a končí za posledním dohnáním", () => {
    const axis = timelineAxis([pair({})], TO);
    expect(axis.start).toBe(Date.UTC(2025, 9, 1));
    expect(axis.end).toBe(Date.UTC(2026, 10, 1));
    expect(axis.ticks[0]!.label).toBe("říj 25");
  });

  it("stránka bez dat ukáže prázdný stav", () => {
    expect(String(<CcCatchupPage user={user} catchup={null} />)).toContain("Ověřené případy dohánění zatím nemáme");
    const html = String(<CcCatchupPage user={user} catchup={catchup} />);
    expect(html).toContain("Časová osa dohánění");
    expect(html).toContain('id="grok-build"');
  });
});
