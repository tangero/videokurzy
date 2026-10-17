import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import {
  GithubError, englishDateRange, englishMdKvKey, englishWeeklyMarkdown, englishWeeklyPath, openSitePullRequest,
  publicationDate, publishEnglishWeekly,
} from "../../src/lib/cc-news/english";
import { selectionKvKey, type WeekSelection } from "../../src/lib/cc-news/weekly";
import type { LlmFn } from "../../src/lib/cc-news/llm";

const SEL: WeekSelection = {
  v: 1,
  tool: "claude-code",
  itemId: "w43",
  week: { year: 2026, week: 43 },
  weekLabel: "Week 43",
  range: { from: "2.1.300", to: "2.1.305" },
  from: "2026-10-19T12:00:00.000Z",
  to: "2026-10-24T12:00:00.000Z",
  releases: 4,
  entries: 37,
  features: [{
    title: "Projects", lede: "Projects coordinate cloud sessions.", docLink: "https://code.claude.com/docs/en/claude-projects",
    versions: ["2.1.301"], sources: ["2.1.301#abcd1234 | Added | Added projects"],
  }],
  minorWins: [{ text: "Faster startup", versions: ["2.1.302"] }],
  topics: ["sessions"],
  allowedVersions: ["2.1.300", "2.1.301", "2.1.302", "2.1.305"],
  knownPages: ["claude-projects"],
};

const BODY = "*How many sessions can you watch?*\n\n# Projects\n\n**Dispatcher.** Claude coordinates threads — itself ([docs](https://code.claude.com/docs/en/claude-projects)). Version 2.1.999. [Bad](https://code.claude.com/docs/en/nope).";

function fakeLlm() {
  const calls: { system: string; user: string }[] = [];
  const llm: LlmFn = async (system, user) => {
    calls.push({ system, user });
    if (system.startsWith("You fix version numbers")) return user.slice(user.indexOf("ARTICLE:\n") + 9).replace("2.1.999", "2.1.301");
    return JSON.stringify({ title: "Projects take over coordination", excerpt: "The week in brief.", summaryPoints: ["Projects: parallel sessions."], body: BODY });
  };
  return { llm, calls };
}

/** Podvržené GitHub API: zaznamená volání, stav větve/PR lze nastavit. */
function fakeGithub(state: { branchExists?: boolean; fileSha?: string; openPr?: string; onMain?: boolean } = {}) {
  const calls: { method: string; path: string; body?: any }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    const path = url.replace("https://api.github.com/repos/tangero/vibecoding-site", "");
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path, body });
    const j = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status, headers: { "content-type": "application/json" } });
    if (method === "GET" && path === "") return j({ default_branch: "main" });
    if (path === "/git/ref/heads/main") return j({ object: { sha: "base123" } });
    if (path === "/git/refs") return state.branchExists ? j({ message: "Reference already exists" }, 422) : j({}, 201);
    if (method === "GET" && path.startsWith("/contents/") && !path.includes("?ref=")) return state.onMain ? j({ sha: "main" }) : j({}, 404);
    if (method === "GET" && path.startsWith("/contents/")) return state.fileSha ? j({ sha: state.fileSha }) : j({}, 404);
    if (method === "PUT") return j({}, state.fileSha ? 200 : 201);
    if (method === "GET" && path.startsWith("/pulls")) return j(state.openPr ? [{ html_url: state.openPr }] : []);
    if (method === "POST" && path === "/pulls") return j({ html_url: "https://github.com/tangero/vibecoding-site/pull/300" }, 201);
    return j({ message: "unexpected" }, 500);
  }) as unknown as typeof fetch;
  return { f, calls };
}

beforeEach(async () => {
  for (const k of (await env.KV.list({ prefix: "cc-news:" })).keys) await env.KV.delete(k.name);
});

describe("formát souboru podle kontraktu webu", () => {
  it("cesta, front matter a titulek s týdnem", () => {
    expect(englishWeeklyPath({ tool: "claude-code", week: { year: 2026, week: 3 } })).toBe("src/content/english/claude-code-weekly-2026-w03.md");
    const md = englishWeeklyMarkdown(SEL, {
      title: "Claude Code, Week 43: Projects \"take over\"", excerpt: "Two\nlines.", summaryPoints: ["a: b"], body: "# Top\n\nText",
    }, new Date("2026-10-26T09:00:00Z"));
    expect(md).toBe([
      "---",
      `title: "Claude Code, Week 43: Projects \\"take over\\""`,
      "date: '2026-10-26'",
      "author: Patrick Zandl",
      "type: news",
      "series: weekly-updates",
      "tool: claude-code",
      "week: 2026-W43",
      "categories:",
      "  - Claude Code",
      `post_excerpt: "Two lines."`,
      "summary_points:",
      `  - "a: b"`,
      "---",
      "",
      "## Top\n\nText",
      "",
    ].join("\n"));
    expect(md).not.toContain("translation_of");
  });

  it("datum = pondělí po týdnu, prázdné shrnutí vynechá, # v kódu nechá", () => {
    expect(publicationDate(SEL).toISOString()).toBe("2026-10-26T00:00:00.000Z");
    const md = englishWeeklyMarkdown(SEL, { title: "X", excerpt: "E", summaryPoints: [], body: "# A\n\n```bash\n# install\n```\n\n# B" });
    expect(md).toContain("date: '2026-10-26'");
    expect(md).not.toContain("summary_points");
    expect(md).toContain("## A\n\n```bash\n# install\n```\n\n## B");
  });

  it("anglické období", () => {
    expect(englishDateRange(new Date("2026-09-14T12:00:00Z"), new Date("2026-09-20T12:00:00Z"))).toBe("September 14–20, 2026");
    expect(englishDateRange(new Date("2026-09-28T12:00:00Z"), new Date("2026-10-04T12:00:00Z"))).toBe("September 28 – October 4, 2026");
  });
});

describe("publishEnglishWeekly", () => {
  it("bez uloženého výběru nic nedělá", async () => {
    expect(await publishEnglishWeekly(env as never, "missing", { llm: fakeLlm().llm })).toEqual({ kind: "no-selection" });
  });

  it("nanečisto napíše anglický článek z výběru a projde kontrolami", async () => {
    await env.KV.put(selectionKvKey("w43"), JSON.stringify(SEL));
    const { llm, calls } = fakeLlm();
    const out = await publishEnglishWeekly(env as never, "w43", { llm, dryRun: true });
    expect(out.kind).toBe("no-token");
    if (out.kind !== "no-token") return;
    expect(out.path).toBe("src/content/english/claude-code-weekly-2026-w43.md");
    expect(out.markdown).toContain(`title: "Claude Code, Week 43: Projects take over coordination"`);
    expect(out.markdown).toContain("Version 2.1.301.");
    expect(out.markdown).not.toContain("—");
    expect(out.markdown).not.toContain("/nope");
    expect(out.markdown).toContain("## Projects");
    expect(out.markdown).not.toMatch(/^# /m);
    // Psaní dostalo anglický vstup z výběru, ne český text.
    expect(calls[0]!.system).toMatch(/^You are Patrick Zandl/);
    expect(calls[0]!.user).toContain("WEEK: Week 43, October 19–24, 2026; versions 2.1.300 to 2.1.305");
    expect(calls[0]!.user).toContain("2.1.301#abcd1234 | Added | Added projects");
  });

  it("otevře PR s jedním souborem do nové větve", async () => {
    await env.KV.put(selectionKvKey("w43"), JSON.stringify(SEL));
    const gh = fakeGithub();
    const out = await publishEnglishWeekly({ ...env, VIBECODING_SITE_GITHUB_TOKEN: "t" } as never, "w43", { llm: fakeLlm().llm, fetch: gh.f });
    expect(out).toEqual({ kind: "pr", pr: { url: "https://github.com/tangero/vibecoding-site/pull/300", branch: "en-weekly/claude-code-2026-w43", path: "src/content/english/claude-code-weekly-2026-w43.md", created: true } });
    expect(gh.calls.find((c) => c.path === "/git/refs")!.body).toEqual({ ref: "refs/heads/en-weekly/claude-code-2026-w43", sha: "base123" });
    const put = gh.calls.find((c) => c.method === "PUT")!;
    expect(put.path).toBe("/contents/src/content/english/claude-code-weekly-2026-w43.md");
    expect(new TextDecoder().decode(Uint8Array.from(atob(put.body.content), (ch) => ch.charCodeAt(0)))).toContain("week: 2026-W43");
    expect(put.body.sha).toBeUndefined();
    const pr = gh.calls.find((c) => c.method === "POST" && c.path === "/pulls")!;
    expect(pr.body).toMatchObject({ head: "en-weekly/claude-code-2026-w43", base: "main", title: "Claude Code weekly 2026-W43" });
    expect(pr.body.body).toContain("verze 2.1.300–2.1.305");
  });

  it("opakování znovupoužije větev, soubor i otevřený PR", async () => {
    const gh = fakeGithub({ branchExists: true, fileSha: "old", openPr: "https://github.com/tangero/vibecoding-site/pull/299" });
    const pr = await openSitePullRequest("t", "tangero/vibecoding-site", { path: "src/content/english/x.md", content: "č" }, { branch: "b", title: "T", body: "B" }, gh.f);
    expect(pr).toMatchObject({ url: "https://github.com/tangero/vibecoding-site/pull/299", created: false });
    expect(gh.calls.find((c) => c.method === "PUT")!.body.sha).toBe("old");
    expect(gh.calls.some((c) => c.method === "POST" && c.path === "/pulls")).toBe(false);
  });

  it("chyba GitHubu se vyhodí (retry fronty), ne tiše spolkne", async () => {
    const f = (async () => new Response("bad credentials", { status: 401 })) as unknown as typeof fetch;
    await expect(openSitePullRequest("t", "tangero/vibecoding-site", { path: "a.md", content: "x" }, { branch: "b", title: "T", body: "B" }, f))
      .rejects.toThrow(/GitHub repo failed: 401/);
    const err = await openSitePullRequest("t", "r/x", { path: "a.md", content: "x" }, { branch: "b", title: "T", body: "B" }, f).catch((e) => e);
    expect(err).toBeInstanceOf(GithubError);
    expect(err.permanent).toBe(true);
  });

  it("vydaný článek na webu bez force nepřepíše a model nevolá", async () => {
    await env.KV.put(selectionKvKey("w43"), JSON.stringify(SEL));
    const gh = fakeGithub({ onMain: true });
    const { llm, calls } = fakeLlm();
    const out = await publishEnglishWeekly({ ...env, VIBECODING_SITE_GITHUB_TOKEN: "t" } as never, "w43", { llm, fetch: gh.f });
    expect(out).toEqual({ kind: "already-published", path: "src/content/english/claude-code-weekly-2026-w43.md" });
    expect(calls).toHaveLength(0);
    expect(gh.calls.some((c) => c.method === "PUT")).toBe(false);
  });

  it("náhled se uloží a ostrý běh (i retry) ho použije bez nového psaní", async () => {
    await env.KV.put(selectionKvKey("w43"), JSON.stringify(SEL));
    const first = fakeLlm();
    const preview = await publishEnglishWeekly(env as never, "w43", { llm: first.llm, dryRun: true });
    expect(await env.KV.get(englishMdKvKey("w43"))).toBeTruthy();
    const second = fakeLlm();
    const gh = fakeGithub();
    await publishEnglishWeekly({ ...env, VIBECODING_SITE_GITHUB_TOKEN: "t" } as never, "w43", { llm: second.llm, fetch: gh.f });
    expect(second.calls).toHaveLength(0);
    const put = gh.calls.find((c) => c.method === "PUT")!;
    const content = new TextDecoder().decode(Uint8Array.from(atob(put.body.content), (ch) => ch.charCodeAt(0)));
    expect(preview.kind === "no-token" && preview.markdown).toBe(content);
  });
});
