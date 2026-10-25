import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { ccChangeItem } from "../../src/db/schema";
import { countUnclassified, classifyPending } from "../../src/lib/cc-news/classify";
import type { LlmFn } from "../../src/lib/cc-news/llm";
import {
  GROK_BOT_CHANGELOG_URL, GROK_BOT_DOCS, parseGrokBotChangelog, splitScope, syncGrokBot, toolReleasesKvKey,
} from "../../src/lib/tools/grok-bot";
import { CODING_TOOLS, ASSISTANT_TOOLS, TOOLS } from "../../src/lib/tools/registry";
import { parseSitemap } from "../../src/lib/cc-news/docs-snapshot";
import { buildToolWeek } from "../../src/lib/tools/weekly-tool";
import { GROK_BOT_EXA_TEXT } from "./fixtures/grok-bot-changelog";

/** Ukázka ze zadání (tvar textu z Exa). */
const SAMPLE = `Latest v0.75.5· Oct 23, 2026· RSS
October 23, 2026 Oct 23, 2026
v0.75.5
## Vault, email forwarding, and fewer approval cards
Also includes 0.75.3 and 0.75.4
### New
- Bots can save your logins to a Vault in Settings. Requires Grok Bot 0.75.2 or later.
### Improved
- Teammates in their own DM with a Team Bot can react to messages. Teams
### Fixed
- After you reset a chat whose first message was blocked, new messages get replies.
October 22, 2026 Oct 22, 2026
v0.75.2
## Pages, new chat cards, and video creation
Also includes 0.72.0, 0.72.1, 0.73.0, 0.73.1, 0.74.0, 0.75.0 and 0.75.1
### New
- Bots can build Pages.
October 14, 2026 Oct 14, 2026
v0.71.2
### New
- Older entry.
`;

describe("parseGrokBotChangelog", () => {
  it("rozloží ukázku: verze, název, Also includes, oddíly a štítek Teams", async () => {
    const p = await parseGrokBotChangelog(SAMPLE, "0.72.0");
    expect(p.latest).toBe("0.75.5");
    expect(p.releases.map((r) => r.version)).toEqual(["0.75.5", "0.75.2"]);
    expect(p.releases[0]).toMatchObject({ title: "Vault, email forwarding, and fewer approval cards", alsoIncludes: ["0.75.3", "0.75.4"], date: "2026-10-23", synthetic: false });
    expect(p.releases[1]!.alsoIncludes).toEqual(["0.72.0", "0.72.1", "0.73.0", "0.73.1", "0.74.0", "0.75.0", "0.75.1"]);
    const v5 = p.entries.filter((e) => e.version === "0.75.5");
    expect(v5.map((e) => e.type)).toEqual(["Added", "Improved", "Fixed"]);
    expect(v5[1]).toMatchObject({ scope: "Teams", text: "Teammates in their own DM with a Team Bot can react to messages." });
    expect(v5[0]!.publishedAt.toISOString()).toBe("2026-10-23T12:00:00.000Z");
    expect(v5[0]!.id).toMatch(/^grok-bot:0\.75\.5#[0-9a-f]{8}$/);
    // Nejstarší blok (mohl být useknutý) se nevrací, jen se ohlásí.
    expect(p.truncatedTail).toEqual({ version: "0.71.2", date: "2026-10-14" });
    expect(p.entries.some((e) => e.version === "0.71.2")).toBe(false);
    expect(p.unparsed).toEqual([]);
  });

  it("splitScope odstraní jen koncový štítek Teams/Enterprise", () => {
    expect(splitScope("Team Bots can mention a group. Teams")).toEqual({ text: "Team Bots can mention a group.", scope: "Teams" });
    expect(splitScope("Admins can delete VMs. Enterprise")).toEqual({ text: "Admins can delete VMs.", scope: "Enterprise" });
    expect(splitScope("Teams can now share Bots.")).toEqual({ text: "Teams can now share Bots.", scope: null });
  });

  it("skutečný text z Exa: počty v0.75.5, oddíly bez nadpisu ###, Enterprise", async () => {
    const p = await parseGrokBotChangelog(GROK_BOT_EXA_TEXT, "0.0.0");
    expect(p.latest).toBe("0.75.5");
    expect(p.unparsed).toEqual([]);
    const count = (v: string, t: string) => p.entries.filter((e) => e.version === v && e.type === t).length;
    expect([count("0.75.5", "Added"), count("0.75.5", "Improved"), count("0.75.5", "Fixed")]).toEqual([4, 11, 10]);
    expect(p.entries.filter((e) => e.version === "0.75.5" && e.scope === "Teams")).toHaveLength(5);
    // v0.68.0 má jen „### New“; další skupiny za prázdným řádkem jsou Improved a Fixed.
    const v68 = p.entries.filter((e) => e.version === "0.68.0");
    expect(v68.find((e) => e.text.startsWith("Marathi"))!.type).toBe("Added");
    expect(v68.find((e) => e.text.startsWith("Approval cards ask"))!.type).toBe("Improved");
    expect(v68.find((e) => e.text.startsWith("Copying or saving a large image"))!.type).toBe("Fixed");
    expect(p.entries.some((e) => e.scope === "Enterprise" && e.text.startsWith("Bot computers that are asleep"))).toBe(true);
  });

  it("blok s datem bez čísla verze dostane syntetickou verzi odspodu, stabilní po přidání nového vydání", async () => {
    const p = await parseGrokBotChangelog(GROK_BOT_EXA_TEXT, "0.0.0");
    const synth = p.releases.filter((r) => r.synthetic);
    expect(synth.map((r) => [r.version, r.date])).toEqual([
      ["0.55.0.6", "2026-10-02"], ["0.55.0.5", "2026-10-02"], ["0.55.0.4", "2026-09-30"],
      ["0.55.0.3", "2026-09-30"], ["0.55.0.2", "2026-09-29"], ["0.55.0.1", "2026-09-17"],
    ]);
    // Blok úplně bez nadpisů se třemi skupinami = New, Improved, Fixed.
    const auto = p.entries.find((e) => e.text.startsWith("Automatic Updates is on by default"))!;
    expect(auto).toMatchObject({ version: "0.55.0.4", type: "Improved" });
    expect(p.entries.find((e) => e.text.startsWith("When you connect an app, sign-in shows why"))!.type).toBe("Fixed");
    // Nové vydání nahoře syntetické verze starších bloků nezmění.
    const newer = GROK_BOT_EXA_TEXT.replace("Latest v0.75.5", "Latest v0.76.0")
      .replace("October 23, 2026 Oct 23, 2026", "October 24, 2026 Oct 24, 2026\n\nv0.76.0\n\n### New\n\n- Something new.\n\nOctober 23, 2026 Oct 23, 2026");
    const p2 = await parseGrokBotChangelog(newer, "0.0.0");
    expect(p2.releases.filter((r) => r.synthetic).map((r) => r.version)).toEqual(synth.map((r) => r.version));
  });

  it("od minVersion: starší bloky (i syntetické) se nevrací", async () => {
    const p = await parseGrokBotChangelog(GROK_BOT_EXA_TEXT, "0.68.0");
    expect(p.releases.map((r) => r.version)).toEqual(["0.75.5", "0.75.2", "0.71.2", "0.70.2", "0.68.1", "0.68.0"]);
    expect(p.releases.every((r) => !r.synthetic)).toBe(true);
  });

  it("verze bez data se neukládá ani nepřilepí k předchozímu vydání, ale ohlásí se", async () => {
    const md = SAMPLE.replace("- Bots can build Pages.\n", "- Bots can build Pages.\n\nv0.74.9\n\n### Fixed\n\n- Orphan fix.\n");
    const p = await parseGrokBotChangelog(md, "0.72.0");
    expect(p.entries.some((e) => e.text === "Orphan fix.")).toBe(false);
    expect(p.entries.filter((e) => e.version === "0.75.2").map((e) => e.text)).toEqual(["Bots can build Pages."]);
    expect(p.unparsed.some((u) => u.includes("verze 0.74.9 bez data") && u.includes("Orphan fix."))).toBe(true);
  });

  it("prázdný nebo rozbitý vstup je chyba, ne prázdný výsledek", async () => {
    await expect(parseGrokBotChangelog("")).rejects.toThrow(/žádné vydání/);
    await expect(parseGrokBotChangelog("<html>Just a moment...</html>")).rejects.toThrow(/žádné vydání/);
    await expect(parseGrokBotChangelog("October 23, 2026\nv0.75.5\n## Title only\n")).rejects.toThrow(/nemá žádnou položku/);
    await expect(parseGrokBotChangelog(SAMPLE.replace("Latest v0.75.5", "Latest v0.76.1"))).rejects.toThrow(/Latest v0.76.1/);
  });

  it("nerozpoznaný řádek v bloku se vrátí v unparsed", async () => {
    const p = await parseGrokBotChangelog(SAMPLE.replace("### Fixed\n", "### Fixed\nSome paragraph text.\n"), "0.72.0");
    expect(p.unparsed).toEqual(["2026-10-23: Some paragraph text."]);
  });
});

function fakeExa(text: string, status: { status: string; error?: unknown } = { status: "success" }) {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({
      requestId: "r1",
      results: status.status === "success" ? [{ url: GROK_BOT_CHANGELOG_URL, text }] : [],
      statuses: [{ id: GROK_BOT_CHANGELOG_URL, ...status, source: "crawled" }],
    }), { headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe("syncGrokBot", () => {
  const db = () => drizzle(env.DB);
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM cc_change_item");
    await env.KV.delete(toolReleasesKvKey("grok-bot"));
  });

  it("načte stránku přes Exa contents (text: true, x-api-key) a uloží položky od 0.68.0", async () => {
    const { f, calls } = fakeExa(GROK_BOT_EXA_TEXT);
    const r = await syncGrokBot(db(), env.KV, { apiKey: "test-key", fetch: f });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.exa.ai/contents");
    expect((calls[0]!.init.headers as Record<string, string>)["x-api-key"]).toBe("test-key");
    expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({ urls: [GROK_BOT_CHANGELOG_URL], text: true });
    expect(r).toMatchObject({ latest: "0.75.5", stored: "0.75.5", caughtUp: true, releases: 6, exaSource: "crawled" });
    const rows = await db().select().from(ccChangeItem).where(eq(ccChangeItem.tool, "grok-bot"));
    expect(rows.length).toBe(r.added);
    expect(rows.every((x) => x.topic === null && x.classifiedAt === null)).toBe(true);
    expect((await env.KV.get<{ version: string }[]>(toolReleasesKvKey("grok-bot"), "json"))!.map((x) => x.version)).toContain("0.75.2");
    // Opakování je idempotentní.
    expect((await syncGrokBot(db(), env.KV, { apiKey: "test-key", fetch: fakeExa(GROK_BOT_EXA_TEXT).f })).added).toBe(0);
  });

  it("položky asistenta se netřídí do taxonomie CC", async () => {
    await syncGrokBot(db(), env.KV, { apiKey: "k", fetch: fakeExa(GROK_BOT_EXA_TEXT).f });
    expect(await countUnclassified(db())).toBe(0);
    let called = false;
    const llm: LlmFn = async () => { called = true; return "[]"; };
    expect(await classifyPending(db(), {}, new Date(), 100, llm)).toBe(0);
    expect(called).toBe(false);
    await expect(buildToolWeek(db(), { KV: env.KV }, "grok-bot", { year: 2026, week: 43 }, new Date())).rejects.toThrow(/osobní asistent/);
  });

  it("chybějící klíč, chybový stav Exa a prázdný text jsou chyba", async () => {
    await expect(syncGrokBot(db(), env.KV, { fetch: fakeExa(GROK_BOT_EXA_TEXT).f })).rejects.toThrow(/EXA_API_KEY/);
    await expect(syncGrokBot(db(), env.KV, { apiKey: "k", fetch: fakeExa("", { status: "error", error: { tag: "CRAWL_NOT_FOUND", httpStatusCode: 403 } }).f }))
      .rejects.toThrow(/CRAWL_NOT_FOUND \(403\)/);
    await expect(syncGrokBot(db(), env.KV, { apiKey: "k", fetch: fakeExa("   ").f })).rejects.toThrow(/prázdný text/);
  });

  it("první naplnění s textem, který nesahá pod 0.68.0, je chyba (oříznutý text)", async () => {
    const cut = GROK_BOT_EXA_TEXT.slice(0, GROK_BOT_EXA_TEXT.indexOf("October 7, 2026"));
    await expect(syncGrokBot(db(), env.KV, { apiKey: "k", fetch: fakeExa(cut).f })).rejects.toThrow(/historie od 0.68.0 není celá/);
    expect(await db().select().from(ccChangeItem)).toHaveLength(0);
  });

  it("kopie, která nenavazuje na uloženou řadu, se neuloží", async () => {
    await syncGrokBot(db(), env.KV, { apiKey: "k", fetch: fakeExa(GROK_BOT_EXA_TEXT).f });
    const n = (await db().select().from(ccChangeItem)).length;
    // Jen nejnovější vydání (a jeden blok navíc, který se jako možná useknutý neukládá).
    const top = GROK_BOT_EXA_TEXT.slice(0, GROK_BOT_EXA_TEXT.indexOf("October 14, 2026"))
      .replace("Latest v0.75.5", "Latest v0.76.0")
      .replace("October 23, 2026 Oct 23, 2026", "October 24, 2026 Oct 24, 2026\n\nv0.76.0\n\n### New\n\n- New thing.\n\nOctober 23, 2026 Oct 23, 2026");
    // Kopie, ve které je jen nové vydání a 0.75.5 až jako (neukládaný) poslední blok.
    const cutAbove = "Latest v0.76.0· Oct 24, 2026\nOctober 24, 2026\nv0.76.0\n### New\n- New thing.\n\nOctober 23, 2026\nv0.75.5\n- filler\n";
    await expect(syncGrokBot(db(), env.KV, { apiKey: "k", fetch: fakeExa(cutAbove).f })).rejects.toThrow(/neobsahuje uloženou verzi 0.75.5/);
    expect((await db().select().from(ccChangeItem)).length).toBe(n);
    // Navazující kopie projde a přidá jen nové vydání.
    const r = await syncGrokBot(db(), env.KV, { apiKey: "k", fetch: fakeExa(top).f });
    expect(r).toMatchObject({ stored: "0.76.0", added: 1, caughtUp: true });
  });
});

describe("registr a dokumentace", () => {
  it("Grok Bot je asistent bez anglické řady, mimo témata a ekosystém", () => {
    expect(TOOLS["grok-bot"]).toMatchObject({ kind: "assistant", englishWeekly: false });
    expect(ASSISTANT_TOOLS).toEqual(["grok-bot"]);
    expect(CODING_TOOLS).not.toContain("grok-bot");
  });

  it("sitemap docs.x.ai: stránky Grok Bot, ne Grok Build", () => {
    const xml = `<urlset><url><loc>https://docs.x.ai/grok-bot/overview</loc><lastmod>2026-10-20</lastmod></url>
<url><loc>https://docs.x.ai/build/overview</loc><lastmod>2026-10-20</lastmod></url></urlset>`;
    expect(parseSitemap(xml, GROK_BOT_DOCS)).toEqual([{ path: "overview", lastmod: "2026-10-20" }]);
  });
});
