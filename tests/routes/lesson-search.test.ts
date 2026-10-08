import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

beforeAll(async () => {
  await env.DB.prepare(
    "INSERT INTO course (id, title, slug, description, published) VALUES (?, ?, ?, ?, ?)"
  )
    .bind(801, "Kurz", "kurz-hledat", "", 1)
    .run();
  await env.DB.prepare(
    "INSERT INTO module (id, courseId, title, slug, sortOrder) VALUES (?, ?, ?, ?, ?)"
  )
    .bind(811, 801, "Základy", "zaklady-hledat", 1)
    .run();
  const insert = env.DB.prepare(
    "INSERT INTO lesson (id, moduleId, publicId, title, slug, durationSeconds, isFree, sortOrder, bodyMarkdown) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );
  await insert.bind(8101, 811, "h-8101", "Úvod", "uvod-hledat", 300, 1, 1, "První prompt v terminálu.").run();
  await insert.bind(8102, 811, "h-8102", "Placený prompt", "placeny-prompt", 540, 0, 2, null).run();
});

describe("GET /hledat (veřejné vyhledávání)", () => {
  it("funguje bez přihlášení: 200, noindex, relevance a odkazy podle přístupu", async () => {
    const res = await SELF.fetch("https://test.local/hledat?q=prompt", { redirect: "manual" });
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(html).toContain('<meta name="robots" content="noindex"');
    expect(html).toContain("„prompt“ — 2 epizody");
    // shoda v názvu (placená lekce) před shodou jen v popisu (free lekce)
    expect(html.indexOf("Placený prompt")).toBeLessThan(html.indexOf("Úvod"));
    expect(html).toContain("shoda v popisu");
    // nepřihlášený: zamčená lekce vede na ceník, free lekce na přehrávání
    expect(html).toContain('<a href="/#cenik">Placený prompt</a>');
    expect(html).toContain('<a href="/watch/uvod-hledat">Úvod</a>');
    expect(html).toContain("Některé nalezené epizody jsou pod");
  });

  it("prázdný dotaz ukáže jen formulář", async () => {
    const html = await (await SELF.fetch("https://test.local/hledat?q=%20")).text();
    expect(html).toContain("Hledat v epizodách");
    expect(html).toContain('action="/hledat"');
    expect(html).not.toContain("Výsledky hledání");
  });

  it("bez shody vrátí hlášku a odkaz na obsah kurzu", async () => {
    const html = await (await SELF.fetch("https://test.local/hledat?q=kubernetes")).text();
    expect(html).toContain("jsme nenašli žádnou epizodu");
    expect(html).toContain('href="/#obsah"');
  });

  it("úvodní stránka nabízí vyhledávací formulář mířící na /hledat", async () => {
    const html = await (await SELF.fetch("https://test.local/")).text();
    expect(html).toContain('action="/hledat"');
  });

  it("dashboard zůstává jen pro přihlášené", async () => {
    const res = await SELF.fetch("https://test.local/dashboard?q=prompt", { redirect: "manual" });
    expect(res.status).toBe(302);
  });
});
