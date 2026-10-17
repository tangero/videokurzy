import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { ccChangeItem, ccNewsItem } from "../../src/db/schema";
import { parseChangelog, parseReleaseDates } from "../../src/lib/cc-news/changelog-source";
import { classifyPending, syncChangelogEntries } from "../../src/lib/cc-news/classify";
import { createChangelogWeekItem } from "../../src/lib/cc-news/changelog-week";
import { parseSitemap } from "../../src/lib/cc-news/docs-snapshot";
import type { LlmFn } from "../../src/lib/cc-news/llm";
import {
  GITHUB_CHANGELOG_URL, GROK_BUILD_DOCS, nextVersionCandidates, parseGrokChangelog, syncGrokBuild,
} from "../../src/lib/tools/grok-build";
import { buildToolWeek, toolWeekKvKey } from "../../src/lib/tools/weekly-tool";

const GITHUB_MD = `# Changelog

# 1.0.45 — 2026-09-29

## Features

- **Custom agents** from plugins can now be chosen directly with spawn_subagent.
- **MCP servers** can now use a token file that is re-read on every request.

## Bug Fixes

- **Subagent wait status** now correctly shows the count.


# 1.0.44 — 2026-09-28

## Breaking Changes

- **\`--legacy-output\`** was removed.

## Performance

- **Parallel tool calls** that edit the same file now run in sequence.
`;

const v = (ver: string, date: string, line: string) => `# ${ver} — ${date}\n\n## Features\n\n- ${line}\n`;

/** Podvržené x.ai CDN + GitHub. `versions` = existující .external.md. */
function fakeFetch(stable: string, versions: Record<string, string>, github: string | null = GITHUB_MD) {
  const urls: string[] = [];
  const f = (async (url: string) => {
    urls.push(url);
    if (url === "https://x.ai/cli/stable") return new Response(`${stable}\n`);
    if (url === GITHUB_CHANGELOG_URL) return github ? new Response(github) : new Response("", { status: 404 });
    const m = url.match(/changelogs\/(.+)\.external\.md$/);
    if (m && versions[m[1]!]) return new Response(versions[m[1]!]);
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
  return { f, urls };
}

beforeEach(async () => {
  await env.DB.exec("DELETE FROM cc_change_item");
  await env.DB.exec("DELETE FROM cc_news_item");
  for (const k of (await env.KV.list({ prefix: "tool" })).keys) await env.KV.delete(k.name);
});

describe("parseGrokChangelog", () => {
  it("verze s datem, oddíly na typy, nekompatibilní změna označená", async () => {
    const e = await parseGrokChangelog(GITHUB_MD);
    expect(e.map((x) => [x.version, x.type, x.scope])).toEqual([
      ["1.0.44", "Changed", "Breaking"],
      ["1.0.44", "Improved", null],
      ["1.0.45", "Added", null],
      ["1.0.45", "Added", null],
      ["1.0.45", "Fixed", null],
    ]);
    expect(e[0]!.id).toMatch(/^grok-build:1\.0\.44#[0-9a-f]{8}$/);
    expect(e[0]!.publishedAt.toISOString()).toBe("2026-09-28T12:00:00.000Z");
    expect((await parseGrokChangelog(GITHUB_MD, "1.0.45")).every((x) => x.version === "1.0.45")).toBe(true);
  });

  it("kandidáti další verze", () => {
    expect(nextVersionCandidates("1.0.9")).toEqual(["1.0.10", "1.0.11", "1.0.12", "1.1.0", "2.0.0"]);
  });

  it("sitemap docs.x.ai: jen stránky Grok Build", () => {
    const xml = `<url><loc>https://docs.x.ai/build/features/hooks</loc>\n<lastmod>2026-10-10</lastmod></url><url><loc>https://docs.x.ai/developers/release-notes</loc><lastmod>2026-10-10</lastmod></url>`;
    expect(parseSitemap(xml, GROK_BUILD_DOCS)).toEqual([{ path: "features/hooks", lastmod: "2026-10-10" }]);
  });
});

describe("syncGrokBuild", () => {
  it("prázdná tabulka: historie z GitHubu, pak chybějící verze z CDN až po stable", async () => {
    const db = drizzle(env.DB);
    const { f } = fakeFetch("1.0.48", {
      "1.0.46": v("1.0.46", "2026-10-01", "**A** one"),
      "1.0.48": v("1.0.48", "2026-10-03", "**B** two"), // 1.0.47 neexistuje → přeskočí
    });
    const r = await syncGrokBuild(db, f);
    expect(r).toMatchObject({ stable: "1.0.48", latest: "1.0.48", backfilled: true, gap: false, fetchedVersions: ["1.0.46", "1.0.48"] });
    expect(r.added).toBe(7);
    // Podruhé nic nového a nic se nestahuje.
    const again = fakeFetch("1.0.48", {});
    const r2 = await syncGrokBuild(db, again.f);
    expect(r2.added).toBe(0);
    expect(again.urls).toEqual(["https://x.ai/cli/stable"]);
  });

  it("mezera v řadě se nahlásí", async () => {
    const db = drizzle(env.DB);
    const r = await syncGrokBuild(db, fakeFetch("1.0.60", {}).f);
    expect(r).toMatchObject({ latest: "1.0.45", gap: true });
  });

  it("položky Grok Build nepřimíchá do Claude Code", async () => {
    const db = drizzle(env.DB);
    await syncGrokBuild(db, fakeFetch("1.0.45", {}).f);
    const cc = await parseChangelog("## 2.1.300\n- Added a thing\n", parseReleaseDates(`<Update label="2.1.300" description="September 28, 2026">`));
    await syncChangelogEntries(db, cc);
    const out = await createChangelogWeekItem(db, { year: 2026, week: 40 }, new Date("2026-10-05T03:00:00Z"));
    expect(out).toMatchObject({ kind: "created", versionRange: "v2.1.300–v2.1.300" });
    const all = await db.select().from(ccChangeItem);
    expect(all.filter((r) => r.tool === "claude-code").map((r) => r.version)).toEqual(["2.1.300"]);
  });
});

/** Model podle promptu; třídění vrátí význam 1, ať je vidět povýšení breaking. */
function fakeLlm() {
  const calls: { system: string; user: string }[] = [];
  const ids = (u: string) => [...u.matchAll(/^(?:\s*-\s*)?(grok-build:[^\s|]+)\s*\|/gm)].map((m) => m[1]!);
  const llm: LlmFn = async (system, user) => {
    calls.push({ system, user });
    if (system.startsWith("You classify")) return JSON.stringify(ids(user).map((id) => ({ id, topic: "agents", significance: 1, reason: "x" })));
    if (system.startsWith("You link")) return "[]";
    if (system.startsWith("You are the editor")) {
      const must = (user.match(/^MUST PLACE[^:]*: (.*)$/m)?.[1] ?? "").split(", ").filter((x) => x && x !== "(none)");
      return JSON.stringify({ features: [{ title: "Legacy output removed", version: "1.0.44", lede: "The flag is gone.", sourceIds: must, docLink: null }], minorWins: [], skipped: [] });
    }
    if (system.startsWith("These significant")) return JSON.stringify({ minorWins: [], skipped: [] });
    if (system.startsWith("You check claims")) return JSON.stringify([{ n: 1, supported: true, problem: "" }]);
    return "{}";
  };
  return { llm, calls };
}

describe("buildToolWeek", () => {
  it("týden Grok Build: zatřídí, nekompatibilní změnu povýší a povinně vybere, uloží do KV", async () => {
    const db = drizzle(env.DB);
    await syncGrokBuild(db, fakeFetch("1.0.45", {}).f);
    const { llm, calls } = fakeLlm();
    const w = await buildToolWeek(db, env as never, "grok-build", { year: 2026, week: 40 }, new Date("2026-10-05T03:00:00Z"), { classify: llm, write: llm });
    expect(w.versions).toEqual(["1.0.44", "1.0.45"]);
    expect(w.counts).toEqual({ collected: 5, classified: 5, unclassified: 0, docsChanges: 0 });
    expect(calls[0]!.system).toContain("You classify Grok Build changelog entries");
    const breaking = (await db.select().from(ccChangeItem).where(eq(ccChangeItem.scope, "Breaking")))[0]!;
    expect(breaking.significance).toBe(3);
    expect(w.features[0]!.sources[0]).toContain(breaking.id);
    expect(calls.find((c) => c.system.startsWith("You are the editor"))!.system).toContain("What's new in Grok Build");
    expect(await env.KV.get(toolWeekKvKey("grok-build", { year: 2026, week: 40 }))).toBeTruthy();
    // Claude Code tím nevzniklo žádné vydání.
    expect(await db.select().from(ccNewsItem)).toEqual([]);
  });

  it("prázdný týden se uloží bez volání modelu", async () => {
    const db = drizzle(env.DB);
    const { llm, calls } = fakeLlm();
    const w = await buildToolWeek(db, env as never, "grok-build", { year: 2026, week: 30 }, new Date(), { classify: llm, write: llm });
    expect(w.counts.collected).toBe(0);
    expect(calls).toHaveLength(0);
  });
});

describe("třídění po nástrojích", () => {
  it("dávka má jméno svého nástroje", async () => {
    const db = drizzle(env.DB);
    await syncGrokBuild(db, fakeFetch("1.0.45", {}).f);
    const { llm, calls } = fakeLlm();
    await classifyPending(db, env as never, new Date(), 100, llm);
    expect(calls.every((c) => c.system.includes("Grok Build"))).toBe(true);
  });
});
