import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ccNewsItem } from "../../src/db/schema";
import { enqueueCcNewsItem } from "../../src/queue";
import {
  detectLatest,
  normalizeSourceId,
  detailMarkdownUrl,
  parseFirstRssItem,
  extractDigestLink,
  sha256Hex,
  type Fetchers,
} from "../../src/lib/cc-news/detect";

const NOW = new Date("2026-06-21T03:00:00.000Z");

// RSS odpovídající ŽIVÉMU tvaru feedu Mintlify (ověřeno proti
// code.claude.com/docs/en/whats-new/rss.xml): <link> je index s kotvou
// (#week-NN), detailní týdenní URL je až v <content:encoded>, sousední týdny
// SDÍLEJÍ pubDate a guid je neperzistentní hash. Test tak hlídá, že sourceId
// vzniká z digest odkazu, ne z <link> ani pubDate.
function rss(week: number, versionRange: string): string {
  const detail = `https://code.claude.com/docs/en/whats-new/2026-w${week}`;
  const prev = week - 1;
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:content="http://purl.org/rss/1.0/modules/content/" version="2.0"><channel>
    <item>
      <title><![CDATA[Week ${week}]]></title>
      <link>https://code.claude.com/docs/en/whats-new#week-${week}</link>
      <guid isPermaLink="false">016d57d72635f2a4</guid>
      <category><![CDATA[${versionRange}]]></category>
      <pubDate>Mon, 15 Jun 2026 23:17:00 GMT</pubDate>
      <content:encoded><![CDATA[<p>Some feature this week.</p>
<p><a href="${detail}">Read the Week ${week} digest →</a></p>]]></content:encoded>
    </item>
    <item>
      <title><![CDATA[Week ${prev}]]></title>
      <link>https://code.claude.com/docs/en/whats-new#week-${prev}</link>
      <guid isPermaLink="false">b129148c2caef170</guid>
      <category><![CDATA[v2.1.158–v2.1.165]]></category>
      <pubDate>Mon, 15 Jun 2026 23:17:00 GMT</pubDate>
      <content:encoded><![CDATA[<p><a href="https://code.claude.com/docs/en/whats-new/2026-w${prev}">Read the Week ${prev} digest →</a></p>]]></content:encoded>
    </item>
  </channel></rss>`;
}

function fetchers(xml: string, detail: string): Fetchers {
  return {
    fetchRss: async () => xml,
    fetchDetail: async () => detail,
  };
}

describe("cc-news detect — pure helpers", () => {
  it("normalizes link variants to one canonical sourceId", () => {
    const want = "/docs/en/whats-new/2026-w24";
    expect(normalizeSourceId("https://code.claude.com/docs/en/whats-new/2026-w24")).toBe(want);
    expect(normalizeSourceId("https://code.claude.com/docs/en/whats-new/2026-w24.md")).toBe(want);
    expect(normalizeSourceId("https://code.claude.com/docs/en/whats-new/2026-w24/")).toBe(want);
    expect(normalizeSourceId("/docs/en/whats-new/2026-w24")).toBe(want);
  });

  it("builds the .md detail URL from a sourceId", () => {
    expect(detailMarkdownUrl("/docs/en/whats-new/2026-w24")).toBe(
      "https://code.claude.com/docs/en/whats-new/2026-w24.md"
    );
  });

  it("extracts the weekly digest link from content:encoded", () => {
    expect(
      extractDigestLink('<p><a href="https://code.claude.com/docs/en/whats-new/2026-w24">Read →</a></p>')
    ).toBe("https://code.claude.com/docs/en/whats-new/2026-w24");
    expect(extractDigestLink("<p>no link here</p>")).toBeNull();
  });

  it("derives sourceId from content:encoded digest link, NOT from <link> index", () => {
    const item = parseFirstRssItem(rss(24, "v2.1.166–v2.1.176"));
    expect(item).not.toBeNull();
    // <link> je index s kotvou (#week-24); sourceId musí být týdenní detail:
    expect(item!.sourceId).toBe("/docs/en/whats-new/2026-w24");
    expect(item!.weekLabel).toBe("Week 24");
    expect(item!.versionRange).toBe("v2.1.166–v2.1.176");
  });

  it("returns null when the item has no weekly digest link (only the index)", () => {
    const idxOnly = `<rss xmlns:content="http://purl.org/rss/1.0/modules/content/" version="2.0"><channel>
      <item><title>Week 24</title>
        <link>https://code.claude.com/docs/en/whats-new#week-24</link>
        <content:encoded><![CDATA[<p>no digest link</p>]]></content:encoded>
      </item></channel></rss>`;
    expect(parseFirstRssItem(idxOnly)).toBeNull();
  });

  it("returns null for a feed without items", () => {
    expect(parseFirstRssItem("<rss><channel></channel></rss>")).toBeNull();
  });

  it("sha256Hex is stable and content-sensitive", async () => {
    expect(await sha256Hex("abc")).toBe(await sha256Hex("abc"));
    expect(await sha256Hex("abc")).not.toBe(await sha256Hex("abd"));
  });
});

describe("cc-news detect — idempotent detection (R1)", () => {
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM cc_news_item");
  });

  const xml = rss(24, "v2.1.166–v2.1.176");

  it("inserts a new draft row on first detection", async () => {
    const db = drizzle(env.DB);
    const out = await detectLatest(db, fetchers(xml, "# Week 24\nbody"), NOW);

    expect(out.kind).toBe("new");
    const rows = await db.select().from(ccNewsItem);
    expect(rows).toHaveLength(1);
    expect(rows[0].sourceId).toBe("/docs/en/whats-new/2026-w24");
    expect(rows[0].status).toBe("draft");
    expect(rows[0].weekLabel).toBe("Week 24");
    expect(rows[0].versionRange).toBe("v2.1.166–v2.1.176");
  });

  it("does not process the same item twice (unchanged on re-run)", async () => {
    const db = drizzle(env.DB);
    const f = fetchers(xml, "# Week 24\nbody");

    const first = await detectLatest(db, f, NOW);
    const second = await detectLatest(db, f, NOW);

    expect(first.kind).toBe("new");
    expect(second.kind).toBe("unchanged");
    const rows = await db.select().from(ccNewsItem);
    expect(rows).toHaveLength(1); // žádný duplikát
  });

  it("detects changed content for the same week and resets status to draft", async () => {
    const db = drizzle(env.DB);

    await detectLatest(db, fetchers(xml, "# Week 24\nold body"), NOW);
    // mezitím se řádka posunula dál v pipeline:
    await env.DB.exec("UPDATE cc_news_item SET status = 'published'");

    const out = await detectLatest(db, fetchers(xml, "# Week 24\nNEW body"), NOW);

    expect(out.kind).toBe("changed");
    const rows = await db.select().from(ccNewsItem);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("draft"); // re-edit => zpět ke schválení
  });

  it("returns empty for a feed with no items and writes nothing", async () => {
    const db = drizzle(env.DB);
    const out = await detectLatest(
      db,
      fetchers("<rss><channel></channel></rss>", ""),
      NOW
    );
    expect(out.kind).toBe("empty");
    expect(await db.select().from(ccNewsItem)).toHaveLength(0);
  });
});

describe("cc-news enqueue (W-003 Queue handoff)", () => {
  it("sends a cc-news.detected message with item references only", async () => {
    const send = vi.fn(async () => {});
    const fakeEnv = { WEBHOOK_QUEUE: { send } } as unknown as Parameters<typeof enqueueCcNewsItem>[0];

    await enqueueCcNewsItem(fakeEnv, "item-123", "/docs/en/whats-new/2026-w24");

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({
      type: "cc-news.detected",
      data: { itemId: "item-123", sourceId: "/docs/en/whats-new/2026-w24" },
    });
  });
});
