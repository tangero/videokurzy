import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ccNewsItem } from "../../src/db/schema";
import { backfillRecentWeeks } from "../../src/lib/cc-news/backfill";
import { publishedKvKey } from "../../src/lib/cc-news/draft";
import type { Fetchers } from "../../src/lib/cc-news/detect";

const NOW = new Date("2026-06-21T12:00:00.000Z");

const DIGEST = (w: number) => `# Week ${w} · 2026

> Týdenní souhrn.

<div className="digest-meta"><span>Releases <a>v2.1.${w}</a></span></div>

<div className="digest-feature">
  <div className="digest-feature-header">
    <span className="digest-feature-title">Feature week ${w}</span>
    <span className="digest-feature-pill">v2.1.${w}</span>
  </div>
  <p className="digest-feature-lede">Popis funkce ${w}.</p>
</div>`;

// RSS se `count` po sobě jdoucími týdny (nejnovější = startWeek).
function rssMany(startWeek: number, count: number): string {
  const items = Array.from({ length: count }, (_, i) => {
    const w = startWeek - i;
    const detail = `https://code.claude.com/docs/en/whats-new/2026-w${w}`;
    return `<item>
      <title><![CDATA[Week ${w}]]></title>
      <link>https://code.claude.com/docs/en/whats-new#week-${w}</link>
      <category><![CDATA[v2.1.${w}]]></category>
      <content:encoded><![CDATA[<p><a href="${detail}">Read the Week ${w} digest →</a></p>]]></content:encoded>
    </item>`;
  }).join("\n");
  return `<rss xmlns:content="http://purl.org/rss/1.0/modules/content/" version="2.0"><channel>${items}</channel></rss>`;
}

// Fetchery: RSS s N týdny + detail dle čísla týdne ze sourceId.
function fetchers(startWeek: number, count: number): Fetchers {
  return {
    fetchRss: async () => rssMany(startWeek, count),
    fetchDetail: async (sourceId: string) => {
      const w = parseInt(sourceId.match(/-w(\d+)$/)?.[1] ?? "0", 10);
      return DIGEST(w);
    },
  };
}

// Backfill běží v dry-run režimu (žádné CC_NEWS_DRY_RUN=0, žádný live přepínač),
// takže prepareDraftAndApproval e-mail jen připraví, neodešle. LLM je vypnuté
// (test env nemá OPENROUTER_API_KEY) → použije se deterministická kostra.
const baseEnv = () => env as never;

describe("backfillRecentWeeks — doplnění více týdnů přímo na web", () => {
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM cc_news_item");
  });

  it("detekuje, zpracuje a PUBLIKUJE poslední N týdnů (bez odeslání e-mailu)", async () => {
    const db = drizzle(env.DB);
    const res = await backfillRecentWeeks(db, baseEnv(), NOW, { weeks: 3 }, fetchers(24, 3));

    expect(res.published).toBe(3);
    expect(res.skipped).toBe(0);
    expect(res.errors).toBe(0);

    // Všechny týdny jsou published v DB.
    const rows = await db.select().from(ccNewsItem);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.status === "published")).toBe(true);
    expect(rows.every((r) => r.publishedAt !== null)).toBe(true);

    // Newsletter se NEROZESLAL — newsletterSentAt zůstává prázdné u všech.
    expect(rows.every((r) => r.newsletterSentAt === null)).toBe(true);

    // Publikovaný markdown je v KV pro každý týden.
    for (const r of rows) {
      const md = await env.KV.get(publishedKvKey(r.id));
      expect(md).toBeTruthy();
    }
  });

  it("je idempotentní — druhý běh už publikované týdny přeskočí", async () => {
    const db = drizzle(env.DB);
    const first = await backfillRecentWeeks(db, baseEnv(), NOW, { weeks: 2 }, fetchers(24, 2));
    expect(first.published).toBe(2);

    const second = await backfillRecentWeeks(db, baseEnv(), NOW, { weeks: 2 }, fetchers(24, 2));
    expect(second.published).toBe(0);
    expect(second.skipped).toBe(2);
    expect(second.entries.every((e) => e.note === "už publikováno")).toBe(true);

    // Pořád jen 2 řádky, žádné duplikáty.
    expect(await db.select().from(ccNewsItem)).toHaveLength(2);
  });

  it("force=true přepublikuje i už publikované týdny", async () => {
    const db = drizzle(env.DB);
    await backfillRecentWeeks(db, baseEnv(), NOW, { weeks: 2 }, fetchers(24, 2));

    const forced = await backfillRecentWeeks(
      db,
      baseEnv(),
      NOW,
      { weeks: 2, force: true },
      fetchers(24, 2),
    );
    expect(forced.published).toBe(2);
    expect(forced.skipped).toBe(0);
  });

  it("weeks se ořízne do rozumného rozsahu (1–12)", async () => {
    const db = drizzle(env.DB);
    const res = await backfillRecentWeeks(db, baseEnv(), NOW, { weeks: 999 }, fetchers(24, 2));
    // feed má jen 2 týdny → publikují se 2, ale weeks limit je clampnutý na 12
    expect(res.weeks).toBe(12);
    expect(res.published).toBe(2);
  });
});
