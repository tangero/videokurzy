import { describe, expect, it } from "vitest";
import { Layout } from "../../src/views/layout";

// Hono JSX komponenta je volatelná jako funkce; vrací objekt s .toString().
function render(node: unknown): string {
  return String(node);
}

describe("Cookie lišta v Layoutu", () => {
  const html = render(Layout({ children: "obsah" }));

  it("renderuje lištu skrytou (hidden), aby se u vracejících se návštěvníků neobjevila", () => {
    expect(html).toContain('id="cookie-banner"');
    // hidden atribut → skript ji odkryje jen když souhlas ještě není uložen
    expect(html).toMatch(/id="cookie-banner"[^>]*hidden/);
  });

  it("má tlačítko souhlasu a odkaz na změnu nastavení v patičce", () => {
    expect(html).toContain("data-cookie-accept");
    expect(html).toContain("data-cookie-settings");
    expect(html).toContain("nastavení cookies");
  });

  it("ukládá volbu do localStorage, takže po souhlasu trvale mizí", () => {
    expect(html).toContain("cookie-consent-v1");
    expect(html).toContain("localStorage.setItem");
    // jediný listener napříč hx-boost navigacemi
    expect(html).toContain("__cookieConsentInit");
  });
});
