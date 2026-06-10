import { describe, expect, it } from "vitest";
import { maskEmail } from "../../src/lib/errors";

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
