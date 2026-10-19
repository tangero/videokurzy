import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import { ccCatchup, ccChangeItem } from "../../src/db/schema";
import {
  buildCatchup, catchupLeadKvKey, findCandidates, syncCandidates, verifyPending, CATCHUP_PROMPT_VERSION, type TopicItem,
} from "../../src/lib/cc-news/catchup";
import type { ToolFocus } from "../../src/lib/cc-news/topics-overview";
import type { LlmFn } from "../../src/lib/cc-news/llm";

const DAY = 86_400_000;
const T0 = Date.UTC(2025, 9, 8);
const GROK_START = Date.UTC(2026, 5, 19);

let n = 0;
const item = (tool: string, at: number, text: string, topic = "hooks", type = "Added", version = "1.0.0"): TopicItem => ({
  id: `${tool}:${version}#${++n}`, tool, version, publishedAt: at, type, text, topic,
  significance: 2, reason: null, followsId: null, relation: null, followReason: null,
});

describe("findCandidates", () => {
  it("najde pojem, který Claude Code měl dřív a nástroj ho zavedl po začátku sledování", () => {
    const items = [
      item("claude-code", T0, "Added `PreToolUse` hooks can rewrite tool input", "hooks", "Added", "2.0.10"),
      item("grok-build", GROK_START, "Initial release with `/hooks` listing"),
      item("grok-build", Date.UTC(2026, 7, 13), "Added `PreToolUse` hook input rewriting", "hooks", "Added", "1.0.4"),
    ];
    const { candidates, lead } = findCandidates(items);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ id: "grok-build:PreToolUse", tool: "grok-build", topic: "hooks", ccVersion: "2.0.10", otherVersion: "1.0.4", ccType: "Added" });
    expect(lead["grok-build"]?.since).toBe(GROK_START);
  });

  it("vynechá zmínky v ochranné lhůtě, opravy, obecné příkazy a pojmy, které měl nástroj dřív", () => {
    const items = [
      item("claude-code", T0, "Added `/help` and `/compact` and `PostToolUse`"),
      item("claude-code", Date.UTC(2026, 8, 1), "Added `/undo`"),
      item("grok-build", GROK_START, "First version"),
      item("grok-build", GROK_START + 5 * DAY, "Added `/compact`"), // v ochranné lhůtě
      item("grok-build", Date.UTC(2026, 7, 1), "Added `/help` improvements"), // obecný příkaz
      item("grok-build", Date.UTC(2026, 7, 2), "Fixed `PostToolUse` timing", "hooks", "Fixed"), // ne Added
      item("grok-build", Date.UTC(2026, 6, 20), "Added `/undo`"), // nástroj dřív než CC
    ];
    expect(findCandidates(items).candidates).toEqual([]);
  });

  it("stejný pojem ve dvou tématech započte jednou s nejdřívější zmínkou Claude Code", () => {
    const items = [
      item("claude-code", T0 + 30 * DAY, "Added `/voice` dictation", "terminal", "Added", "2.1.75"),
      item("claude-code", T0, "Changed `/voice` shortcut", "input", "Changed", "2.0.1"),
      item("antigravity", Date.UTC(2026, 5, 1), "First"),
      item("antigravity", Date.UTC(2026, 7, 26), "Added `/voice` prompt dictation", "terminal"),
      item("antigravity", Date.UTC(2026, 7, 26), "Added `/voice` mode", "input"),
    ];
    const c = findCandidates(items).candidates;
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ topic: "input", ccVersion: "2.0.1", ccType: "Changed" });
  });

  it("pojem porovná napříč tématy; téma páru je téma první zmínky CC a do náskoku se nezapočte", () => {
    const items = [
      item("claude-code", T0, "Added `/compact` command", "context"),
      item("grok-build", GROK_START, "First"),
      item("claude-code", GROK_START + DAY, "Added `/rewind` checkpoints", "sessions"),
      item("grok-build", Date.UTC(2026, 7, 1), "Added `/compact` command", "sessions"),
      item("grok-build", Date.UTC(2026, 7, 2), "Added `/rewind` to undo edits", "context"),
    ];
    const { candidates, lead } = findCandidates(items);
    expect(candidates.map((c) => [c.term, c.topic])).toEqual([["/compact", "context"], ["/rewind", "sessions"]]);
    expect(lead["grok-build"]?.topics).toEqual([]);
  });

  it("náskok: pojmy CC bez protějšku přidané od začátku sledování nástroje, po tématech", () => {
    const items = [
      item("grok-build", GROK_START, "First"),
      item("claude-code", GROK_START + DAY, "Added `/usage-report` and `/team-sync`", "auth"),
      item("claude-code", GROK_START + DAY, "Added `SessionStart` hook", "hooks"),
      item("claude-code", GROK_START - DAY, "Added `/older`", "auth"),
    ];
    expect(findCandidates(items).lead["grok-build"]?.topics).toEqual([
      { key: "auth", label: expect.any(String), n: 2 },
      { key: "hooks", label: expect.any(String), n: 1 },
    ]);
  });
});

const row = (o: Partial<typeof ccCatchup.$inferSelect>): typeof ccCatchup.$inferSelect => ({
  id: "grok-build:X", tool: "grok-build", term: "X", topic: "hooks", ccItemId: "a", ccAt: new Date(T0), ccVersion: "2.0.0", ccType: "Added",
  otherItemId: "b", otherAt: new Date(T0 + 300 * DAY), otherVersion: "1.0.0", verdict: "yes", title: "t", titleEn: "t", reason: null,
  checkedAt: null, promptVersion: CATCHUP_PROMPT_VERSION, createdAt: new Date(), ...o,
});
const focus = (tool: string, deltas: Record<string, number>): ToolFocus => ({ tool: tool as ToolFocus["tool"], name: tool, total: 10, top: [], deltas });

describe("buildCatchup", () => {
  const TO = Date.UTC(2026, 9, 12);
  it("medián zpoždění, jen ověřené páry a „dohání teď“ jen s rostoucím podílem a nedávným dohnáním", () => {
    const rows = [
      row({ id: "g:1", term: "A", otherAt: new Date(TO - 10 * DAY), ccAt: new Date(TO - 310 * DAY) }), // 300 dní, nedávno, hooks
      row({ id: "g:2", term: "B", topic: "sessions", otherAt: new Date(TO - 20 * DAY), ccAt: new Date(TO - 120 * DAY) }), // 100 dní, nedávno, podíl neroste
      row({ id: "g:3", term: "C", ccAt: new Date(TO - 400 * DAY), otherAt: new Date(TO - 200 * DAY) }), // 200 dní, staré
      row({ id: "g:4", term: "D", verdict: "no" }),
      row({ id: "g:5", term: "E", verdict: "pending" }),
    ];
    const out = buildCatchup(rows, { "grok-build": { since: GROK_START, topics: [] } }, [focus("grok-build", { hooks: 5.1, sessions: 0.4 })], TO);
    const g = out.tools.find((t) => t.tool === "grok-build")!;
    expect(g.pairs.map((p) => p.term)).toEqual(["A", "B", "C"]);
    expect(g.medianLagDays).toBe(200);
    expect(g.now.map((x) => x.key)).toEqual(["hooks"]);
    expect(g.since).toBe(GROK_START);
    // Nástroj bez párů zůstává v souhrnu (prázdný stav).
    expect(out.tools.find((t) => t.tool === "codex")?.pairs).toEqual([]);
  });

  it("ccExact podle typu první zmínky", () => {
    const out = buildCatchup([row({ ccType: "Changed" })], {}, [], Date.UTC(2026, 9, 12));
    expect(out.tools.find((t) => t.tool === "grok-build")!.pairs[0]!.ccExact).toBe(false);
  });
});

describe("syncCandidates + verifyPending", () => {
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM cc_catchup");
    await env.DB.exec("DELETE FROM cc_change_item");
    const db = drizzle(env.DB);
    const rows = [
      item("claude-code", T0, "Added `PreToolUse` input rewrite", "hooks", "Added", "2.0.10"),
      item("claude-code", T0, "Added `/compact` command", "context", "Added", "2.0.31"),
      item("grok-build", GROK_START, "First"),
      item("grok-build", Date.UTC(2026, 7, 13), "Added `PreToolUse` input rewriting", "hooks", "Added", "1.0.4"),
      item("grok-build", Date.UTC(2026, 7, 20), "Added `/compact` threshold option", "context", "Added", "1.0.9"),
    ];
    await db.insert(ccChangeItem).values(rows.map((r, i) => ({
      id: r.id, tool: r.tool, version: r.version, publishedAt: new Date(r.publishedAt), ord: i, type: r.type, text: r.text, topic: r.topic, classifiedAt: new Date(),
    })));
  });

  it("uloží kandidáty, ověří je modelem a vynechaného nechá čekat", async () => {
    const db = drizzle(env.DB);
    const now = new Date(Date.UTC(2026, 9, 19));
    expect(await syncCandidates(db, env.KV, now)).toBe(2);
    expect(await syncCandidates(db, env.KV, now)).toBe(0); // idempotentní
    expect(await env.KV.get(catchupLeadKvKey, "json")).toMatchObject({ "grok-build": { since: GROK_START } });

    let prompt = "";
    const llm: LlmFn = async (_s, user) => {
      prompt = user;
      // Model vrátí jen jeden z kandidátů a jedno vymyšlené ID.
      return JSON.stringify([
        { id: "grok-build:PreToolUse", verdict: "yes", title: "hook může přepsat vstup nástroje", title_en: "hook can rewrite tool input", reason: "zavádí stejnou událost" },
        { id: "grok-build:neexistuje", verdict: "yes" },
      ]);
    };
    expect(await verifyPending(db, {}, now, 60, llm)).toBe(1);
    expect(prompt).toContain("Added `PreToolUse` input rewriting");
    const all = await db.select().from(ccCatchup).orderBy(ccCatchup.id);
    expect(all.map((r) => [r.id, r.verdict])).toEqual([["grok-build:/compact", "pending"], ["grok-build:PreToolUse", "yes"]]);
    expect(all[1]!.title).toBe("hook může přepsat vstup nástroje");
    expect(all[1]!.titleEn).toBe("hook can rewrite tool input");

    const no: LlmFn = async () => JSON.stringify({ id: "grok-build:/compact", verdict: "no", reason: "jen rozšiřuje existující příkaz" });
    expect(await verifyPending(db, {}, now, 60, no)).toBe(1);
    expect(await verifyPending(db, {}, now, 60, no)).toBe(0);
  });

  it("pár, který po opravě changelogu zanikl, smaže a pár s jinou položkou vrátí k ověření", async () => {
    const db = drizzle(env.DB);
    const now = new Date(Date.UTC(2026, 9, 19));
    await syncCandidates(db, env.KV, now);
    await db.update(ccCatchup).set({ verdict: "yes", title: "t", titleEn: "t" });
    // Grok položku s /compact ze changelogu stáhl, PreToolUse zmínil dřív jinou položkou.
    await db.delete(ccChangeItem).where(eq(ccChangeItem.text, "Added `/compact` threshold option"));
    await db.insert(ccChangeItem).values({
      id: "grok-build:1.0.2#99", tool: "grok-build", version: "1.0.2", publishedAt: new Date(Date.UTC(2026, 7, 1)), ord: 9,
      type: "Added", text: "Added `PreToolUse` hook event", topic: "tools", classifiedAt: new Date(),
    });
    expect(await syncCandidates(db, env.KV, now)).toBe(1);
    const all = await db.select().from(ccCatchup);
    expect(all.map((r) => [r.id, r.verdict, r.otherVersion, r.title])).toEqual([["grok-build:PreToolUse", "pending", "1.0.2", null]]);
    expect(await syncCandidates(db, env.KV, now)).toBe(0);
  });
});
