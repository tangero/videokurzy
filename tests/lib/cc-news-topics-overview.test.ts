import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import { ccChangeItem } from "../../src/db/schema";
import { computeTopicsOverview, STRIP_WEEKS } from "../../src/lib/cc-news/topics-overview";

// Neděle 18. 10. 2026: poslední 4 celé týdny 14. 9.–11. 10., pruh od 15. 6.
const NOW = new Date("2026-10-18T10:00:00Z");

let seq = 0;
const item = (tool: string, topic: string, at: string, type = "Added") => ({
  id: `${tool}:${seq}#${String(seq++).padStart(8, "0")}`, tool, version: `1.0.${seq}`, publishedAt: new Date(at), ord: 0,
  type, text: "x", topic, significance: 2, reason: null,
});

async function insert(rows: ReturnType<typeof item>[]) {
  const db = drizzle(env.DB);
  for (let i = 0; i < rows.length; i += 5) await db.insert(ccChangeItem).values(rows.slice(i, i + 5) as never);
}

beforeEach(async () => {
  await env.DB.exec("DELETE FROM cc_change_item");
});

describe("computeTopicsOverview", () => {
  it("týdenní podíl, týden bez změn jako mezera, rozpracovaný týden mimo, ostatní nástroje", async () => {
    await insert([
      // první týden pruhu (15. 6.): hooks 1 z 2
      item("claude-code", "hooks", "2026-06-16T10:00:00Z"),
      item("claude-code", "cloud", "2026-06-17T10:00:00Z"),
      // poslední uzavřený týden (5. 10.): cloud 3 z 4
      item("claude-code", "cloud", "2026-10-06T10:00:00Z"),
      item("claude-code", "cloud", "2026-10-07T10:00:00Z", "Fixed"),
      item("claude-code", "cloud", "2026-10-08T10:00:00Z"),
      item("claude-code", "hooks", "2026-10-09T10:00:00Z"),
      // rozpracovaný týden: nepočítá se
      item("claude-code", "hooks", "2026-10-13T10:00:00Z"),
      // Grok Build za 4 týdny: tui 2, hooks 1
      item("grok-build", "tui", "2026-09-20T10:00:00Z"),
      item("grok-build", "tui", "2026-09-21T10:00:00Z"),
      item("grok-build", "hooks", "2026-09-22T10:00:00Z"),
    ]);
    const o = await computeTopicsOverview(drizzle(env.DB), NOW);
    expect(o.stripFrom).toBe(Date.UTC(2026, 5, 15));
    expect(o.total).toBe(4);
    const cloud = o.topics.find((t) => t.key === "cloud")!;
    const hooks = o.topics.find((t) => t.key === "hooks")!;
    expect(cloud.weeks).toHaveLength(STRIP_WEEKS);
    expect(cloud.weeks[0]).toBe(50);
    expect(cloud.weeks[1]).toBeNull();
    expect(cloud.weeks[STRIP_WEEKS - 1]).toBe(75);
    expect(hooks.weeks[STRIP_WEEKS - 1]).toBe(25);
    expect(cloud.share).toBe(75);

    const grok = o.tools.find((t) => t.tool === "grok-build")!;
    expect(grok.total).toBe(3);
    expect(grok.top[0]).toMatchObject({ key: "tui", ccShare: 0 });
    expect(grok.top[0]!.share).toBeCloseTo(66.67, 1);
    expect(grok.top[1]).toMatchObject({ key: "hooks", ccShare: 25 });
    expect(o.tools.find((t) => t.tool === "codex")).toMatchObject({ total: 0, top: [], shares: {} });
    // Vydání ve 4 týdnech (každá položka fixture má vlastní verzi): Claude Code 4, Grok Build 3.
    expect(o.releases).toEqual({ "claude-code": 4, "grok-build": 3 });
    expect(grok.shares.tui).toBeCloseTo(66.67, 1);
    expect(grok.shares.hooks).toBeCloseTo(33.33, 1);
  });
});
