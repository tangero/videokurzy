import { env, SELF } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import { purchaseConfirmedHtml } from "../../src/lib/email";
import { formatCzk } from "../../src/lib/prices";

/**
 * Ceny v obchodních podmínkách musí odpovídat ceníku v `site_config`.
 * Regrese: VOP měly napevno 2 000 / 15 000 Kč, zatímco se prodávalo za 3 000 Kč —
 * zákazník pak v potvrzení nákupu dostal podmínky s jinou cenou, než zaplatil.
 */
async function setPrices(individual: number, organization: number) {
  await env.DB.prepare(
    "INSERT OR REPLACE INTO site_config (key, value) VALUES ('price_individual', ?), ('price_organization', ?)",
  ).bind(String(individual), String(organization)).run();
}

afterEach(async () => {
  await env.DB.prepare(
    "DELETE FROM site_config WHERE key IN ('price_individual', 'price_organization')",
  ).run();
});

describe("ceny v obchodních podmínkách", () => {
  it("formatCzk odděluje tisíce nezlomitelnou mezerou", () => {
    expect(formatCzk(3000)).toBe("3 000 Kč");
    expect(formatCzk(15000)).toBe("15 000 Kč");
    expect(formatCzk(999)).toBe("999 Kč");
  });

  it("/terms ukazuje ceny ze site_config, ne fallback konstanty", async () => {
    await setPrices(3000, 25000);
    const html = await (await SELF.fetch("https://test.local/terms")).text();
    expect(html).toContain(formatCzk(3000));
    expect(html).toContain(formatCzk(25000));
    expect(html).not.toContain(formatCzk(2000));
    expect(html).not.toContain(formatCzk(15000));
    expect(html).not.toContain("2 000 Kč");
  });

  it("FAQ na landing page uvádí cenu firemní licence ze site_config", async () => {
    await setPrices(3000, 25000);
    const html = await (await SELF.fetch("https://test.local/")).text();
    const faq = html.slice(html.indexOf('id="faq"'));
    expect(faq).toMatch(/Zaplatíte 25\s000\sKč\/rok/);
    expect(faq).not.toMatch(/15\s000\sKč/);
  });

  it("VOP v potvrzovacím e-mailu nesou předaný ceník", async () => {
    const html = await purchaseConfirmedHtml(
      "https://kurzy.example/login",
      "individual",
      true,
      { individual: 3000, organization: 25000 },
    );
    expect(html).toContain(formatCzk(3000));
    expect(html).toContain(formatCzk(25000));
    expect(html).not.toContain(formatCzk(2000));
  });
});
