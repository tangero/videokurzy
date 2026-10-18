import { env } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import { getLatestSiteArticles, latestByTool } from "../../src/lib/cc-news/site-articles";

const RSS = `<?xml version="1.0"?><rss><channel>
<item><title>Analýza modelu</title><link>https://www.vibecoding.cz/llm/analyzy/x/</link><pubDate>Thu, 15 Oct 2026 00:00:00 GMT</pubDate></item>
<item><title>Starší &amp; o Claude Code</title><link>https://www.vibecoding.cz/articles/claude-code/starsi/</link><pubDate>Fri, 18 Sep 2026 00:00:00 GMT</pubDate></item>
<item><title><![CDATA[Mody pro Claude Code]]></title><link>https://www.vibecoding.cz/articles/claude-code/mody/</link><pubDate>Fri, 02 Oct 2026 00:00:00 GMT</pubDate></item>
<item><title>Grok Build 1.0</title><link>https://www.vibecoding.cz/articles/grok-build/v1/</link><pubDate>Fri, 07 Aug 2026 00:00:00 GMT</pubDate></item>
</channel></rss>`;

describe("latestByTool", () => {
  it("vybere nejnovější článek z rubriky každého nástroje", () => {
    const out = latestByTool(RSS, ["claude-code", "grok-build"]);
    expect(out).toEqual([
      { tool: "claude-code", toolName: "Claude Code", title: "Mody pro Claude Code", url: "https://www.vibecoding.cz/articles/claude-code/mody/", publishedAt: Date.UTC(2026, 9, 2), rubricUrl: "https://www.vibecoding.cz/claude-code/" },
      { tool: "grok-build", toolName: "Grok Build", title: "Grok Build 1.0", url: "https://www.vibecoding.cz/articles/grok-build/v1/", publishedAt: Date.UTC(2026, 7, 7), rubricUrl: null },
    ]);
  });

  it("nástroj bez článku v rubrice vynechá", () => {
    expect(latestByTool(RSS.replace(/<item><title>Grok[\s\S]*?<\/item>/, ""), ["grok-build"])).toEqual([]);
  });
});

describe("getLatestSiteArticles", () => {
  it("výsledek uloží do KV; selhání feedu vrátí prázdné pole", async () => {
    await env.KV.delete("cc-news:site-articles:v1");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const failing = (async () => new Response("x", { status: 503 })) as unknown as typeof fetch;
    expect(await getLatestSiteArticles(env, ["claude-code"], failing)).toEqual([]);
    const ok = (async () => new Response(RSS)) as unknown as typeof fetch;
    expect((await getLatestSiteArticles(env, ["claude-code"], ok)).map((a) => a.title)).toEqual(["Mody pro Claude Code"]);
    expect((await getLatestSiteArticles(env, ["grok-build"], failing)).map((a) => a.title)).toEqual(["Grok Build 1.0"]);
  });
});
