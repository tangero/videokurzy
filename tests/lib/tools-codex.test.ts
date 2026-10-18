import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { ccChangeItem } from "../../src/db/schema";
import { CODEX_RELEASES_URL, cleanItem, parseCodexRelease, syncCodex, type GithubRelease } from "../../src/lib/tools/codex";

const BODY = `## New Features

- Open \`/config\` to search preferences across categories. (#52990, #53429)
- Send a follow-up while Codex is responding to steer it immediately. (#51812)
  - nested detail that is not an item

## Bug Fixes

- Resuming a saved thread restores its permissions. (#53150)

## Breaking Changes

- Removed the \`--legacy\` flag. (#1)

## Documentation

- Updated the bundled OpenAI Docs guidance. (#51768)

## Changelog

Full Changelog: https://github.com/openai/codex/compare/rust-v0.162.0...rust-v0.163.0

- #51539 Add completion-aware realtime attachment @zahan-oai
`;

const rel = (tag: string, at: string, body = BODY, prerelease = false): GithubRelease => ({ tag_name: tag, prerelease, draft: false, published_at: at, body });

beforeEach(async () => {
  await env.DB.exec("DELETE FROM cc_change_item");
});

describe("parseCodexRelease", () => {
  it("bere oddíly produktu, vynechá dokumentaci a seznam PR, čistí odkazy na PR", async () => {
    const out = await parseCodexRelease(rel("rust-v0.163.0", "2026-10-15T21:30:38Z"));
    expect(out.map((e) => [e.type, e.scope, e.text])).toEqual([
      ["Added", null, "Open `/config` to search preferences across categories."],
      ["Added", null, "Send a follow-up while Codex is responding to steer it immediately."],
      ["Fixed", null, "Resuming a saved thread restores its permissions."],
      ["Changed", "Breaking", "Removed the `--legacy` flag."],
    ]);
    expect(out[0]).toMatchObject({ version: "0.163.0", publishedAt: new Date("2026-10-15T21:30:38Z"), ord: 1 });
    expect(out[0]!.id).toMatch(/^codex:0\.163\.0#[0-9a-f]{8}$/);
  });

  it("starší formát s Highlights a PRs Merged", async () => {
    const body = "### Highlights\n- Native Compaction Support: added first-class support.\n### PRs Merged\n- fix: don't truncate (#6907) — @aibrahim\n";
    const out = await parseCodexRelease(rel("rust-v0.59.0", "2025-11-19T18:09:22Z", body));
    expect(out.map((e) => e.text)).toEqual(["Native Compaction Support: added first-class support."]);
  });

  it("celé tělo odsazené a odkazy „(PR #123)“", async () => {
    const body = "  ## New Features\n  - Add `allowed_sandbox_modes` to constrain sandbox modes (PR #8298)\n    - nested\n\n  ## Bug Fixes\n  - Fix `/undo` with git staging (PR #8303)\n";
    const out = await parseCodexRelease(rel("rust-v0.77.0", "2025-12-20T00:00:00Z", body));
    expect(out.map((e) => [e.type, e.text])).toEqual([
      ["Added", "Add `allowed_sandbox_modes` to constrain sandbox modes"],
      ["Fixed", "Fix `/undo` with git staging"],
    ]);
  });

  it("předběžná vydání a jiné balíčky vynechá", async () => {
    expect(await parseCodexRelease(rel("rust-v0.164.0-alpha.1", "2026-10-16T00:00:00Z"))).toEqual([]);
    expect(await parseCodexRelease(rel("rust-v0.164.0", "2026-10-16T00:00:00Z", BODY, true))).toEqual([]);
    expect(await parseCodexRelease(rel("python-v0.154.0", "2026-10-16T00:00:00Z"))).toEqual([]);
  });

  it("cleanItem", () => {
    expect(cleanItem("fix: x (#6907) — @aibrahim")).toBe("fix: x");
    expect(cleanItem("Text. (#1, #2, #3)")).toBe("Text.");
  });
});

describe("syncCodex", () => {
  const pages = (lists: GithubRelease[][]) => {
    const calls: string[] = [];
    const f = (async (url: string, init?: RequestInit) => {
      calls.push(url);
      expect((init?.headers as Record<string, string>)["user-agent"]).toBeTruthy();
      if (url.endsWith("/graphql")) {
        const after = JSON.parse(String(init?.body)).variables.after as string | null;
        const i = after ? Number(after) : 0;
        const nodes = (lists[i] ?? []).map((r) => ({ tagName: r.tag_name, isPrerelease: r.prerelease, isDraft: r.draft, publishedAt: r.published_at, description: r.body }));
        return new Response(JSON.stringify({ data: { repository: { releases: { pageInfo: { hasNextPage: i + 1 < lists.length, endCursor: String(i + 1) }, nodes } } } }));
      }
      const page = Number(new URL(url).searchParams.get("page"));
      return new Response(JSON.stringify(lists[page - 1] ?? []));
    }) as unknown as typeof fetch;
    return { f, calls };
  };

  it("první naplnění projde strany do konce, další běh skončí na uložené verzi", async () => {
    const db = drizzle(env.DB);
    const first = pages([[rel("rust-v0.163.0", "2026-10-15T21:30:38Z"), rel("rust-v0.163.0-alpha.2", "2026-10-14T00:00:00Z", BODY, true)], [rel("rust-v0.162.0", "2026-10-08T18:55:59Z")]]);
    const r1 = await syncCodex(db, { f: first.f });
    expect(r1).toMatchObject({ newest: "0.163.0", latest: "0.163.0", added: 8, pages: 3, caughtUp: true, backfilled: true });
    expect(first.calls[0]).toBe(CODEX_RELEASES_URL(1));

    const second = pages([[rel("rust-v0.164.0", "2026-10-17T10:00:00Z"), rel("rust-v0.163.0", "2026-10-15T21:30:38Z")], [rel("rust-v0.162.0", "2026-10-08T18:55:59Z")]]);
    const r2 = await syncCodex(db, { f: second.f, token: "t" });
    expect(r2).toMatchObject({ newest: "0.164.0", latest: "0.164.0", added: 4, pages: 1, backfilled: false });
    expect(second.calls).toEqual(["https://api.github.com/graphql"]);
    const rows = await db.select().from(ccChangeItem).where(eq(ccChangeItem.tool, "codex"));
    expect(rows).toHaveLength(12);
  });

  it("chyba GitHubu se hlásí výjimkou, 4xx bez opakování", async () => {
    let n = 0;
    const f = (async () => { n++; return new Response("rate limited", { status: 403 }); }) as unknown as typeof fetch;
    await expect(syncCodex(drizzle(env.DB), { f })).rejects.toThrow("codex releases page 1 failed: 403");
    expect(n).toBe(1);
  });

  it("s tokenem projde GraphQL do konce; odmítnutý token přejde na REST", async () => {
    const db = drizzle(env.DB);
    const g = pages([[rel("rust-v0.163.0", "2026-10-15T21:30:38Z")], [rel("rust-v0.162.0", "2026-10-08T18:55:59Z")]]);
    expect(await syncCodex(db, { f: g.f, token: "t" })).toMatchObject({ newest: "0.163.0", pages: 2, added: 8 });

    const urls: string[] = [];
    const f = (async (url: string, init?: RequestInit) => {
      urls.push(url);
      if (url.endsWith("/graphql")) return new Response("bad credentials", { status: 401 });
      expect((init?.headers as Record<string, string>).authorization).toBeUndefined();
      return new Response(new URL(url).searchParams.get("page") === "1" ? JSON.stringify([rel("rust-v0.164.0", "2026-10-17T10:00:00Z")]) : "[]");
    }) as unknown as typeof fetch;
    expect(await syncCodex(db, { f, token: "t" })).toMatchObject({ newest: "0.164.0", latest: "0.164.0" });
    expect(urls[0]).toBe("https://api.github.com/graphql");
    expect(urls[1]).toBe(CODEX_RELEASES_URL(1));
  });

  it("useknutý JSON a 504 se zkusí znovu", async () => {
    const full = JSON.stringify([rel("rust-v0.163.0", "2026-10-15T21:30:38Z")]);
    const answers = [new Response(full.slice(0, 40)), new Response("", { status: 504 }), new Response(full)];
    const f = (async (url: string) =>
      new URL(url).searchParams.get("page") === "1" ? answers.shift()! : new Response("[]")) as unknown as typeof fetch;
    const r = await syncCodex(drizzle(env.DB), { f });
    expect(r).toMatchObject({ newest: "0.163.0", pages: 2 });
    expect(answers).toHaveLength(0);
  });
});
