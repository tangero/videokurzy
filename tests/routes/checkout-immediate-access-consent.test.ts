import { env, SELF } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { purchase } from "../../src/db/schema";

/**
 * Výslovný souhlas se zpřístupněním digitálního obsahu před uplynutím 14denní
 * lhůty (§ 1837 písm. l). Bez něj právo spotřebitele na odstoupení nezaniká,
 * takže checkbox musí být povinný a jeho udělení se musí uložit jako důkaz.
 */
describe("souhlas se zpřístupněním obsahu (§ 1837 l)", () => {
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM purchase");
  });

  function form(fields: Record<string, string>) {
    return new URLSearchParams(fields);
  }

  async function postCheckout(path: string, body: URLSearchParams) {
    return SELF.fetch(`https://test.local${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      redirect: "manual",
    });
  }

  it("zobrazí povinný checkbox v B2C i B2B checkoutu", async () => {
    for (const path of ["/checkout/individual", "/checkout/organization"]) {
      const html = await (await SELF.fetch(`https://test.local${path}`)).text();
      expect(html).toContain('name="immediateAccessConsent"');
      // `required` musí být na inputu, ne jen v textu — jinak prohlížeč nehlídá nic.
      expect(html).toMatch(/<input[^>]*name="immediateAccessConsent"[^>]*required/);
      // Checkbox je podmínkou nákupu, takže NESMÍ tvrdit ztrátu práva na
      // odstoupení — vynucené vzdání se práva je napadnutelné a odporovalo by
      // článku 4 podmínek, který právo přiznává v plném rozsahu.
      expect(html).not.toMatch(/ztrácím právo|zaniká.{0,40}právo odstoupit/i);
    }
  });

  it("neslibuje 14denní odstoupení plošně firemnímu kupujícímu", async () => {
    // § 1829 svědčí jen spotřebiteli; firemní licence se kupuje na IČO.
    // Plošný slib „právo mi zůstává" by byl nepravdivý a odporoval by čl. 4.
    const b2c = await (await SELF.fetch("https://test.local/checkout/individual")).text();
    const b2b = await (await SELF.fetch("https://test.local/checkout/organization")).text();

    expect(b2c).toMatch(/Právo odstoupit od smlouvy do 14 dnů mi zůstává/);

    // B2B nesmí o 14denní lhůtě mluvit VŮBEC — ani v úvodní větě („před
    // uplynutím 14denní lhůty"), ani jako o právu, které zákazník má. Kontrola
    // cílí na text checkboxu, ne na celou stránku (jinde 14 dní legitimně být
    // může, např. splatnost).
    const consentBlock = b2b.slice(
      b2b.indexOf('name="immediateAccessConsent"'),
      b2b.indexOf('name="marketingConsent"'),
    );
    expect(consentBlock.length).toBeGreaterThan(0);
    // Jen viditelný text — `href="/terms#odstoupeni"` je legitimní odkaz na čl. 4.
    const visible = consentBlock.replace(/<[^>]*>/g, " ");
    expect(visible).not.toMatch(/14\s*(denní|dnů|dní)/i);
    expect(visible).not.toMatch(/odstoup\w*\s+od\s+smlouvy/i);
  });

  it("bez souhlasu objednávku odmítne (B2C) a nic nezaloží", async () => {
    const res = await postCheckout(
      "/checkout/individual",
      form({ email: "kupujici@example.cz", paymentMethod: "fio" }),
    );

    expect(res.status).toBe(400);
    expect(await res.text()).toContain("potvrďte souhlas");

    const db = drizzle(env.DB);
    const rows = await db.select().from(purchase);
    expect(rows).toHaveLength(0);
  });

  it("bez souhlasu objednávku odmítne i v B2B větvi", async () => {
    const res = await postCheckout(
      "/checkout/organization",
      form({
        email: "firma@example.cz",
        domain: "example.cz",
        paymentMethod: "fio",
      }),
    );

    expect(res.status).toBe(400);
    expect(await res.text()).toContain("potvrďte souhlas");

    const db = drizzle(env.DB);
    expect(await db.select().from(purchase)).toHaveLength(0);
  });

  it("doplní souhlas i když dedup přesměruje na starší pending objednávku", async () => {
    // Objednávka založená před migrací 0033 je ve svém dedup okně pořád pending.
    // Zákazník teď checkbox zaškrtne, ale dostane redirect místo nové objednávky —
    // souhlas se přesto musí uložit, jinak se přístup aktivuje bez důkazu.
    const db = drizzle(env.DB);
    await db.insert(purchase).values({
      email: "stary@example.cz",
      type: "individual",
      paymentMethod: "fio",
      variableSymbol: "3399999",
      accessToken: "tok-stary",
      status: "pending",
      expiresAt: new Date(Date.now() + 7 * 86400 * 1000),
      createdAt: new Date(),
      amountPaid: 2000,
      immediateAccessConsent: false,
      immediateAccessConsentAt: null,
    });

    const res = await postCheckout(
      "/checkout/individual",
      form({
        email: "stary@example.cz",
        paymentMethod: "fio",
        immediateAccessConsent: "1",
      }),
    );

    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/checkout/pay/tok-stary");

    const rows = await db
      .select()
      .from(purchase)
      .where(eq(purchase.email, "stary@example.cz"));
    // Dedup nesmí založit druhou objednávku…
    expect(rows).toHaveLength(1);
    // …ale souhlas na té existující doplní.
    expect(rows[0].immediateAccessConsent).toBe(true);
    expect(rows[0].immediateAccessConsentAt).toBeInstanceOf(Date);
  });

  it("nepřepíše čas už uděleného souhlasu (důkazní záznam)", async () => {
    const original = new Date("2026-08-01T09:00:00.000Z");
    const db = drizzle(env.DB);
    await db.insert(purchase).values({
      email: "opakuje@example.cz",
      type: "individual",
      paymentMethod: "fio",
      variableSymbol: "3399998",
      accessToken: "tok-opak",
      status: "pending",
      expiresAt: new Date(Date.now() + 7 * 86400 * 1000),
      createdAt: original,
      amountPaid: 2000,
      immediateAccessConsent: true,
      immediateAccessConsentAt: original,
    });

    const res = await postCheckout(
      "/checkout/individual",
      form({
        email: "opakuje@example.cz",
        paymentMethod: "fio",
        immediateAccessConsent: "1",
      }),
    );
    expect(res.status).toBe(303);

    const [row] = await db
      .select()
      .from(purchase)
      .where(eq(purchase.email, "opakuje@example.cz"));
    expect(row.immediateAccessConsentAt?.getTime()).toBe(original.getTime());
  });

  it("se souhlasem objednávku založí a uloží důkaz včetně času", async () => {
    const before = Date.now();
    const res = await postCheckout(
      "/checkout/individual",
      form({
        email: "kupujici@example.cz",
        paymentMethod: "fio",
        immediateAccessConsent: "1",
      }),
    );

    // 303 na platební stránku = objednávka vznikla.
    expect(res.status).toBe(303);

    const db = drizzle(env.DB);
    const [row] = await db
      .select()
      .from(purchase)
      .where(eq(purchase.email, "kupujici@example.cz"));

    expect(row).toBeDefined();
    expect(row.immediateAccessConsent).toBe(true);
    expect(row.immediateAccessConsentAt).toBeInstanceOf(Date);
    // Čas souhlasu musí odpovídat okamžiku objednávky, ne být nulový/epoch.
    const at = row.immediateAccessConsentAt!.getTime();
    expect(at).toBeGreaterThanOrEqual(before - 60_000);
    expect(at).toBeLessThanOrEqual(Date.now() + 60_000);
  });
});
