import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import { ccChangeItem } from "../../src/db/schema";
import type { LlmFn } from "../../src/lib/cc-news/llm";
import {
  ASSISTANT_AREAS, assistantBackfillWeeks, assistantMdKvKey, assistantMergeId, assistantNoteMarkdown, assistantNotePath,
  assistantNoteUrl, parseAssistantMergeId, publishAssistantWeek, versionRange, writeAssistantNote, type AssistantNote,
} from "../../src/lib/tools/assistant-cs";
import { toolReleasesKvKey, type AssistantRelease } from "../../src/lib/tools/grok-bot";

const W43 = { year: 2026, week: 43 };
const at = (d: string) => new Date(`${d}T12:00:00Z`);

type Row = typeof ccChangeItem.$inferSelect;
const row = (id: string, version: string, date: string, ord: number, type: string, text: string, scope: string | null = null): Row => ({
  id, tool: "grok-bot", version, publishedAt: at(date), ord, type, scope, text,
  topic: null, significance: null, reason: null, followsId: null, relation: null, followReason: null, classifiedAt: null, promptVersion: null,
});
const ROWS: Row[] = [
  row("grok-bot:0.75.2#aaaa0001", "0.75.2", "2026-10-22", 1, "Added", "Bots can build Pages you can share."),
  row("grok-bot:0.75.5#bbbb0001", "0.75.5", "2026-10-23", 1, "Added", "Bots can save your logins to a Vault in Settings."),
  row("grok-bot:0.75.5#bbbb0002", "0.75.5", "2026-10-23", 2, "Improved", "Teammates in their own DM with a Team Bot can react to messages.", "Teams"),
  row("grok-bot:0.75.5#bbbb0003", "0.75.5", "2026-10-23", 3, "Fixed", "After you reset a chat, new messages get replies."),
  row("grok-bot:0.75.5#bbbb0004", "0.75.5", "2026-10-23", 4, "Other", "Auto-review asks less often."),
];
const RELEASES: AssistantRelease[] = [
  { version: "0.75.5", synthetic: false, date: "2026-10-23", title: "Vault", alsoIncludes: ["0.75.3", "0.75.4"], items: 4 },
  { version: "0.75.2", synthetic: false, date: "2026-10-22", title: "Pages", alsoIncludes: ["0.75.0", "0.75.1"], items: 1 },
];
const [P, V, T, F, O] = ROWS.map((r) => r.id) as [string, string, string, string, string];

/** Podvržený autor: Teams položku dá do špatného oddílu, Other vynechá, jednu oblast vymyslí. */
function fakeLlms(opts: { failClaim?: string; fixText?: string | null } = {}) {
  const calls: { kind: string; user: string }[] = [];
  const write: LlmFn = async (system, user) => {
    if (system.startsWith("Píšeš český týdenní zápis")) {
      calls.push({ kind: "write", user });
      return JSON.stringify({
        headline: "Grok Bot: Vault a Pages.",
        summary: "Boti umí ukládat přihlášení do Vaultu a stavět stránky Pages.",
        highlights: [{ text: "Boti ukládají přihlášení do Vaultu.", sources: [V] }, { text: "Boti staví stránky Pages.", sources: [P, "neexistuje"] }],
        main: { text: "Vault v nastavení ukládá přihlášení — boti je pak vyplní.", sources: [V] },
        items: [
          { section: "new", text: "Boti staví stránky Pages, které jde sdílet.", sources: [P], area: "vystupy" },
          { section: "new", text: "Vault v nastavení ukládá přihlášení.", sources: [V], area: "ucet" },
          { section: "new", text: "V týmech mohou kolegové reagovat na zprávy Team Bota.", sources: [T], area: "tymy" },
          { section: "fixed", text: "Po resetu chatu přicházejí odpovědi.", sources: [F], area: "neznama" },
        ],
      });
    }
    if (system.startsWith("Tyto položky changelogu chybí")) {
      calls.push({ kind: "missing", user });
      return JSON.stringify({ items: [{ section: "improved", text: "Auto-review se ptá méně často.", sources: [O], area: "schvalovani" }] });
    }
    if (system.startsWith("České body zápisu neprošly")) {
      calls.push({ kind: "fix", user });
      return JSON.stringify(opts.fixText === null ? [{ n: 1, drop: true }] : [{ n: 1, text: opts.fixText ?? "Po resetu chatu přijdou odpovědi." }]);
    }
    throw new Error(`neočekávaný prompt: ${system.slice(0, 40)}`);
  };
  const verify: LlmFn = async (_system, user) => {
    calls.push({ kind: "verify", user });
    const claims = [...user.matchAll(/^CLAIM (\d+): (.*)$/gm)];
    return JSON.stringify(claims.map((m) => ({ n: Number(m[1]), supported: !(opts.failClaim && m[2]!.includes(opts.failClaim)), problem: "přidaný fakt" })));
  };
  return { llms: { write, verify }, calls };
}

function note(over: Partial<AssistantNote> = {}): AssistantNote {
  return {
    v: 1, tool: "grok-bot", week: W43, builtAt: "2026-10-27T03:00:00Z",
    headline: "Vault a Pages", summary: "Shrnutí týdne.", highlights: ["Vault."], main: "Hlavní změna — Vault.",
    sections: { new: [{ text: "Vault.", sources: [V], area: "ucet" }], improved: [], fixed: [{ text: "Oprava.", sources: [F], area: null }] },
    areas: ["ucet"], counts: { new: 1, improved: 0, fixed: 1 }, versions: "0.75.0–0.75.5",
    review: { dropped: [], fixed: 0, uncovered: [], badAreas: [] },
    ...over,
  };
}

describe("writeAssistantNote", () => {
  it("drží oddíl podle typu položky, doplní chybějící položku, zahodí neznámou oblast a ověří fakta", async () => {
    const { llms, calls } = fakeLlms({ failClaim: "Po resetu chatu přicházejí" });
    const n = (await writeAssistantNote("grok-bot", W43, ROWS, RELEASES, llms, at("2026-10-27")))!;
    expect(n.headline).toBe("Vault a Pages");
    expect(n.main).toBe("Vault v nastavení ukládá přihlášení - boti je pak vyplní.");
    expect(n.sections.new.map((b) => b.sources)).toEqual([[P], [V]]);
    // Položka typu Improved zůstane ve Vylepšených, i když ji model dal do Nových.
    expect(n.sections.improved.map((b) => b.sources)).toEqual([[T], [O]]);
    expect(n.sections.fixed).toEqual([{ text: "Po resetu chatu přijdou odpovědi.", sources: [F], area: null }]);
    expect(n.highlights).toEqual(["Boti ukládají přihlášení do Vaultu.", "Boti staví stránky Pages."]);
    expect(n.counts).toEqual({ new: 2, improved: 2, fixed: 1 });
    expect(n.areas.every((a) => ASSISTANT_AREAS["grok-bot"]!.some((x) => x.key === a))).toBe(true);
    expect(n.versions).toBe("0.75.0–0.75.5");
    expect(n.review).toEqual({ dropped: [], fixed: 1, uncovered: [], badAreas: ["neznama"] });
    expect(calls.map((c) => c.kind)).toEqual(["write", "missing", "verify", "fix", "verify"]);
    // Vstup modelu nese štítek Teams a názvy vydání.
    expect(calls[0]!.user).toContain(`${T} | Improved [Teams] |`);
    expect(calls[0]!.user).toContain("VYDÁNÍ 0.75.5, 2026-10-23: Vault (zahrnuje i 0.75.3, 0.75.4)");
  });

  it("bod, který neprojde ani po opravě, se vyřadí a jeho položka je v revizi jako nepokrytá", async () => {
    const { llms } = fakeLlms({ failClaim: "Po resetu", fixText: "Po resetu chatu vše funguje." });
    const n = (await writeAssistantNote("grok-bot", W43, ROWS, RELEASES, llms, at("2026-10-27")))!;
    expect(n.sections.fixed).toEqual([]);
    expect(n.review.dropped).toEqual([{ text: "Po resetu chatu přicházejí odpovědi.", problem: "přidaný fakt" }]);
    expect(n.review.uncovered).toEqual([F]);
  });

  it("neověřená hlavní změna je chyba; týden bez položek vrátí null", async () => {
    await expect(writeAssistantNote("grok-bot", W43, ROWS, RELEASES, fakeLlms({ failClaim: "Vault v nastavení ukládá přihlášení -", fixText: null }).llms, at("2026-10-27")))
      .rejects.toThrow(/hlavní změna neprošla/);
    expect(await writeAssistantNote("grok-bot", W43, [], RELEASES, fakeLlms().llms, at("2026-10-27"))).toBeNull();
  });

  it("rozsah verzí: Also includes ano, syntetické verze bloků bez čísla ne", () => {
    expect(versionRange(ROWS, RELEASES)).toBe("0.75.0–0.75.5");
    expect(versionRange([{ version: "0.55.0.3" }], [{ version: "0.55.0.3", synthetic: true, date: "", title: null, alsoIncludes: [], items: 1 }])).toBeNull();
    expect(versionRange([{ version: "0.76.0" }], [])).toBe("0.76.0");
  });
});

describe("assistantNoteMarkdown (kontrakt docs/novinky-asistentu.md webu)", () => {
  it("frontmatter, týden velkým W v souboru malým w, datum = pondělí po týdnu, prázdný oddíl vynechán", () => {
    const md = assistantNoteMarkdown(note());
    expect(assistantNotePath("grok-bot", W43)).toBe("src/content/novinky/grok-bot/2026-w43.md");
    expect(md).toBe([
      "---",
      'title: "Grok Bot v týdnu 43: Vault a Pages"',
      "date: 2026-10-26",
      "tool: grok-bot",
      "week: 2026-W43",
      'versions: "0.75.0–0.75.5"',
      'summary: "Shrnutí týdne."',
      "highlights:",
      '  - "Vault."',
      "areas:",
      "  - ucet",
      "counts:",
      "  new: 1",
      "  improved: 0",
      "  fixed: 1",
      "source_url: https://x.ai/changelog/bot",
      "---",
      "",
      "## Hlavní změna týdne",
      "",
      "Hlavní změna - Vault.",
      "",
      "## Nové",
      "",
      "- Vault.",
      "",
      "## Opravené",
      "",
      "- Oprava.",
      "",
    ].join("\n"));
  });

  it("neplatné oblasti nebo počet highlights se do souboru nedostanou", () => {
    expect(() => assistantNoteMarkdown(note({ areas: ["neznama"] }))).toThrow(/neznámé oblasti/);
    expect(() => assistantNoteMarkdown(note({ highlights: [] }))).toThrow(/highlights/);
    expect(() => assistantNoteMarkdown(note({ highlights: ["1", "2", "3", "4", "5", "6"] }))).toThrow(/highlights/);
  });

  it("ID slučování a adresa zápisu", () => {
    expect(assistantMergeId("grok-bot", W43)).toBe("assistant-grok-bot-2026-w43");
    expect(parseAssistantMergeId("assistant-grok-bot-2026-w43")).toEqual({ tool: "grok-bot", week: W43 });
    expect(parseAssistantMergeId("assistant-codex-2026-w43")).toBeNull();
    expect(assistantNoteUrl("grok-bot", W43)).toBe("https://www.vibecoding.cz/novinky/grok-bot/2026-w43/");
  });
});

/** Podvržené GitHub API (jako v cc-news-english.test.ts). */
function fakeGithub(state: { onMain?: boolean } = {}) {
  const calls: { method: string; path: string; body?: any }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    const path = url.replace("https://api.github.com/repos/tangero/vibecoding-site", "");
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path, body });
    const j = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status, headers: { "content-type": "application/json" } });
    if (method === "GET" && path === "") return j({ default_branch: "main" });
    if (path === "/git/ref/heads/main") return j({ object: { sha: "base123" } });
    if (path === "/git/refs") return j({}, 201);
    if (method === "GET" && path.startsWith("/contents/") && !path.includes("?ref=")) return state.onMain ? j({ sha: "main" }) : j({}, 404);
    if (method === "GET" && path.startsWith("/contents/")) return j({}, 404);
    if (method === "PUT") return j({ content: { sha: "written1" } }, 201);
    if (method === "GET" && path.startsWith("/pulls")) return j([]);
    if (method === "POST" && path === "/pulls") return j({ html_url: "https://github.com/tangero/vibecoding-site/pull/400", number: 400 }, 201);
    return j({ message: "unexpected" }, 500);
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe("publishAssistantWeek", () => {
  const db = () => drizzle(env.DB);
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM cc_change_item");
    for (const k of (await env.KV.list({ prefix: "tools:" })).keys) await env.KV.delete(k.name);
    await env.KV.put(toolReleasesKvKey("grok-bot"), JSON.stringify(RELEASES));
  });
  const seed = () => db().insert(ccChangeItem).values(ROWS.map(({ id, tool, version, publishedAt, ord, type, scope, text }) => ({ id, tool, version, publishedAt, ord, type, scope, text })));

  it("týden bez položek nic nezapisuje", async () => {
    const gh = fakeGithub();
    const out = await publishAssistantWeek(db(), { KV: env.KV, VIBECODING_SITE_GITHUB_TOKEN: "t" }, "grok-bot", W43, { llms: fakeLlms().llms, fetch: gh.f });
    expect(out).toEqual({ kind: "empty" });
    expect(gh.calls.filter((c) => c.method !== "GET")).toHaveLength(0);
  });

  it("nanečisto vrátí markdown; ostrý běh použije uložený text a otevře PR se souborem", async () => {
    await seed();
    const { llms, calls } = fakeLlms();
    const dry = await publishAssistantWeek(db(), { KV: env.KV }, "grok-bot", W43, { llms, dryRun: true });
    expect(dry.kind).toBe("no-token");
    if (dry.kind !== "no-token") return;
    expect(dry.path).toBe("src/content/novinky/grok-bot/2026-w43.md");
    expect(dry.markdown).toContain("week: 2026-W43");
    expect(await env.KV.get(assistantMdKvKey("grok-bot", W43))).not.toBeNull();
    const writes = calls.filter((c) => c.kind === "write").length;

    const gh = fakeGithub();
    const out = await publishAssistantWeek(db(), { KV: env.KV, VIBECODING_SITE_GITHUB_TOKEN: "t" }, "grok-bot", W43, { llms, fetch: gh.f });
    expect(out.kind).toBe("pr");
    expect(calls.filter((c) => c.kind === "write").length).toBe(writes);
    const put = gh.calls.find((c) => c.method === "PUT")!;
    expect(put.path).toBe("/contents/src/content/novinky/grok-bot/2026-w43.md");
    expect(put.body.branch).toBe("novinky/grok-bot-2026-w43");
    const pr = gh.calls.find((c) => c.method === "POST" && c.path === "/pulls")!;
    expect(pr.body.title).toBe("Novinky Grok Bot 2026-W43");
    expect(pr.body.body).toContain("🤖 Generated by videokurzy");
  });

  it("zápis, který už je na webu, se bez force nepřepisuje", async () => {
    await seed();
    const out = await publishAssistantWeek(db(), { KV: env.KV, VIBECODING_SITE_GITHUB_TOKEN: "t" }, "grok-bot", W43, { llms: fakeLlms().llms, fetch: fakeGithub({ onMain: true }).f });
    expect(out).toEqual({ kind: "already-published", path: "src/content/novinky/grok-bot/2026-w43.md" });
  });

  it("zpětné doplnění: uzavřené týdny s položkami od zadané verze", async () => {
    await seed();
    await db().insert(ccChangeItem).values([
      { id: "grok-bot:0.68.0#1", tool: "grok-bot", version: "0.68.0", publishedAt: at("2026-10-05"), ord: 1, type: "Added", text: "a" },
      { id: "grok-bot:0.55.0.6#1", tool: "grok-bot", version: "0.55.0.6", publishedAt: at("2026-10-02"), ord: 1, type: "Added", text: "b" },
      { id: "grok-bot:0.76.0#1", tool: "grok-bot", version: "0.76.0", publishedAt: at("2026-10-27"), ord: 1, type: "Added", text: "c" },
    ]);
    expect(await assistantBackfillWeeks(db(), "grok-bot", "0.68.0", W43)).toEqual([{ year: 2026, week: 41 }, W43]);
  });
});
