import { describe, it, expect } from "vitest";
import { analyticsSnippet, sklikConversionSnippet, sklikConversionSnippetFor } from "../../src/lib/analytics-snippet";
import type { Env } from "../../src/types";

function envWith(overrides: Partial<Env>): Env {
  return overrides as Env;
}

describe("analyticsSnippet", () => {
  it("bez nakonfigurovaného pixelu vrací prázdný řetězec (lokálně/testy nic nevkládá)", () => {
    expect(analyticsSnippet(envWith({}))).toBe("");
  });

  it("s Meta pixel ID obsahuje loader pixelu, ale žádnou consent lištu", () => {
    const html = analyticsSnippet(envWith({ META_PIXEL_ID: "123456" }));
    expect(html).not.toContain("vk-consent-bar");
    expect(html).not.toContain("vk-consent-accept");
    expect(html).toContain("123456");
    expect(html).toContain("fbevents.js");
  });

  it("souhlas se hlásí napevno jako granted (lišta odstraněna, souhlas dán vždy)", () => {
    const html = analyticsSnippet(envWith({ META_PIXEL_ID: "1", GTAG_ID: "G-X", SKLIK_RETARGETING_ID: "9" }));
    // Meta: grant napevno
    expect(html).toContain("window.fbq('consent', 'grant')");
    // Google Consent Mode v2 default granted
    expect(html).toContain("'granted'");
    // žádné revoke/denied ani odvolatelná volba
    expect(html).not.toContain("'revoke'");
    expect(html).not.toContain("'denied'");
  });

  it("Sklik retargeting consent param je napevno 1", () => {
    const html = analyticsSnippet(envWith({ SKLIK_RETARGETING_ID: "42" }));
    expect(html).toContain("consent: 1");
    expect(html).toContain("rc.js");
  });
});

describe("sklikConversionSnippet", () => {
  it("bez conversion ID vrací prázdný řetězec", () => {
    expect(sklikConversionSnippet(envWith({}), { value: 2990, orderId: "VS1" })).toBe("");
  });

  it("s nulovou hodnotou vrací prázdný řetězec", () => {
    expect(sklikConversionSnippet(envWith({ SKLIK_CONVERSION_ID: "7" }), { value: 0, orderId: "VS1" })).toBe("");
  });

  it("obsahuje conversionHit s ID, hodnotou a dynamickým consentem", () => {
    const html = sklikConversionSnippet(envWith({ SKLIK_CONVERSION_ID: "7" }), { value: 2990, orderId: "VS42" });
    expect(html).toContain("rc.js");
    expect(html).toContain("conversionHit");
    expect(html).toContain("Number(\"7\")");
    expect(html).toContain("value: 2990");
    expect(html).toContain("consent: 1"); // souhlas dán vždy
  });

  it("dedup přes sessionStorage keyovaný na orderId (opakované zobrazení pay stránky)", () => {
    const html = sklikConversionSnippet(envWith({ SKLIK_CONVERSION_ID: "7" }), { value: 100, orderId: "VS99" });
    expect(html).toContain("vk_sklik_conv_");
    expect(html).toContain("VS99");
    expect(html).toContain("sessionStorage");
  });

  it("identity matching: eid=null bez hashe, jinak hashovaný e-mail (ne čitelný)", () => {
    const without = sklikConversionSnippet(envWith({ SKLIK_CONVERSION_ID: "7" }), { value: 100, orderId: "A" });
    expect(without).toContain("eid: null");
    const withHash = sklikConversionSnippet(envWith({ SKLIK_CONVERSION_ID: "7" }), { value: 100, orderId: "A", emailHash: "deadbeef" });
    expect(withHash).toContain('updateIdentities({ eid: "deadbeef" })');
  });
});

describe("sklikConversionSnippetFor — hashuje e-mail server-side", () => {
  it("e-mail se do HTML dostane jen jako SHA-256 hash, ne čitelně", async () => {
    const html = await sklikConversionSnippetFor(envWith({ SKLIK_CONVERSION_ID: "7" }), {
      value: 100,
      orderId: "A",
      email: "Test@Example.com",
    });
    expect(html).not.toContain("Test@Example.com");
    expect(html).not.toContain("test@example.com");
    // SHA-256 hex je 64 znaků
    expect(html).toMatch(/eid: "[a-f0-9]{64}"/);
  });
});
