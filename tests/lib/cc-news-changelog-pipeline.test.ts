import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ccChangeItem, ccNewsItem } from "../../src/db/schema";
import { parseChangelog, parseReleaseDates } from "../../src/lib/cc-news/changelog-source";
import { classifyPending, linkFollowsForVersions, syncChangelogEntries } from "../../src/lib/cc-news/classify";
import { createChangelogWeekItem } from "../../src/lib/cc-news/changelog-week";
import { detectRecent } from "../../src/lib/cc-news/detect";
import {
  DOCS_INDEX_KEY, contentLines, docsPageKey, docsWeekKey, parseSitemap, snapshotDocs, type DocsIndex,
} from "../../src/lib/cc-news/docs-snapshot";
import {
  buildChangelogArticle, czechDateRange, extractEditorNotes, stripUnknownDocLinks, versionViolations,
} from "../../src/lib/cc-news/weekly";
import { publishedKvKey } from "../../src/lib/cc-news/draft";
import type { LlmFn } from "../../src/lib/cc-news/llm";

const NOW = new Date("2026-09-21T03:00:00Z");
const W38 = { year: 2026, week: 38 };

const CHANGELOG = `## 2.1.278
- Changed auto mode to default to the server-side classifier
- Fixed a typo in a tooltip

## 2.1.275
- Added syncing of skills from your claude.ai account to the terminal
- Added a send-now key that sends queued messages at once
- Fixed a crash when resuming

## 2.1.271
- Added per-command allowed domains for sandboxed commands
- Fixed flicker in fullscreen
- Fixed a rare hang

## 2.1.269
- Added \`claude plugin eval\`
`;
const DOCS = `<Update label="2.1.278" description="September 19, 2026">
<Update label="2.1.275" description="September 17, 2026">
<Update label="2.1.271" description="September 14, 2026">
<Update label="2.1.269" description="September 11, 2026">`;

const idsIn = (text: string) => [...text.matchAll(/^(?:\s*-\s*)?(\d+\.\d+\.\d+#[0-9a-f]+(?:-\d+)?|docs:[^\s|]+)\s*\|/gm)].map((m) => m[1]!);

/** Podvržený model: odpověď podle systémového promptu. `calls` zaznamenává volání. */
function fakeLlm(overrides: Partial<Record<string, (user: string) => string>> = {}) {
  const calls: { kind: string; user: string }[] = [];
  const kindOf = (system: string) =>
    system.startsWith("You classify") ? "classify" :
    system.startsWith("You link") ? "follow" :
    system.startsWith("You compare two versions") ? "docs" :
    system.startsWith("A NEW Claude Code documentation page") ? "page" :
    system.startsWith("You are the editor") ? "select" :
    system.startsWith("These significant") ? "place" :
    system.startsWith("You check claims") ? "verify" :
    system.startsWith("A digest feature failed") ? "fix" :
    system.startsWith("Jsi Patrick Zandl") ? "write" :
    system.startsWith("Opravuješ čísla verzí") ? "versionfix" : "unknown";
  const defaults: Record<string, (user: string) => string> = {
    classify: (u) => JSON.stringify(idsIn(u).map((id) => ({
      id, topic: /auto mode|domains/.test(u.split("\n").find((l) => l.startsWith(id)) ?? "") ? "permissions" : "plugins",
      significance: /Added|Changed/.test(u.split("\n").find((l) => l.startsWith(id)) ?? "") ? 3 : 1, reason: "test",
    }))),
    follow: () => "[]",
    docs: () => JSON.stringify([{ text: "Projects coordinate parallel cloud sessions.", evidence: "A project is one ongoing conversation" }]),
    page: () => JSON.stringify({ text: "Projects let Claude coordinate parallel cloud sessions; public beta on Pro and Max.", evidence: "A project is one ongoing conversation" }),
    select: (u) => {
      const must = (u.match(/^MUST PLACE[^:]*: (.*)$/m)?.[1] ?? "").split(", ").filter((x) => x && x !== "(none)");
      const [first, ...rest] = must;
      return JSON.stringify({
        features: [
          { title: "Projects", version: "web", lede: "Projects coordinate cloud sessions.", sourceIds: must.filter((m) => m.startsWith("docs:")), docLink: "https://code.claude.com/docs/en/claude-projects" },
          { title: "Allowed domains", version: "v2.1.271", lede: "Per-command domains.", sourceIds: [first], docLink: "https://code.claude.com/docs/en/not-a-page" },
        ],
        minorWins: rest.filter((m) => !m.startsWith("docs:")).slice(0, 2).map((id) => ({ text: "minor", sourceIds: [id] })),
        skipped: [],
      });
    },
    place: (u) => JSON.stringify({ minorWins: [], skipped: idsIn(u).map((id) => ({ id, reason: "niche" })) }),
    verify: () => JSON.stringify([{ n: 1, supported: true, problem: "" }, { n: 2, supported: true, problem: "" }]),
    fix: () => JSON.stringify({ drop: true }),
    write: () => JSON.stringify({
      title: "Projects — přebírají koordinaci",
      excerpt: "Přehled týdne.",
      summaryPoints: ["Projects koordinují cloudová sezení."],
      body: "*Kolik sezení uhlídáte?*\n\n<!-- Poznámka: ověřit tarify -->\n---\n\n## Projects\n\n**Dispečer.** Claude koordinuje vlákna — sám ([dokumentace](https://code.claude.com/docs/en/claude-projects)). Verze 2.1.999.\n\n**Odkaz.** [Nic](https://code.claude.com/docs/en/not-a-page).",
    }),
    versionfix: (u) => u.slice(u.indexOf("ČLÁNEK:\n") + 8).replace("Verze 2.1.999.", "Verze 2.1.271."),
  };
  const llm: LlmFn = async (system, user) => {
    const kind = kindOf(system);
    calls.push({ kind, user });
    return (overrides[kind] ?? defaults[kind] ?? (() => "{}"))(user);
  };
  return { llm, calls };
}

async function seed() {
  const db = drizzle(env.DB);
  const entries = await parseChangelog(CHANGELOG, parseReleaseDates(DOCS));
  await syncChangelogEntries(db, entries);
  return { db, entries };
}

beforeEach(async () => {
  await env.DB.exec("DELETE FROM cc_change_item");
  await env.DB.exec("DELETE FROM cc_news_item");
  for (const k of (await env.KV.list({ prefix: "cc-" })).keys) await env.KV.delete(k.name);
});

afterEach(() => vi.restoreAllMocks());

describe("syncChangelogEntries + classifyPending", () => {
  it("vloží jen nové položky a opakovaně nic nezdvojí", async () => {
    const { db, entries } = await seed();
    expect(await syncChangelogEntries(db, entries)).toBe(0);
    const rows = await db.select().from(ccChangeItem);
    expect(rows).toHaveLength(entries.length);
  });

  it("roztřídí položky a rozbitou dávku rozpůlí", async () => {
    const { db } = await seed();
    const { llm, calls } = fakeLlm({
      // Dávka nad 5 položek vrací useknutý JSON → musí se rozpůlit.
      classify: (u) => idsIn(u).length > 5 ? '[{"id": "x", "topic": "plug' :
        JSON.stringify(idsIn(u).map((id) => ({ id, topic: "nonsense-topic", significance: 7, reason: "r" }))),
    });
    const done = await classifyPending(db, env as never, NOW, 100, llm);
    const rows = await db.select().from(ccChangeItem);
    expect(done).toBe(rows.length);
    expect(rows.every((r) => r.topic === "other" && r.significance === 1 && r.classifiedAt)).toBe(true);
    expect(calls.filter((c) => c.kind === "classify").length).toBeGreaterThan(1);
  });

  it("návaznost přijme jen existující a starší položku", async () => {
    const { db } = await seed();
    const { llm } = fakeLlm();
    await classifyPending(db, env as never, NOW, 100, llm);
    const rows = await db.select().from(ccChangeItem).where(eq(ccChangeItem.topic, "permissions"));
    const older = rows.find((r) => r.version === "2.1.271")!;
    const newer = rows.find((r) => r.version === "2.1.278")!;
    const { llm: followLlm } = fakeLlm({
      follow: () => JSON.stringify([
        { id: newer.id, followsId: older.id, relation: "rozšiřuje", reason: "stejná oblast" },
        { id: older.id, followsId: newer.id, relation: "mění", reason: "nesmysl — novější" },
        { id: newer.id, followsId: "9.9.9#deadbeef", relation: "mění", reason: "neexistuje" },
      ]),
    });
    await linkFollowsForVersions(db, env as never, ["2.1.271", "2.1.278"], followLlm);
    const after = new Map((await db.select().from(ccChangeItem)).map((r) => [r.id, r]));
    expect(after.get(newer.id)!.followsId).toBe(older.id);
    expect(after.get(older.id)!.followsId).toBeNull();
  });
});

describe("createChangelogWeekItem", () => {
  it("založí vydání s rozsahem navazujícím na poslední vydání a podruhé ho nezdvojí", async () => {
    const { db } = await seed();
    await db.insert(ccNewsItem).values({ id: "w37", sourceId: "/docs/en/whats-new/2026-w37", contentHash: "h", weekLabel: "Week 37", versionRange: "v2.1.263–v2.1.269", status: "published", createdAt: NOW });
    const out = await createChangelogWeekItem(db, W38, NOW);
    expect(out).toMatchObject({ kind: "created", sourceId: "/changelog/2026-w38", versionRange: "v2.1.271–v2.1.278" });
    expect((await createChangelogWeekItem(db, W38, NOW)).kind).toBe("exists");
  });

  it("nezaloží, když za týden existuje oficiální přehled", async () => {
    const { db } = await seed();
    await db.insert(ccNewsItem).values({ id: "o38", sourceId: "/docs/en/whats-new/2026-w38", contentHash: "h", weekLabel: "Week 38", versionRange: "v2.1.270–v2.1.278", status: "draft", createdAt: NOW });
    expect((await createChangelogWeekItem(db, W38, NOW)).kind).toBe("official");
  });

  it("zpětný týden jde založit i po založení novějšího týdne", async () => {
    const { db } = await seed();
    await db.insert(ccNewsItem).values([
      { id: "w37", sourceId: "/docs/en/whats-new/2026-w37", contentHash: "h", weekLabel: "Week 37", versionRange: "v2.1.263–v2.1.269", status: "published", createdAt: NOW },
      // cron mezitím založil W42 s vyšším rozsahem verzí
      { id: "w42", sourceId: "/changelog/2026-w42", contentHash: "h", weekLabel: "Week 42", versionRange: "v2.1.299–v2.1.302", status: "draft", createdAt: NOW },
    ]);
    expect(await createChangelogWeekItem(db, W38, NOW)).toMatchObject({ kind: "created", versionRange: "v2.1.271–v2.1.278" });
  });

  it("týden bez nových verzí je prázdný", async () => {
    const { db } = await seed();
    await db.insert(ccNewsItem).values({ id: "x", sourceId: "/changelog/2026-w37", contentHash: "h", weekLabel: "Week 37", versionRange: "v2.1.269–v2.1.278", status: "published", createdAt: NOW });
    expect((await createChangelogWeekItem(db, W38, NOW)).kind).toBe("empty");
  });
});

describe("detekce oficiálního přehledu k týdnu ze changelogu", () => {
  it("nezaloží duplicitní článek se stejným slugem", async () => {
    const db = drizzle(env.DB);
    await db.insert(ccNewsItem).values({ id: "cl38", sourceId: "/changelog/2026-w38", contentHash: "h", weekLabel: "Week 38", versionRange: "v2.1.270–v2.1.278", status: "published", createdAt: NOW });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const rss = `<rss><channel><item><title>Week 38</title><link>https://code.claude.com/docs/en/whats-new#week-38</link>
      <content:encoded><![CDATA[<a href="https://code.claude.com/docs/en/whats-new/2026-w38">Read the Week 38 digest</a>]]></content:encoded></item></channel></rss>`;
    const outcomes = await detectRecent(db, { fetchRss: async () => rss, fetchDetail: async () => "# Week 38" }, NOW, 3);
    expect(outcomes).toEqual([{ kind: "unchanged", sourceId: "/docs/en/whats-new/2026-w38", itemId: "cl38" }]);
    expect(await db.select().from(ccNewsItem)).toHaveLength(1);
  });
});

describe("snímky dokumentace", () => {
  it("parseSitemap a contentLines", () => {
    const xml = `<url><loc>https://code.claude.com/docs/en/desktop</loc><lastmod>2026-10-14T00:00:00Z</lastmod></url>
      <url><loc>https://code.claude.com/docs/de/desktop</loc><lastmod>2026-10-14T00:00:00Z</lastmod></url>`;
    expect(parseSitemap(xml)).toEqual([{ path: "desktop", lastmod: "2026-10-14T00:00:00Z" }]);
    expect(contentLines("# Nadpis\n\n> Fetch the complete documentation index at: /docs/llms.txt\n- A long enough sentence describing a capability in detail.")).toEqual(["A long enough sentence describing a capability in detail."]);
  });

  it("snapshotDocs stáhne jen změněné stránky a uloží obsah podle hashe", async () => {
    await env.KV.put(DOCS_INDEX_KEY, JSON.stringify({ takenAt: "", pages: { same: { lastmod: "1", hash: "aaaa" } } }));
    const sitemap = `<url><loc>https://code.claude.com/docs/en/same</loc><lastmod>1</lastmod></url>
      <url><loc>https://code.claude.com/docs/en/fresh</loc><lastmod>2</lastmod></url>`;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.endsWith("sitemap.xml")) return new Response(sitemap);
      if (url.endsWith("/fresh.md")) return new Response("# Fresh page with content");
      return new Response("not found", { status: 404 });
    });
    const r = await snapshotDocs(env.KV, NOW);
    expect(r).toEqual({ fetched: 1, changed: 1, pending: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const idx = await env.KV.get<DocsIndex>(DOCS_INDEX_KEY, "json");
    expect(Object.keys(idx!.pages).sort()).toEqual(["fresh", "same"]);
    expect(await env.KV.get(docsPageKey("fresh", idx!.pages.fresh!.hash))).toBe("# Fresh page with content");
  });
});

describe("deterministické kontroly článku", () => {
  it("poznámky editoru ven, cizí verze a odkazy pryč, české období", () => {
    expect(extractEditorNotes("A\n<!-- ověřit -->\nB")).toEqual({ markdown: "A\nB", notes: ["ověřit"] });
    expect(versionViolations("v2.1.271 a 2.1.999 a v2.1.271", new Set(["2.1.271"]))).toEqual(["2.1.999"]);
    expect(stripUnknownDocLinks("[a](https://code.claude.com/docs/en/ok#x) [b](https://code.claude.com/docs/en/nope)", new Set(["ok"])))
      .toEqual({ markdown: "[a](https://code.claude.com/docs/en/ok#x) b", stripped: ["https://code.claude.com/docs/en/nope"] });
    expect(czechDateRange(new Date("2026-09-14T12:00Z"), new Date("2026-09-19T12:00Z"))).toBe("14.–19. září 2026");
    expect(czechDateRange(new Date("2026-09-28T12:00Z"), new Date("2026-10-04T12:00Z"))).toBe("28. září – 4. října 2026");
  });
});

describe("buildChangelogArticle", () => {
  it("postaví článek: signál nové stránky dokumentace, kontroly verzí, odkazů a poznámek", async () => {
    const { db } = await seed();
    await db.insert(ccNewsItem).values([
      { id: "w37", sourceId: "/docs/en/whats-new/2026-w37", contentHash: "h", weekLabel: "Week 37", versionRange: "v2.1.263–v2.1.269", status: "published", createdAt: NOW, publishedAt: NOW },
      { id: "w38", sourceId: "/changelog/2026-w38", contentHash: "h", weekLabel: "Week 38", versionRange: "v2.1.271–v2.1.278", status: "draft", createdAt: NOW },
    ]);
    await env.KV.put(publishedKvKey("w37"), "---\nauthor: Patrick Zandl\ncategories:\n- AI\n- Vývojářské nástroje\nsummary_points:\n- claude plugin eval\n- volná okna v Desktopu\n---\n\n# W37\n\n## Testování pluginů\n\n- odrážka v těle\n");
    // Dokumentace: v W38 přibyla stránka claude-projects.
    const before: DocsIndex = { takenAt: "", pages: { desktop: { lastmod: "1", hash: "d1" } } };
    const after: DocsIndex = { takenAt: "", pages: { desktop: { lastmod: "1", hash: "d1" }, "claude-projects": { lastmod: "2", hash: "p1" } } };
    await env.KV.put(docsWeekKey({ year: 2026, week: 37 }), JSON.stringify(before));
    await env.KV.put(docsWeekKey(W38), JSON.stringify(after));
    await env.KV.put(docsPageKey("claude-projects", "p1"), "# Projects\n\nA project is one ongoing conversation where Claude coordinates a stream of related work.");

    const { llm, calls } = fakeLlm();
    const art = await buildChangelogArticle(db, env as never, "w38", NOW, { classify: llm, write: llm });

    // Signál nové stránky → povinně v hlavních novinkách.
    expect(art.review.signals).toEqual([expect.objectContaining({ id: "docs:claude-projects#page", kind: "new-page" })]);
    expect(art.review.features[0]!.sourceIds).toContain("docs:claude-projects#page");
    // Předchozí vydání jde do výběru (neopakovat témata).
    const selectUser = calls.find((c) => c.kind === "select")!.user;
    expect(selectUser).toContain("- claude plugin eval");
    expect(selectUser).toContain("- volná okna v Desktopu");
    expect(selectUser).toContain("- Testování pluginů");
    expect(selectUser).not.toContain("Vývojářské nástroje");
    expect(selectUser).not.toContain("odrážka v těle");
    // Poznámka editoru ven z článku, do recenze.
    expect(art.markdown).not.toContain("<!--");
    expect(art.review.editorNotes).toEqual(["Poznámka: ověřit tarify"]);
    // Cizí verze opravena druhým voláním.
    expect(calls.some((c) => c.kind === "versionfix")).toBe(true);
    expect(art.markdown).toContain("Verze 2.1.271.");
    expect(art.review.versionIssues).toEqual([]);
    // Odkaz mimo dokumentaci převeden na text, platný zůstal; em dash pryč.
    expect(art.markdown).toContain("(https://code.claude.com/docs/en/claude-projects)");
    expect(art.markdown).not.toContain("not-a-page");
    expect(art.markdown).not.toContain("—");
    // Front matter ve formátu publikovaných článků.
    expect(art.markdown).toMatch(/^---\nauthor: Patrick Zandl\n[\s\S]*\ntitle: "Projects - přebírají koordinaci"\n[\s\S]*\n---\n\n# Projects - přebírají koordinaci\n/);
    expect(art.versionRange).toBe("v2.1.271–v2.1.278");
  });
});
