// Nejnovější článek z rubriky nástroje na vibecoding.cz (rubrika = složka článku,
// odkaz /articles/<složka>/…, složka a stránka rubriky v registru nástrojů). Zdroj je veřejný RSS feed webu, takže web nic
// nového vystavovat nemusí. Selhání feedu stránku nerozbije: box se nezobrazí.

import { TOOLS, type ToolKey } from "../tools/registry";

export const SITE_FEED_URL = "https://www.vibecoding.cz/vibecoding-feed.xml";

export interface SiteArticle {
  tool: ToolKey;
  toolName: string;
  title: string;
  url: string;
  publishedAt: number | null; // epoch ms
  rubricUrl: string | null;
}

const decode = (s: string) =>
  s
    .replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, "$1")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&")
    .trim();

/** Z RSS vybere pro každý nástroj nejnovější položku jeho rubriky. */
export function latestByTool(rss: string, tools: ToolKey[]): SiteArticle[] {
  const items = [...rss.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => {
    const tag = (name: string) => m[1]!.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1];
    const date = tag("pubDate");
    const ms = date ? Date.parse(date) : NaN;
    return { title: decode(tag("title") ?? ""), url: decode(tag("link") ?? ""), publishedAt: Number.isNaN(ms) ? null : ms };
  });
  const out: SiteArticle[] = [];
  for (const tool of tools) {
    const own = items
      .filter((i) => i.title && /^https:\/\/www\.vibecoding\.cz\//.test(i.url) && i.url.includes(`/articles/${TOOLS[tool].siteFolder}/`))
      .sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0));
    const top = own[0];
    if (top) out.push({ tool, toolName: TOOLS[tool].name, ...top, rubricUrl: TOOLS[tool].rubricUrl ?? null });
  }
  return out;
}

const KV_KEY = "cc-news:site-articles:v1";

/** Nejnovější články rubrik s cache v KV na 6 hodin; při chybě prázdné pole. */
export async function getLatestSiteArticles(env: { KV: KVNamespace }, tools: ToolKey[], fetcher: typeof fetch = fetch): Promise<SiteArticle[]> {
  try {
    const hit = await env.KV.get<SiteArticle[]>(KV_KEY, "json");
    if (hit) return hit.filter((a) => tools.includes(a.tool));
  } catch (err) {
    console.error("[cc-news] čtení článků webu z KV selhalo:", (err as Error)?.message);
  }
  try {
    const res = await fetcher(SITE_FEED_URL, { headers: { accept: "application/rss+xml" } });
    if (!res.ok) throw new Error(`feed ${res.status}`);
    const all = latestByTool(await res.text(), Object.keys(TOOLS) as ToolKey[]);
    await env.KV.put(KV_KEY, JSON.stringify(all), { expirationTtl: 6 * 3600 });
    return all.filter((a) => tools.includes(a.tool));
  } catch (err) {
    console.error("[cc-news] načtení článků webu selhalo:", (err as Error)?.message);
    return [];
  }
}
