import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import { parseAntigravityRelease, syncAntigravity } from "../../src/lib/tools/antigravity";
import { releasesUrl, type GithubRelease } from "../../src/lib/tools/github-releases";

const BODY = `- Added \`agy plugin validate\` checks for skills and subagents.
- Improved CPU usage while typing.
  - nested detail
- Fixed an MCP server continuing to show as \`Ready\` in \`/mcp\` after exit.
- Removed the legacy \`--old\` flag.
- Remote Control now shows history in daemon mode.
`;
const rel = (tag: string, at: string, body = BODY, prerelease = false): GithubRelease => ({ tag_name: tag, prerelease, draft: false, published_at: at, body });

beforeEach(async () => {
  await env.DB.exec("DELETE FROM cc_change_item");
});

describe("parseAntigravityRelease", () => {
  it("typ z prvního slova, vnořené odrážky vynechá", async () => {
    const out = await parseAntigravityRelease(rel("1.4.1", "2026-10-17T20:43:34Z"));
    expect(out.map((e) => e.type)).toEqual(["Added", "Improved", "Fixed", "Removed", "Other"]);
    expect(out[0]).toMatchObject({ version: "1.4.1", ord: 1, scope: null });
    expect(out[0]!.id).toMatch(/^antigravity:1\.4\.1#[0-9a-f]{8}$/);
  });

  it("předběžná vydání a neplatné tagy vynechá", async () => {
    expect(await parseAntigravityRelease(rel("1.5.0", "2026-10-18T00:00:00Z", BODY, true))).toEqual([]);
    expect(await parseAntigravityRelease(rel("nightly", "2026-10-18T00:00:00Z"))).toEqual([]);
  });
});

describe("syncAntigravity", () => {
  it("stáhne vydání z repozitáře google-antigravity/antigravity-cli", async () => {
    const calls: string[] = [];
    const f = (async (url: string) => {
      calls.push(url);
      return new Response(JSON.stringify(url.endsWith("page=1") ? [rel("1.4.1", "2026-10-17T20:43:34Z")] : []));
    }) as unknown as typeof fetch;
    const r = await syncAntigravity(drizzle(env.DB), { f });
    expect(calls[0]).toBe(releasesUrl("google-antigravity/antigravity-cli", 1));
    expect(r).toMatchObject({ newest: "1.4.1", latest: "1.4.1", added: 5, caughtUp: true, backfilled: true });
  });
});
