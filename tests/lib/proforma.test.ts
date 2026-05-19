import { describe, expect, it } from "vitest";
import { formatProformaNumber, generateProformaHtml } from "../../src/lib/proforma";

describe("formatProformaNumber", () => {
  it("pads sequence to 3 digits", () => {
    expect(formatProformaNumber(2026, 1)).toBe("ZD-2026-001");
    expect(formatProformaNumber(2026, 42)).toBe("ZD-2026-042");
    expect(formatProformaNumber(2026, 999)).toBe("ZD-2026-999");
  });

  it("supports >999 (overflow without truncation)", () => {
    expect(formatProformaNumber(2026, 1234)).toBe("ZD-2026-1234");
  });
});

describe("generateProformaHtml", () => {
  const base = {
    proformaNumber: "ZD-2026-001",
    issueDate: new Date("2026-05-19"),
    dueDate: new Date("2026-05-26"),
    contactEmail: "buyer@example.com",
    type: "organization" as const,
    domain: "example.com",
    amount: 15000,
    variableSymbol: "33000123",
  };

  it("includes all buyer fields when filled", () => {
    const html = generateProformaHtml({
      ...base,
      companyName: "Acme s.r.o.",
      companyIco: "12345678",
      companyDic: "CZ12345678",
      companyAddress: "Hlavní 1",
      companyCity: "Praha",
      companyZip: "110 00",
      contactName: "Jan Novák",
    });
    expect(html).toContain("Acme s.r.o.");
    expect(html).toContain("IČO: 12345678");
    expect(html).toContain("DIČ: CZ12345678");
    expect(html).toContain("Hlavní 1");
    expect(html).toContain("Praha");
    expect(html).toContain("110 00");
    expect(html).toContain("Jan Novák");
    expect(html).toContain("buyer@example.com");
    expect(html).toContain("ZD-2026-001");
    // cs-CZ locale používá NBSP jako tisícový oddělovač
    expect(html).toContain((15000).toLocaleString("cs-CZ"));
    expect(html).toContain("33000123");
  });

  it("skips missing buyer fields when no company data", () => {
    const html = generateProformaHtml({
      ...base,
      type: "individual",
      domain: null,
    });
    // IČO supplieru se v dokladu vždy zobrazuje, ale IČO odběratele ne.
    // Stačí ověřit, že nepřibyl IČO řádek odběratele s neexistujícím IČO.
    expect(html).not.toContain("IČO: undefined");
    expect(html).not.toContain("IČO: null");
    expect(html).not.toContain("DIČ:");
    expect(html).toContain("buyer@example.com");
  });

  it("escapes HTML in user-provided fields", () => {
    const html = generateProformaHtml({
      ...base,
      companyName: '<script>alert(1)</script>',
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
