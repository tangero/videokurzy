import { describe, it, expect } from "vitest";
import { analyticsSnippet } from "../../src/lib/analytics-snippet";
import type { Env } from "../../src/types";

function envWith(overrides: Partial<Env>): Env {
  return overrides as Env;
}

describe("analyticsSnippet", () => {
  it("bez nakonfigurovaného pixelu vrací prázdný řetězec (lokálně/testy nic nevkládá)", () => {
    expect(analyticsSnippet(envWith({}))).toBe("");
  });

  it("s Meta pixel ID obsahuje lištu i loader pixelu", () => {
    const html = analyticsSnippet(envWith({ META_PIXEL_ID: "123456" }));
    expect(html).toContain("vk-consent-bar");
    expect(html).toContain("vk-consent-accept");
    expect(html).toContain("123456");
    expect(html).toContain("fbevents.js");
  });

  it("NEhlásí falešný souhlas — default consent je revoke/denied, ne grant", () => {
    const html = analyticsSnippet(envWith({ META_PIXEL_ID: "1", GTAG_ID: "G-X", SKLIK_CONVERSION_ID: "9" }));
    // Meta: revoke ve větvi bez souhlasu
    expect(html).toContain("'revoke'");
    // Google Consent Mode v2 default se odvíjí od granted() (denied dokud nesouhlas)
    expect(html).toContain("'denied'");
    // grant/granted se objevuje jen v grantLoaded (po kliknutí), ne jako napevno init
    expect(html).toContain("grantLoaded");
  });

  it("Sklik consent param je dynamický (granted()?1:0), ne napevno 1", () => {
    const html = analyticsSnippet(envWith({ SKLIK_CONVERSION_ID: "42" }));
    expect(html).toContain("consent: granted() ? 1 : 0");
    expect(html).toContain("rc.js");
  });
});
