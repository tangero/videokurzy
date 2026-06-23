import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ccNewsItem } from "../../src/db/schema";
import { enqueueCcNewsItem } from "../../src/queue";
import {
  detectLatest,
  detectRecent,
  normalizeSourceId,
  detailMarkdownUrl,
  parseFirstRssItem,
  parseRssItems,
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

  it("picks the link matching weekLabel, not an earlier-week link in the text", () => {
    // úvod odkazuje na předchozí týden (w23), cílový digest (w24) je až dál
    const html =
      '<p>minulý týden viz <a href="https://code.claude.com/docs/en/whats-new/2026-w23">Week 23</a></p>' +
      '<p><a href="https://code.claude.com/docs/en/whats-new/2026-w24">Read the Week 24 digest →</a></p>';
    expect(extractDigestLink(html, "Week 24")).toBe("https://code.claude.com/docs/en/whats-new/2026-w24");
    // bez weekLabel fallback na poslední odkaz (cílový bývá na konci)
    expect(extractDigestLink(html)).toBe("https://code.claude.com/docs/en/whats-new/2026-w24");
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

  it("re-edit of a DRAFT item updates content and stays draft", async () => {
    const db = drizzle(env.DB);
    await detectLatest(db, fetchers(xml, "# Week 24\nold body"), NOW);

    const out = await detectLatest(db, fetchers(xml, "# Week 24\nNEW body"), NOW);

    expect(out.kind).toBe("changed");
    const rows = await db.select().from(ccNewsItem);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("draft");
  });

  it("re-edit of a PUBLISHED item does NOT depublish it (keeps published, sets pendingContentHash)", async () => {
    const db = drizzle(env.DB);
    await detectLatest(db, fetchers(xml, "# Week 24\nold body"), NOW);
    // článek byl publikován:
    await env.DB.exec("UPDATE cc_news_item SET status = 'published'");

    const out = await detectLatest(db, fetchers(xml, "# Week 24\nNEW body"), NOW);

    expect(out.kind).toBe("changed");
    const rows = await db.select().from(ccNewsItem);
    expect(rows).toHaveLength(1);
    // KLÍČOVÉ: živá verze zůstává published, nedepublikuje se
    expect(rows[0].status).toBe("published");
    expect(rows[0].pendingContentHash).toBeTruthy();
  });

  it("published item with unchanged pending hash returns unchanged on re-run", async () => {
    const db = drizzle(env.DB);
    await detectLatest(db, fetchers(xml, "# Week 24\nold body"), NOW);
    await env.DB.exec("UPDATE cc_news_item SET status = 'published'");

    const f = fetchers(xml, "# Week 24\nNEW body");
    const first = await detectLatest(db, f, NOW);
    const second = await detectLatest(db, f, NOW);

    expect(first.kind).toBe("changed");
    expect(second.kind).toBe("unchanged"); // pending hash už sedí → žádný další zápis
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

// Feed s `count` po sobě jdoucími týdny (nejnovější = startWeek, klesá dolů).
// Každý <item> má vlastní detailní digest odkaz v content:encoded.
function rssMany(startWeek: number, count: number): string {
  const items = Array.from({ length: count }, (_, i) => {
    const w = startWeek - i;
    const detail = `https://code.claude.com/docs/en/whats-new/2026-w${w}`;
    return `    <item>
      <title><![CDATA[Week ${w}]]></title>
      <link>https://code.claude.com/docs/en/whats-new#week-${w}</link>
      <guid isPermaLink="false">guid-${w}</guid>
      <category><![CDATA[v2.1.${w}]]></category>
      <pubDate>Mon, 15 Jun 2026 23:17:00 GMT</pubDate>
      <content:encoded><![CDATA[<p><a href="${detail}">Read the Week ${w} digest →</a></p>]]></content:encoded>
    </item>`;
  }).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:content="http://purl.org/rss/1.0/modules/content/" version="2.0"><channel>
${items}
  </channel></rss>`;
}

describe("cc-news detect — parseRssItems (více týdnů)", () => {
  it("vrátí posledních N položek, nejnovější první", () => {
    const items = parseRssItems(rssMany(24, 4), 4);
    expect(items).toHaveLength(4);
    expect(items.map((i) => i.sourceId)).toEqual([
      "/docs/en/whats-new/2026-w24",
      "/docs/en/whats-new/2026-w23",
      "/docs/en/whats-new/2026-w22",
      "/docs/en/whats-new/2026-w21",
    ]);
  });

  it("ořízne na limit i když feed má víc položek", () => {
    expect(parseRssItems(rssMany(24, 6), 4)).toHaveLength(4);
  });

  it("deduplikuje položky mířící na týž týden", () => {
    // dva <item> na týž digest → jen jeden sourceId
    const dup = rssMany(24, 1) + rssMany(24, 1);
    expect(parseRssItems(`<rss><channel>${dup}</channel></rss>`, 4).length).toBeLessThanOrEqual(1);
  });

  it("prázdný feed → []", () => {
    expect(parseRssItems("<rss><channel></channel></rss>", 4)).toEqual([]);
  });
});

describe("cc-news detect — detectRecent (backfill detekce)", () => {
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM cc_news_item");
  });

  it("vloží draft řádku pro každý detekovaný týden", async () => {
    const db = drizzle(env.DB);
    let n = 0;
    const f: Fetchers = {
      fetchRss: async () => rssMany(24, 4),
      // každý týden má jiný obsah (jinak by se hash shodoval napříč týdny — to
      // tu nevadí, sourceId je klíč, ale ať je test realistický)
      fetchDetail: async () => `# digest ${n++}`,
    };

    const outcomes = await detectRecent(db, f, NOW, 4);

    expect(outcomes).toHaveLength(4);
    expect(outcomes.every((o) => o.kind === "new")).toBe(true);
    const rows = await db.select().from(ccNewsItem);
    expect(rows).toHaveLength(4);
  });

  it("je idempotentní — druhý běh nevytvoří duplikáty (unchanged)", async () => {
    const db = drizzle(env.DB);
    const f: Fetchers = {
      fetchRss: async () => rssMany(24, 3),
      fetchDetail: async (sourceId) => `# digest for ${sourceId}`,
    };

    const first = await detectRecent(db, f, NOW, 3);
    const second = await detectRecent(db, f, NOW, 3);

    expect(first.every((o) => o.kind === "new")).toBe(true);
    expect(second.every((o) => o.kind === "unchanged")).toBe(true);
    expect(await db.select().from(ccNewsItem)).toHaveLength(3);
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
