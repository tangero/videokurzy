import { env, SELF } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import { ccNewsItem } from "../../src/db/schema";
import { slugFromPath, weekSortKey } from "../../src/routes/cc-news";
import { publishedKvKey } from "../../src/lib/cc-news/draft";
import { stripFrontMatter, parseFrontMatter } from "../../src/routes/cc-news";

const NOW = new Date("2026-06-21T12:00:00.000Z");

describe("slugFromPath", () => {
  it("derives slug from the repo article path", () => {
    expect(slugFromPath("src/content/novinky-cc/2026-w24.md")).toBe("2026-w24");
    expect(slugFromPath("2026-w24.md")).toBe("2026-w24");
    expect(slugFromPath(null)).toBeNull();
  });
});

describe("weekSortKey — řazení podle stáří obsahu (rok+týden)", () => {
  it("novější týden má vyšší klíč", () => {
    expect(weekSortKey("/docs/en/whats-new/2026-w24")).toBeGreaterThan(
      weekSortKey("/docs/en/whats-new/2026-w23"),
    );
  });

  it("řeší zero-padding: w24 > w9 (lexikograficky by bylo opačně)", () => {
    expect(weekSortKey("/docs/en/whats-new/2026-w24")).toBeGreaterThan(
      weekSortKey("/docs/en/whats-new/2026-w9"),
    );
  });

  it("řeší přechod roku: 2026-w01 > 2025-w52", () => {
    expect(weekSortKey("/docs/en/whats-new/2026-w01")).toBeGreaterThan(
      weekSortKey("/docs/en/whats-new/2025-w52"),
    );
  });

  it("neparsovatelný sourceId → -1 (spadne na konec)", () => {
    expect(weekSortKey("/docs/en/whats-new/index")).toBe(-1);
    expect(weekSortKey(null)).toBe(-1);
  });

  it("seřazení sestupně dá nejnovější týden první (i s backfillem mimo pořadí)", () => {
    // Simuluje reálný stav: w24 publikováno dřív, w21–w23 backfillnuto později.
    const sources = [
      "/docs/en/whats-new/2026-w24",
      "/docs/en/whats-new/2026-w21",
      "/docs/en/whats-new/2026-w23",
      "/docs/en/whats-new/2026-w22",
    ];
    const sorted = [...sources].sort((a, b) => weekSortKey(b) - weekSortKey(a));
    expect(sorted).toEqual([
      "/docs/en/whats-new/2026-w24",
      "/docs/en/whats-new/2026-w23",
      "/docs/en/whats-new/2026-w22",
      "/docs/en/whats-new/2026-w21",
    ]);
  });
});

describe("stripFrontMatter", () => {
  it("removes leading YAML front matter so it never renders to readers", () => {
    const md = "---\nauthor: X\ntitle: Y\n---\n\n# Nadpis\ntělo";
    const out = stripFrontMatter(md);
    expect(out.startsWith("# Nadpis")).toBe(true);
    expect(out).not.toMatch(/author:/);
    expect(out).not.toMatch(/^---/);
  });

  it("leaves markdown without front matter untouched", () => {
    expect(stripFrontMatter("# Nadpis\ntělo")).toBe("# Nadpis\ntělo");
  });
});

describe("parseFrontMatter", () => {
  it("vytáhne title a post_excerpt (v uvozovkách i bez)", () => {
    const md =
      '---\nauthor: X\ntitle: "Safe mode a subagenty: novinky z týdne 24"\n' +
      'post_excerpt: "Týden 24 byl věcný a cílený."\n---\n\nTělo článku.';
    const { title, excerpt } = parseFrontMatter(md);
    expect(title).toBe("Safe mode a subagenty: novinky z týdne 24");
    expect(excerpt).toBe("Týden 24 byl věcný a cílený.");
  });

  it("zvládne hodnoty bez uvozovek", () => {
    const md = "---\ntitle: Holý nadpis\npost_excerpt: Holý perex\n---\nTělo";
    const { title, excerpt } = parseFrontMatter(md);
    expect(title).toBe("Holý nadpis");
    expect(excerpt).toBe("Holý perex");
  });

  it("nezmrší vnitřní uvozovky (YAML escape \\\")", () => {
    // YAML escapuje vnitřní dvojité uvozovky jako \" — po strhnutí obalu unescapuj.
    const md = '---\ntitle: "\\"Claude Code\\" vs \\"Cursor\\""\n---\nTělo';
    expect(parseFrontMatter(md).title).toBe('"Claude Code" vs "Cursor"');
  });

  it("bez front matteru / klíče → null", () => {
    expect(parseFrontMatter("# Nadpis\ntělo")).toEqual({ title: null, excerpt: null });
    const { title, excerpt } = parseFrontMatter("---\nauthor: X\n---\ntělo");
    expect(title).toBeNull();
    expect(excerpt).toBeNull();
  });
});

describe("gated sekce Novinky v CC (R5 — jen přihlášení s přístupem)", () => {
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM cc_news_item");
    const db = drizzle(env.DB);
    await db.insert(ccNewsItem).values({
      id: "pub-1",
      sourceId: "/docs/en/whats-new/2026-w24",
      contentHash: "h",
      weekLabel: "Week 24",
      versionRange: "v2.1.166 → v2.1.176",
      status: "published",
      articlePath: "src/content/novinky-cc/2026-w24.md",
      publishedAt: NOW,
      createdAt: NOW,
    });
    await env.KV.put(publishedKvKey("pub-1"), "---\ntitle: X\n---\n\n# Week 24\nobsah");
  });

  it("nepřihlášený je z přehledu přesměrován (login/ceník)", async () => {
    const res = await SELF.fetch("https://test.local/novinky-cc", { redirect: "manual" });
    expect(res.status).toBe(302);
    const loc = res.headers.get("location") ?? "";
    expect(["/login", "/#cenik"]).toContain(loc);
  });

  it("nepřihlášený je z detailu přesměrován", async () => {
    const res = await SELF.fetch("https://test.local/novinky-cc/2026-w24", { redirect: "manual" });
    expect(res.status).toBe(302);
  });

  it("nepřihlášený NEvidí obsah článku (žádné prosáknutí markdownu)", async () => {
    const res = await SELF.fetch("https://test.local/novinky-cc/2026-w24", { redirect: "manual" });
    const text = await res.text();
    expect(text).not.toMatch(/obsah/);
  });
});

describe("GET /novinky-cc/unsubscribe (GDPR odhlášení)", () => {
  it("400 bez tokenu", async () => {
    const res = await SELF.fetch("https://test.local/novinky-cc/unsubscribe", { redirect: "manual" });
    expect(res.status).toBe(400);
  });

  it("401 na zfalšovaný token", async () => {
    const res = await SELF.fetch("https://test.local/novinky-cc/unsubscribe?token=bad.sig", { redirect: "manual" });
    expect(res.status).toBe(401);
  });

  it("platný odhlašovací link zapíše suppression (bez přihlášení)", async () => {
    await env.DB.exec("DELETE FROM newsletter_suppression");
    const { signUnsubToken } = await import("../../src/lib/cc-news/approval");
    const token = await signUnsubToken(env as never, "leaver@example.cz");
    const res = await SELF.fetch(`https://test.local/novinky-cc/unsubscribe?token=${encodeURIComponent(token)}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toMatch(/Odhlášení proběhlo/);

    const db = drizzle(env.DB);
    const { newsletterSuppression } = await import("../../src/db/schema");
    const rows = await db.select().from(newsletterSuppression);
    expect(rows).toHaveLength(1);
  });
});
