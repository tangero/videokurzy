import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import { ccChangeItem } from "../../src/db/schema";
import {
  CHANGELOG_MD_URL, COMMITS_URL, FIRST_SEEN_KV, NPM_URL, parseMuseChangelog, releaseDates, resolveDates, syncMuseCode,
} from "../../src/lib/tools/muse-code";

const MD = `# Changelog

What's new, improved, and fixed in each Muse Code release.

## 1.4.10

### New

- Added \`/blender\` to reconstruct reference images as editable Blender scenes

### Improvements

- Long analysis answers use short sentences and paragraphs

### Fixes

- **Security:** Sandboxed commands can no longer read sign-in details stored in \`~/.config/muse\`
- Manual \`/compact\` now compacts sessions with MCP servers configured

### Performance

- \`/btw\`, \`/side\`, and \`/fork\` open faster in very large compacted sessions

## 1.4.5

### Fixes

- Resuming a session no longer drops its last turn

## 1.0.x

Also delivered in 1.0.x patches: a setting and a fix.

## 0.1.0

Launch version
`;

const commit = (message: string, date: string) => ({ commit: { message, committer: { date } } });
const NPM_TIME = { created: "2026-08-31T06:52:22Z", "0.1.0": "2026-08-31T06:52:22Z", "1.4.6": "2026-10-11T23:20:44Z", "1.4.10": "2026-10-16T17:31:56Z", "1.4.11": "2026-10-19T18:55:00Z" };
const COMMITS = [
  commit("remirror: 1.4.10 from the internal source tree (tracked internally)", "2026-10-16T17:26:23Z"),
  commit("Re-mirror the SDK closure at tbh@fda770f (1.4.2 lockstep)\n\nbody", "2026-09-30T20:08:37Z"),
  commit("Add public issue triage guidance", "2026-10-09T16:28:26Z"),
];

beforeEach(async () => {
  await env.DB.exec("DELETE FROM cc_change_item");
  await env.KV.delete(FIRST_SEEN_KV);
});

describe("parseMuseChangelog", () => {
  it("verze, typ podle oddílu, Security jako rozsah; souhrnné oddíly a verze bez odrážek vynechá", () => {
    const out = parseMuseChangelog(MD);
    expect(out.map((v) => v.version)).toEqual(["1.4.10", "1.4.5"]);
    expect(out[0]!.items.map((i) => i.type)).toEqual(["Added", "Improved", "Fixed", "Fixed", "Improved"]);
    expect(out[0]!.items[2]).toEqual({ type: "Fixed", scope: "Security", text: "Sandboxed commands can no longer read sign-in details stored in `~/.config/muse`" });
    expect(out[1]!.items).toHaveLength(1);
  });
});

describe("data vydání", () => {
  it("nejdřívější z npm a commitů (remirror i lockstep), ostatní commity ignoruje", () => {
    const d = releaseDates(NPM_TIME, COMMITS);
    expect(d.get("1.4.10")!.toISOString()).toBe("2026-10-16T17:26:23.000Z");
    expect(d.get("1.4.2")!.toISOString()).toBe("2026-09-30T20:08:37.000Z");
    expect(d.has("created")).toBe(false);
  });

  it("verze bez data dostane datum nejbližší vyšší verze s datem, nejnovější den prvního výskytu", () => {
    const known = releaseDates(NPM_TIME, COMMITS);
    const now = new Date("2026-10-20T08:00:00Z");
    const r = resolveDates(["1.4.12", "1.4.10", "1.4.5", "1.4.3"], known, {}, now);
    expect(r.dates.get("1.4.5")!.toISOString().slice(0, 10)).toBe("2026-10-11"); // 1.4.6
    expect(r.dates.get("1.4.3")!.toISOString().slice(0, 10)).toBe("2026-10-11"); // nejbližší vyšší s datem: 1.4.6
    expect(r.dates.get("1.4.12")).toEqual(now);
    expect(r.approx).toEqual(["1.4.12", "1.4.5", "1.4.3"]);
    // Den prvního výskytu se neposouvá.
    const again = resolveDates(["1.4.12"], known, r.firstSeen, new Date("2026-10-25T08:00:00Z"));
    expect(again.dates.get("1.4.12")).toEqual(now);
  });
});

describe("syncMuseCode", () => {
  const fake = (o: { npm?: boolean; gh?: boolean } = {}) => {
    const calls: string[] = [];
    const f = (async (url: string) => {
      calls.push(url);
      if (url === CHANGELOG_MD_URL) return new Response(MD);
      if (url === NPM_URL) return o.npm === false ? new Response("x", { status: 503 }) : Response.json({ time: NPM_TIME });
      if (url === COMMITS_URL) return o.gh === false ? new Response("x", { status: 503 }) : Response.json(COMMITS);
      return new Response("?", { status: 404 });
    }) as unknown as typeof fetch;
    return { f, calls };
  };

  it("uloží položky s daty a ohlásí vydanou verzi, kterou changelog ještě nemá", async () => {
    const db = drizzle(env.DB);
    const r = await syncMuseCode(db, env.KV, { f: fake().f, now: new Date("2026-10-20T08:00:00Z") });
    expect(r).toMatchObject({ latest: "1.4.10", versions: 2, added: 6, approx: ["1.4.5"] });
    expect(r.missing.map((m) => m.version)).toEqual(["1.4.11"]);
    const rows = await db.select().from(ccChangeItem);
    expect(new Set(rows.map((x) => x.tool))).toEqual(new Set(["muse-code"]));
    expect(rows.find((x) => x.version === "1.4.5")!.publishedAt.toISOString().slice(0, 10)).toBe("2026-10-11"); // 1.4.6 z npm
    expect(rows.find((x) => x.scope === "Security")!.id).toMatch(/^muse-code:1\.4\.10#[0-9a-f]{8}$/);
    expect((await syncMuseCode(db, env.KV, { f: fake().f })).added).toBe(0);
  });

  it("stačí jeden zdroj dat; bez obou selže, aby historie nespadla do dneška", async () => {
    const db = drizzle(env.DB);
    expect((await syncMuseCode(db, env.KV, { f: fake({ gh: false }).f })).added).toBe(6);
    await env.DB.exec("DELETE FROM cc_change_item");
    await expect(syncMuseCode(db, env.KV, { f: fake({ gh: false, npm: false }).f })).rejects.toThrow(/npm i GitHub/);
  });
});
