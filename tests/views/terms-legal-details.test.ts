import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

/**
 * Povinné náležitosti e-shopu podle požadavků platební brány + kontrola, že
 * podmínky neodkazují na zrušené instituce. Texty jsou závazné vůči zákazníkovi
 * i vůči ČOI, takže regresi hlídáme testem, ne jen review.
 */
describe("obchodní podmínky — právní náležitosti", () => {
  async function terms() {
    const res = await SELF.fetch("https://test.local/terms");
    expect(res.status).toBe(200);
    return res.text();
  }

  it("uvádí platné IČO, sídlo a kontakty", async () => {
    const html = await terms();
    expect(html).toContain("43943420");
    expect(html).toContain("Brandýs nad Labem");
    expect(html).toContain("+420 777 677 077");
    // IČO 66192751 neexistuje v ARESu — nesmí se vrátit.
    expect(html).not.toContain("66192751");
  });

  it("odkazuje na ČOI jako orgán mimosoudního řešení sporů", async () => {
    const html = await terms();
    expect(html).toContain("Česká obchodní inspekce");
    expect(html).toContain("Gorazdova");
    expect(html).toMatch(/coi\.gov\.cz/);
  });

  it("neodkazuje na zrušenou platformu EU ODR", async () => {
    const html = await terms();
    // ODR platforma byla ukončena k 20. 7. 2025 nařízením (EU) 2024/3228.
    // Odkaz na ni posílá spotřebitele na neexistující službu.
    expect(html).not.toContain("ec.europa.eu/consumers/odr");
    expect(html).not.toMatch(/platformu pro řešení sporů on-?line/i);
  });

  it("obsahuje vzorový formulář pro odstoupení", async () => {
    const html = await terms();
    // § 1820 odst. 1 písm. f) obč. zák. + nařízení vlády č. 363/2013 Sb.:
    // poučení o odstoupení musí zahrnovat vzorový formulář.
    expect(html).toContain('id="formular-odstoupeni"');
    expect(html).toMatch(/Vzorový formulář/i);
    expect(html).toMatch(/odstupuji od smlouvy/i);
    // Adresát musí být identifikovatelný přímo z formuláře.
    expect(html).toMatch(/Adresát/);
    // Použití formuláře je dobrovolné — to musí být uvedeno.
    expect(html).toMatch(/není povinné/i);
  });

  it("má kotvy, na které odkazuje checkout", async () => {
    const html = await terms();
    expect(html).toContain('id="odstoupeni"');
    expect(html).toContain('id="refund"');
  });
});
