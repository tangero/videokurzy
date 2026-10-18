import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ccNewsItem, siteConfig } from "../../src/db/schema";
import { autoPublishDraft, draftKvKey, publishedKvKey, reviewFindings } from "../../src/lib/cc-news/draft";
import { CC_NEWS_AUTOPUBLISH_KEY, getCcNewsAutopublish } from "../../src/lib/cc-news/settings";
import { englishWeeklyUrls, mergeSitePullRequest } from "../../src/lib/cc-news/english";
import { handleQueue } from "../../src/queue";

const NOW = new Date("2026-10-19T03:05:00Z");

beforeEach(async () => {
  await env.DB.exec("DELETE FROM cc_news_item");
  await env.DB.exec("DELETE FROM site_config");
});
afterEach(() => vi.unstubAllGlobals());

describe("přepínač automatického vydávání", () => {
  it("výchozí zapnuto, vypíná se hodnotou false", async () => {
    const db = drizzle(env.DB);
    expect(await getCcNewsAutopublish(db)).toBe(true);
    await db.insert(siteConfig).values({ key: CC_NEWS_AUTOPUBLISH_KEY, value: "false" });
    expect(await getCcNewsAutopublish(db)).toBe(false);
  });
});

describe("autoPublishDraft", () => {
  it("koncept je rovnou živá verze, bez schvalovacího odkazu; oznámení nese nálezy a odkazy na úpravy", async () => {
    const db = drizzle(env.DB);
    await db.insert(ccNewsItem).values({
      id: "item-42", sourceId: "/changelog/2026-w42", contentHash: "h", weekLabel: "Week 42", status: "detected", createdAt: NOW,
    } as never);
    const findings = reviewFindings({
      versionIssues: ["2.1.999"], strippedLinks: [], editorNotes: ["⚠️ zmínka o vstupu modelu: The input says <b>"],
      skipped: [], dropped: [{ title: "X", problem: "nedoloženo" }],
    });
    expect(findings).toHaveLength(3);
    const out = await autoPublishDraft(db, env as never, "item-42", "# Článek", {
      slug: "2026-w42-novinky", weekLabel: "Week 42", versionRange: "v2.1.100–v2.1.110", findings,
      english: englishWeeklyUrls({ tool: "claude-code", week: { year: 2026, week: 42 } }),
    }, NOW);

    expect(out).toMatchObject({ autopublished: true, approveUrl: "", mode: "dry-run", sent: false });
    expect(await env.KV.get(publishedKvKey("item-42"))).toBe("# Článek");
    expect(await env.KV.get(draftKvKey("item-42"))).toBe("# Článek");
    const [row] = await db.select().from(ccNewsItem).where(eq(ccNewsItem.id, "item-42"));
    expect(row).toMatchObject({ status: "published", approveNonce: null, articlePath: "src/content/novinky-cc/2026-w42-novinky.md" });
    expect(row!.publishedAt?.getTime()).toBe(Math.floor(NOW.getTime() / 1000) * 1000);
    expect(out.email.subject).toBe("Vydáno: Novinky v Claude Code — Week 42 ⚠️ s nálezy");
    expect(out.email.html).toContain("https://www.vibecoding.cz/keystatic/branch/main/collection/english/item/claude-code-weekly-2026-w42");
    expect(out.email.html).toContain("/admin/newsletter");
    // Text modelu je escapovaný.
    expect(out.email.html).toContain("The input says &lt;b&gt;");
  });
});

/** Podvržené GitHub API pro sloučení PR: stav PR se mění podle pořadí volání. */
function fakeGithubPr(states: string[], opts: { merged?: boolean; state?: string } = {}) {
  const calls: { method: string; path: string; body?: any }[] = [];
  let reads = 0;
  const f = (async (url: string, init: RequestInit = {}) => {
    const path = url.replace("https://api.github.com/repos/tangero/vibecoding-site", "");
    const method = init.method ?? "GET";
    calls.push({ method, path, body: init.body ? JSON.parse(String(init.body)) : undefined });
    const j = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status, headers: { "content-type": "application/json" } });
    if (method === "GET" && path === "/pulls/301") {
      const mergeable_state = states[Math.min(reads++, states.length - 1)];
      return j({
        state: opts.state ?? "open", merged: opts.merged ?? false, mergeable_state, title: "Grok Build weekly 2026-W42",
        html_url: "https://github.com/tangero/vibecoding-site/pull/301", head: { ref: "en-weekly/grok-build-2026-w42", sha: "head1" },
      });
    }
    if (method === "PUT" && path === "/pulls/301/merge") return j({ merged: true });
    if (method === "DELETE") return new Response(null, { status: 204 });
    return j({ message: "unexpected" }, 500);
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe("mergeSitePullRequest", () => {
  it("sloučí až po úspěšných kontrolách a smaže větev", async () => {
    const { f, calls } = fakeGithubPr(["unstable", "clean"]);
    expect(await mergeSitePullRequest("t", "tangero/vibecoding-site", 301, f)).toEqual({ kind: "pending", state: "unstable" });
    expect(await mergeSitePullRequest("t", "tangero/vibecoding-site", 301, f)).toMatchObject({ kind: "merged" });
    const merge = calls.find((c) => c.method === "PUT")!;
    expect(merge.body).toMatchObject({ merge_method: "merge", sha: "head1" });
    expect(calls.some((c) => c.method === "DELETE" && c.path === "/git/refs/heads/en-weekly/grok-build-2026-w42")).toBe(true);
  });

  it("konflikt, zavřený a už sloučený PR", async () => {
    expect(await mergeSitePullRequest("t", "tangero/vibecoding-site", 301, fakeGithubPr(["dirty"]).f)).toMatchObject({ kind: "blocked", reason: "konflikt s main" });
    expect(await mergeSitePullRequest("t", "tangero/vibecoding-site", 301, fakeGithubPr(["clean"], { state: "closed" }).f)).toMatchObject({ kind: "blocked" });
    const done = fakeGithubPr(["clean"], { merged: true, state: "closed" });
    expect(await mergeSitePullRequest("t", "tangero/vibecoding-site", 301, done.f)).toMatchObject({ kind: "already-merged" });
    expect(done.calls.some((c) => c.method === "PUT")).toBe(false);
  });
});

describe("fronta cc-news.en-merge", () => {
  const run = async (attempt: number, states: string[]) => {
    const { f, calls } = fakeGithubPr(states);
    vi.stubGlobal("fetch", f);
    const sent: { body: any; opts: any }[] = [];
    const ack = vi.fn();
    const retry = vi.fn();
    const testEnv = {
      ...(env as unknown as Record<string, unknown>),
      VIBECODING_SITE_GITHUB_TOKEN: "t",
      WEBHOOK_QUEUE: { send: async (body: unknown, opts: unknown) => { sent.push({ body, opts }); } },
    } as never;
    const batch = { messages: [{ body: { type: "cc-news.en-merge", data: { itemId: "grok-build-2026-w42", number: 301, attempt } }, ack, retry }] } as never;
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    await handleQueue(batch, testEnv);
    return { sent, ack, retry, calls };
  };

  it("běžící build: zpráva se odloží znovu (ne retry)", async () => {
    const r = await run(0, ["unstable"]);
    expect(r.ack).toHaveBeenCalledOnce();
    expect(r.retry).not.toHaveBeenCalled();
    expect(r.sent).toEqual([{ body: { type: "cc-news.en-merge", data: { itemId: "grok-build-2026-w42", number: 301, attempt: 1 } }, opts: { delaySeconds: 300 } }]);
  });

  it("po vyčerpání pokusů už se neodkládá", async () => {
    const r = await run(23, ["unstable"]);
    expect(r.sent).toEqual([]);
    expect(r.ack).toHaveBeenCalledOnce();
  });

  it("zelený build: sloučí", async () => {
    const r = await run(3, ["clean"]);
    expect(r.calls.some((c) => c.method === "PUT" && c.path === "/pulls/301/merge")).toBe(true);
    expect(r.sent).toEqual([]);
  });

  it("vypnuté automatické vydávání: nic nesloučí", async () => {
    await drizzle(env.DB).insert(siteConfig).values({ key: CC_NEWS_AUTOPUBLISH_KEY, value: "false" });
    const r = await run(0, ["clean"]);
    expect(r.calls).toEqual([]);
    expect(r.sent).toEqual([]);
  });
});
