import { describe, expect, it } from "vitest";
import { purchaseConfirmedHtml, isConsumerPurchase } from "../../src/lib/email";

/**
 * § 1824a odst. 1 obč. zák.: poučení o právu na odstoupení včetně vzorového
 * formuláře (nařízení vlády č. 29/2023 Sb.) musí být spotřebiteli předáno na
 * TRVALÉM NOSIČI. Webová stránka s podmínkami to nesplňuje — lze ji kdykoli
 * změnit. Potvrzovací e-mail o nákupu ano, proto poučení nese on.
 */
describe("poučení o odstoupení na trvalém nosiči", () => {
  const b2c = () => purchaseConfirmedHtml("https://kurzy.example/login", "individual", true);
  const b2b = () => purchaseConfirmedHtml("https://kurzy.example/login", "organization", false);

  it("přikládá poučení a vzorový formulář k potvrzení nákupu (B2C)", () => {
    const html = b2c();
    expect(html).toMatch(/Poučení o právu na odstoupení/i);
    expect(html).toMatch(/Vzorový formulář/i);
    expect(html).toMatch(/odstupuji od smlouvy/i);
    expect(html).toMatch(/14 dnů/);
    // Adresát musí být ve formuláři identifikovatelný, bez dohledávání na webu.
    expect(html).toContain("U Přelízky 1126/6");
    expect(html).toContain("patrick@vibecoding.cz");
    // Použití formuláře je dobrovolné.
    expect(html).toMatch(/není povinné/i);
  });

  it("uvádí, že právo zůstává i po zpřístupnění obsahu", () => {
    // Musí souhlasit s článkem 4 podmínek: výjimku § 1837 písm. l) neuplatňujeme.
    expect(b2c()).toMatch(/zůstává i poté/i);
  });

  it("neposílá spotřebitelské poučení firemnímu kupujícímu", () => {
    // § 1829 svědčí spotřebiteli, ne firmě nakupující na IČO — slibovat jí
    // 14denní odstoupení by bylo nepravdivé (stejně jako v checkoutu).
    const html = b2b();
    expect(html).not.toMatch(/Poučení o právu na odstoupení/i);
    expect(html).not.toMatch(/Vzorový formulář/i);
    expect(html).not.toMatch(/14 dnů/);
  });

  it("zůstává platným HTML e-mailem s odkazem na přihlášení", () => {
    const html = b2c();
    expect(html).toContain("https://kurzy.example/login");
    expect(html).toContain("Platba přijata");
  });

  it("rozlišuje spotřebitele podle IČO, ne podle typu licence", () => {
    // Typ licence NENÍ postavení kupujícího: jednotlivec nakupující na IČO je
    // podnikatel, zatímco individuální licence bez IČO je spotřebitelský nákup.
    expect(isConsumerPurchase({ companyIco: null })).toBe(true);
    expect(isConsumerPurchase({})).toBe(true);
    expect(isConsumerPurchase({ companyIco: "43943420" })).toBe(false);
  });

  it("nepřikládá poučení individuální licenci koupené na IČO", () => {
    // Regrese: dřív se větvilo podle type === "individual", takže podnikatel
    // s individuální licencí dostal spotřebitelské poučení neprávem.
    const html = purchaseConfirmedHtml(
      "https://kurzy.example/login",
      "individual",
      isConsumerPurchase({ companyIco: "43943420" }),
    );
    expect(html).not.toMatch(/Poučení o právu na odstoupení/i);
    expect(html).not.toMatch(/Vzorový formulář/i);
  });
});
