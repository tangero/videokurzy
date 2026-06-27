import type { Context } from "hono";
import { describe, expect, it } from "vitest";
import { maskEmail, wantsJson } from "../../src/lib/errors";

// wantsJson rozhoduje, zda chybová odpověď (onError/notFound) bude JSON, nebo
// HTML stránka. Bere jen pathname z c.req.url — stačí minimální fake context.
const ctx = (url: string) => ({ req: { url } }) as unknown as Context;

describe("wantsJson", () => {
  it("API a interní cesty → JSON", () => {
    expect(wantsJson(ctx("https://x.test/api/neco"))).toBe(true);
    expect(wantsJson(ctx("https://x.test/internal/neco"))).toBe(true);
  });

  it("admin AJAX endpointy (/admin/api/) → JSON", () => {
    // Regrese: /admin/api/cc-news/send vracel při výjimce HTML → klient ukázal
    // zavádějící „Chyba sítě." místo reálné chyby.
    expect(wantsJson(ctx("https://x.test/admin/api/cc-news/send"))).toBe(true);
    expect(wantsJson(ctx("https://x.test/admin/api/cc-news/recipients"))).toBe(true);
  });

  it("běžné stránky (vč. /admin HTML) → HTML", () => {
    expect(wantsJson(ctx("https://x.test/"))).toBe(false);
    expect(wantsJson(ctx("https://x.test/admin/newsletter"))).toBe(false);
    expect(wantsJson(ctx("https://x.test/watch/neco"))).toBe(false);
  });
});

describe("maskEmail", () => {
  it("zachová doménu a první znak local-partu", () => {
    expect(maskEmail("patrick@vibecoding.cz")).toBe("p***@vibecoding.cz");
    expect(maskEmail("ab@firma.cz")).toBe("a***@firma.cz");
  });

  it("krátký local-part (1 znak) zamaskuje stejně", () => {
    expect(maskEmail("x@firma.cz")).toBe("x***@firma.cz");
  });

  it("nevalidní / prázdný vstup → ***", () => {
    expect(maskEmail("")).toBe("***");
    expect(maskEmail(null)).toBe("***");
    expect(maskEmail(undefined)).toBe("***");
    expect(maskEmail("@firma.cz")).toBe("***"); // prázdný local-part
    expect(maskEmail("bez-zavinace")).toBe("***");
  });

  it("plný e-mail se v žádné podobě neobjeví v outputu", () => {
    const email = "tajny.uzivatel@example.com";
    const masked = maskEmail(email);
    expect(masked).not.toContain("tajny.uzivatel");
    expect(masked).toContain("@example.com"); // doména je OK ponechat
  });
});
