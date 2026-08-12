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

  /**
   * Část e-mailu PŘED přiloženými VOP. Podmínky samotné obsahují článek 4
   * i vzorový formulář, takže hledat je v celém e-mailu by u firemní varianty
   * falešně prošlo — poučení se musí ověřovat jen v těle zprávy.
   */
  function beforeTerms(html: string) {
    const i = html.indexOf("Znění účinné ke dni");
    return i > 0 ? html.slice(0, i) : html;
  }

  it("přikládá poučení a vzorový formulář k potvrzení nákupu (B2C)", async () => {
    const html = await b2c();
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

  it("uvádí, že právo zůstává i po zpřístupnění obsahu", async () => {
    // Musí souhlasit s článkem 4 podmínek: výjimku § 1837 písm. l) neuplatňujeme.
    expect(await b2c()).toMatch(/zůstává i poté/i);
  });

  it("neposílá spotřebitelské poučení firemnímu kupujícímu", async () => {
    // § 1829 svědčí spotřebiteli, ne firmě nakupující na IČO — slibovat jí
    // 14denní odstoupení by bylo nepravdivé (stejně jako v checkoutu).
    const body = beforeTerms(await b2b());
    expect(body).not.toMatch(/Poučení o právu na odstoupení/i);
    expect(body).not.toMatch(/Vzorový formulář/i);
    expect(body).not.toMatch(/14 dnů/);
  });

  it("přikládá plné znění VOP, i firemnímu kupujícímu", async () => {
    // § 1824a odst. 1: potvrzení smlouvy VČETNĚ VOP na trvalém nosiči se váže
    // na uzavření smlouvy, ne na postavení spotřebitele — na rozdíl od poučení
    // o odstoupení je tedy VOP nutné přiložit oběma.
    for (const html of [await b2c(), await b2b()]) {
      expect(html).toMatch(/Znění účinné ke dni/);
      expect(html).toMatch(/1824a/);
      // Reprezentativní řez podmínkami: první, prostřední i poslední sekce.
      expect(html).toContain("1. Předmět smlouvy");
      expect(html).toContain("5. Vrácení peněz");
      expect(html).toContain("11. Kontakt");
      // Odkaz na web nestačí, musí jít o samotný text.
      expect(html).toContain("Gorazdova");
    }
  });

  it("zůstává platným HTML e-mailem s odkazem na přihlášení", async () => {
    const html = await b2c();
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

  it("nepřikládá poučení individuální licenci koupené na IČO", async () => {
    // Regrese: dřív se větvilo podle type === "individual", takže podnikatel
    // s individuální licencí dostal spotřebitelské poučení neprávem.
    const html = await purchaseConfirmedHtml(
      "https://kurzy.example/login",
      "individual",
      isConsumerPurchase({ companyIco: "43943420" }),
    );
    const body = beforeTerms(html);
    expect(body).not.toMatch(/Poučení o právu na odstoupení/i);
    expect(body).not.toMatch(/Vzorový formulář/i);
  });
});
