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
type Run = { name: string; status: string; conclusion: string | null };
const GREEN: Run[] = [{ name: "Cloudflare Pages", status: "completed", conclusion: "success" }, { name: "GitGuardian Security Checks", status: "completed", conclusion: "success" }];

function fakeGithubPr(states: string[], opts: { merged?: boolean; state?: string; runs?: Run[] | "forbidden" } = {}) {
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
    if (method === "GET" && path.startsWith("/commits/head1/check-runs")) {
      return opts.runs === "forbidden" ? j({ message: "Resource not accessible" }, 403) : j({ check_runs: opts.runs ?? GREEN });
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

  it("clean bez dokončeného buildu Cloudflare Pages nestačí; selhaný build se hlásí hned", async () => {
    const pending = (runs: Run[]) => mergeSitePullRequest("t", "tangero/vibecoding-site", 301, fakeGithubPr(["clean"], { runs }).f);
    expect(await pending([])).toEqual({ kind: "pending", state: "build ještě nezačal" });
    expect(await pending([{ name: "Cloudflare Pages", status: "in_progress", conclusion: null }])).toEqual({ kind: "pending", state: "build in_progress" });
    expect(await pending([{ name: "Cloudflare Pages", status: "completed", conclusion: "failure" }]))
      .toMatchObject({ kind: "blocked", reason: "kontrola Cloudflare Pages skončila failure" });
  });

  it("token bez práva číst kontroly: sloučí až s allowWithoutChecks", async () => {
    const run = (allow: boolean) => mergeSitePullRequest("t", "tangero/vibecoding-site", 301, fakeGithubPr(["clean"], { runs: "forbidden" }).f, { allowWithoutChecks: allow });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await run(false)).toMatchObject({ kind: "pending" });
    expect(await run(true)).toMatchObject({ kind: "merged" });
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

  it("druhý řetězec téhož PR se nezaloží (zámek), po sloučení se zámek uvolní", async () => {
    const { enqueueCcNewsEnMerge } = await import("../../src/queue");
    const sent: unknown[] = [];
    const fakeEnv = { KV: env.KV, WEBHOOK_QUEUE: { send: async (m: unknown) => { sent.push(m); } } } as never;
    await enqueueCcNewsEnMerge(fakeEnv, { itemId: "grok-build-2026-w42", number: 301, attempt: 0 });
    await enqueueCcNewsEnMerge(fakeEnv, { itemId: "grok-build-2026-w42", number: 301, attempt: 0 });
    expect(sent).toHaveLength(1);
    await run(1, ["clean"]);
    expect(await env.KV.get("cc-news:en-merge:grok-build-2026-w42:301")).toBeNull();
  });

  it("vypnuté automatické vydávání: nic nesloučí", async () => {
    await drizzle(env.DB).insert(siteConfig).values({ key: CC_NEWS_AUTOPUBLISH_KEY, value: "false" });
    const r = await run(0, ["clean"]);
    expect(r.calls).toEqual([]);
    expect(r.sent).toEqual([]);
  });
});

describe("opakované doručení vydaného článku", () => {
  it("vydaný týden se znovu nepíše (bez modelu), jen se doplní anglická verze", async () => {
    const db = drizzle(env.DB);
    await db.insert(ccNewsItem).values({
      id: "item-41", sourceId: "/changelog/2026-w41", contentHash: "h", weekLabel: "Week 41", status: "published", createdAt: NOW, publishedAt: NOW,
    } as never);
    const { processCcNewsItem } = await import("../../src/lib/cc-news/pipeline");
    const out = await processCcNewsItem(db, env as never, { itemId: "item-41", sourceId: "/changelog/2026-w41" }, NOW);
    expect(out).toMatchObject({ autopublished: true, usedLlm: false, sent: false });
    const [row] = await db.select().from(ccNewsItem).where(eq(ccNewsItem.id, "item-41"));
    expect(row!.approveNonce).toBeNull();
  });
});
