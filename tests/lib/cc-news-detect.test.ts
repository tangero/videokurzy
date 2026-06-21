import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import { ccNewsItem } from "../../src/db/schema";
import {
  detectLatest,
  normalizeSourceId,
  detailMarkdownUrl,
  parseFirstRssItem,
  sha256Hex,
  type Fetchers,
} from "../../src/lib/cc-news/detect";

const NOW = new Date("2026-06-21T03:00:00.000Z");

// Minimální RSS se dvěma týdny — Week 24 a Week 23 SDÍLEJÍ pubDate, aby test
// hlídal, že detekce na pubDate nestaví idempotenci (vzala by jen první item).
function rss(weekLabel: string, link: string, versionRange: string): string {
  return `<?xml version="1.0"?><rss version="2.0"><channel>
    <item>
      <title>${weekLabel}</title>
      <link>${link}</link>
      <category>${versionRange}</category>
      <guid>${link}#${weekLabel}</guid>
      <pubDate>Mon, 16 Jun 2026 00:00:00 GMT</pubDate>
    </item>
    <item>
      <title>Week 23</title>
      <link>https://code.claude.com/docs/en/whats-new/2026-w23</link>
      <category>2.1.0 - 2.1.9</category>
      <guid>w23</guid>
      <pubDate>Mon, 16 Jun 2026 00:00:00 GMT</pubDate>
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

  it("parses the first RSS item only", () => {
    const item = parseFirstRssItem(
      rss("Week 24", "https://code.claude.com/docs/en/whats-new/2026-w24", "2.2.0 - 2.2.9")
    );
    expect(item).not.toBeNull();
    expect(item!.sourceId).toBe("/docs/en/whats-new/2026-w24");
    expect(item!.weekLabel).toBe("Week 24");
    expect(item!.versionRange).toBe("2.2.0 - 2.2.9");
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

  const link = "https://code.claude.com/docs/en/whats-new/2026-w24";
  const xml = rss("Week 24", link, "2.2.0 - 2.2.9");

  it("inserts a new draft row on first detection", async () => {
    const db = drizzle(env.DB);
    const out = await detectLatest(db, fetchers(xml, "# Week 24\nbody"), NOW);

    expect(out.kind).toBe("new");
    const rows = await db.select().from(ccNewsItem);
    expect(rows).toHaveLength(1);
    expect(rows[0].sourceId).toBe("/docs/en/whats-new/2026-w24");
    expect(rows[0].status).toBe("draft");
    expect(rows[0].weekLabel).toBe("Week 24");
    expect(rows[0].versionRange).toBe("2.2.0 - 2.2.9");
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
