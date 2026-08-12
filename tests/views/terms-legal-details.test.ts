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

  it("má kotvy, na které odkazuje checkout", async () => {
    const html = await terms();
    expect(html).toContain('id="odstoupeni"');
    expect(html).toContain('id="refund"');
  });
});
