import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import { ccChangeItem } from "../../src/db/schema";
import { computeTopicTrends, getTopicTrends, isoWeekStart, trendsKvKey } from "../../src/lib/cc-news/trends";

// Neděle 18. 10. 2026 → rozpracovaný týden začíná pondělím 12. 10.; poslední 4 celé týdny 14. 9.–11. 10.
const NOW = new Date("2026-10-18T10:00:00Z");
const RECENT = new Date("2026-10-01T12:00:00Z");
const PREV = new Date("2026-08-01T12:00:00Z");

let seq = 0;
const item = (topic: string | null, at: Date, type = "Fixed", significance = 1, reason: string | null = null) => ({
  id: `2.1.${seq}#${String(seq++).padStart(8, "0")}`, tool: "claude-code", version: `2.1.${seq}`, publishedAt: at, ord: 0,
  type, text: "x", topic, significance, reason,
});

/** D1 snese nejvýš 100 proměnných v dotazu → vkládat po pěti řádcích. */
async function insert(rows: ReturnType<typeof item>[]) {
  const db = drizzle(env.DB);
  for (let i = 0; i < rows.length; i += 5) await db.insert(ccChangeItem).values(rows.slice(i, i + 5) as never);
}

beforeEach(async () => {
  await env.DB.exec("DELETE FROM cc_change_item");
});

describe("isoWeekStart", () => {
  it("neděli i pondělí přiřadí k pondělí téhož ISO týdne", () => {
    expect(new Date(isoWeekStart(NOW)).toISOString()).toBe("2026-10-12T00:00:00.000Z");
    expect(isoWeekStart(new Date("2026-10-12T00:00:00Z"))).toBe(Date.UTC(2026, 9, 12));
  });
});

describe("computeTopicTrends", () => {
  it("počítá podíly z celého okna, odděluje opravy a určuje směr", async () => {
    const db = drizzle(env.DB);
    await insert([
      // poslední 4 týdny: cloud 6 (2 nové + 4 opravy), hooks 2, tui 2 → 10 položek
      item("cloud", RECENT, "Added", 3, "Rutiny v cloudu dostaly vlastní plánovač."),
      item("cloud", RECENT, "Changed", 2),
      ...Array.from({ length: 4 }, () => item("cloud", RECENT)),
      item("hooks", RECENT), item("hooks", RECENT),
      item("tui", RECENT), item("tui", RECENT),
      // předchozích 13 týdnů: cloud 1, tui 9 → 10 položek
      item("cloud", PREV),
      ...Array.from({ length: 9 }, () => item("tui", PREV)),
      // mimo okna a nezatříděné se nepočítají
      item("cloud", new Date("2026-10-13T12:00:00Z")),
      item("cloud", new Date("2026-03-01T12:00:00Z")),
      item(null, RECENT),
    ]);

    const t = await computeTopicTrends(db, NOW);
    expect(t.total).toBe(10);
    expect(t.prevTotal).toBe(10);
    expect(new Date(t.from).toISOString()).toBe("2026-09-14T00:00:00.000Z");
    const cloud = t.topics.find((x) => x.key === "cloud")!;
    expect(cloud).toMatchObject({ share: 60, prevShare: 10, delta: 50, direction: "up", added: 2, fixed: 4, major: 1 });
    expect(cloud.highlight).toBe("Rutiny v cloudu dostaly vlastní plánovač.");
    expect(t.topics.find((x) => x.key === "tui")).toMatchObject({ share: 20, prevShare: 90, direction: "down" });
    expect(t.topics[0]!.key).toBe("cloud");
    expect(t.rising.map((x) => x.key)).toEqual(["cloud", "hooks"]);
    expect(t.topics.some((x) => x.key === "other")).toBe(false);
  });

  it("bez srovnávacího období trend neurčuje", async () => {
    const db = drizzle(env.DB);
    await db.insert(ccChangeItem).values([item("cloud", RECENT)] as never);
    const t = await computeTopicTrends(db, NOW);
    expect(t.topics.find((x) => x.key === "cloud")).toMatchObject({ share: 100, direction: "flat" });
    expect(t.rising).toEqual([]);
  });
});

describe("getTopicTrends", () => {
  it("výsledek uloží do KV a další volání čte z cache", async () => {
    const db = drizzle(env.DB);
    await env.KV.delete(trendsKvKey(isoWeekStart(NOW)));
    await db.insert(ccChangeItem).values([item("cloud", RECENT)] as never);
    const first = await getTopicTrends(env, db, NOW);
    expect(first.total).toBe(1);
    await db.insert(ccChangeItem).values([item("hooks", RECENT)] as never);
    const second = await getTopicTrends(env, db, NOW);
    expect(second.total).toBe(1);
  });
});
