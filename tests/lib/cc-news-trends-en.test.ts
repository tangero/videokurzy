import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import { ccChangeItem } from "../../src/db/schema";
import { buildTrendsSnapshot, publishEnglishTrends, trendsJson, TRENDS_PATH } from "../../src/lib/cc-news/trends-en";
import type { TopicsOverview } from "../../src/lib/cc-news/topics-overview";
import type { Catchup } from "../../src/lib/cc-news/catchup";

const base = { added: 1, fixed: 0, highlight: "česky", description: "česky" };
const overview: TopicsOverview = {
  from: Date.UTC(2026, 8, 14), to: Date.UTC(2026, 9, 12), stripFrom: Date.UTC(2026, 5, 15), total: 40,
  topics: [
    { ...base, key: "cloud", label: "Cloud", share: 20.04, prevShare: 10, delta: 10.04, direction: "up", major: 8, weeks: [null, 12.345] },
    { ...base, key: "agents", label: "Subagenti", share: 7, prevShare: 15, delta: -8, direction: "down", major: 0, weeks: [1, 2] },
    { ...base, key: "mcp", label: "MCP", share: 0, prevShare: 0, delta: 0, direction: "flat", major: 0, weeks: [null, null] },
  ],
  tools: [{ tool: "grok-build", name: "Grok Build", total: 30, top: [{ key: "tui", label: "Terminál", share: 21.06, ccShare: 11 }], deltas: { hooks: 5 } }],
};
const catchup: Catchup = {
  to: Date.UTC(2026, 9, 12),
  tools: [{
    tool: "grok-build", name: "Grok Build", since: Date.UTC(2026, 5, 19), medianLagDays: 309,
    now: [{ key: "hooks", label: "Hooks" }], lead: [{ key: "providers", label: "Přihlášení", n: 17 }],
    pairs: [{ tool: "grok-build", term: "PreToolUse", topic: "hooks", topicLabel: "Hooks", title: "česky", titleEn: "hook can rewrite tool input", ccAt: Date.UTC(2025, 9, 8), ccVersion: "2.0.10", ccExact: false, otherAt: Date.UTC(2026, 7, 13), otherVersion: "1.0.4", lagDays: 309 }],
  }],
};

describe("anglický snímek trendů", () => {
  it("anglické názvy, zaokrouhlení, poslední uzavřený týden a jen anglické texty", () => {
    const s = buildTrendsSnapshot(overview, catchup, 17, 1.5);
    expect(s).toMatchObject({ week: "2026-W41", from: "2026-09-14", to: "2026-10-11", stripFrom: "2026-06-15", total: 40 });
    expect(s.headline).toBe("Most changes went to Cloud and remote sessions: 20.0 %. Gaining the most: Cloud and remote sessions (+10.0 pp). Losing the most: Subagents and workflows (−8.0 pp).");
    expect(s.topics.map((t) => t.key)).toEqual(["cloud", "agents"]); // bez nulového tématu
    expect(s.topics[0]).toMatchObject({ label: "Cloud and remote sessions", share: 20, weeks: [null, 12.3] });
    expect(s.tools[0]!.top[0]).toMatchObject({ label: "Terminal and controls", share: 21.1 });
    expect(s.catchup[0]).toMatchObject({ since: "2026-06-19", now: ["Hooks"], lead: [{ label: "Login, providers and billing", n: 17 }] });
    expect(s.catchup[0]!.pairs[0]).toMatchObject({ title: "hook can rewrite tool input", cc: "2025-10-08", other: "2026-08-13", ccExact: false });
    expect(trendsJson(s)).not.toMatch(/česky|Přihlášení|Terminál/);
  });
});

describe("úvodní věta", () => {
  it("spojka před posledním tématem i u názvu s čárkami", () => {
    const up = (key: string, delta: number) => ({ ...base, key, label: key, share: 5, prevShare: 5 - delta, delta, direction: "up" as const, major: 0, weeks: [] });
    const o = { ...overview, topics: [up("cloud", 9), up("ide", 3), up("integrations", 2)] };
    expect(buildTrendsSnapshot(o, { to: o.to, tools: [] }, 17, 1.5).headline)
      .toContain("Gaining the most: Cloud and remote sessions (+9.0 pp), IDE and desktop (+3.0 pp) and Chrome, Design, Artifacts (+2.0 pp).");
  });
});

describe("publishEnglishTrends", () => {
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM cc_change_item");
    await env.DB.exec("DELETE FROM cc_catchup");
    const db = drizzle(env.DB);
    const at = new Date(Date.UTC(2026, 9, 6));
    await db.insert(ccChangeItem).values([
      { id: "cc:1#1", tool: "claude-code", version: "2.1.300", publishedAt: at, ord: 0, type: "Added", text: "Added hooks", topic: "hooks", significance: 2, classifiedAt: at },
    ]);
  });

  const github = (onMain: string | null) => {
    const calls: { method: string; path: string; body?: any }[] = [];
    const f = (async (url: string, init: RequestInit) => {
      const path = url.replace("https://api.github.com/repos/tangero/vibecoding-site", "");
      const method = init.method ?? "GET";
      calls.push({ method, path, body: init.body ? JSON.parse(String(init.body)) : undefined });
      const j = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status, headers: { "content-type": "application/json" } });
      if (method === "GET" && path === "") return j({ default_branch: "main" });
      if (path === "/git/ref/heads/main") return j({ object: { sha: "base" } });
      if (path === "/git/refs") return j({}, 201);
      if (method === "GET" && path === `/contents/${TRENDS_PATH}`) {
        return onMain === null ? j({}, 404) : j({ sha: "m", content: btoa(unescape(encodeURIComponent(onMain))) });
      }
      if (method === "GET" && path.startsWith("/contents/")) return j({}, 404);
      if (method === "PUT") return j({ content: { sha: "w1" } }, 201);
      if (method === "GET" && path.startsWith("/pulls")) return j([]);
      if (method === "POST" && path === "/pulls") return j({ html_url: "https://github.com/tangero/vibecoding-site/pull/400", number: 400 }, 201);
      return j({ message: "unexpected" }, 500);
    }) as unknown as typeof fetch;
    return { f, calls };
  };
  const now = new Date(Date.UTC(2026, 9, 19, 6));

  it("nový snímek otevře PR, stejný obsah na webu se neposílá", async () => {
    const db = drizzle(env.DB);
    const e = { ...env, VIBECODING_SITE_GITHUB_TOKEN: "t" };
    const dry = await publishEnglishTrends(e, db, now, { dryRun: true });
    if (dry.kind !== "dry-run") throw new Error(dry.kind);
    const json = dry.json;
    expect(JSON.parse(json)).toMatchObject({ version: 1, week: "2026-W42", total: 1 });

    const fresh = github(null);
    const out = await publishEnglishTrends(e, db, now, { fetch: fresh.f });
    expect(out).toMatchObject({ kind: "pr", week: "2026-W42", pr: { number: 400, created: true } });
    expect(fresh.calls.find((c) => c.method === "POST" && c.path === "/git/refs")?.body.ref).toBe("refs/heads/en-trends/2026-w42");
    expect(fresh.calls.some((c) => c.method === "PUT" && c.path === `/contents/${TRENDS_PATH}`)).toBe(true);

    const same = github(json);
    expect(await publishEnglishTrends(e, db, now, { fetch: same.f })).toEqual({ kind: "unchanged", week: "2026-W42" });
    expect(same.calls.some((c) => c.method === "PUT" || c.path === "/pulls")).toBe(false);
  });
});
