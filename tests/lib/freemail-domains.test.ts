import { describe, expect, it } from "vitest";
import { isFreemailDomain } from "../../src/config/freemail-domains";

describe("isFreemailDomain", () => {
  it.each([
    "gmail.com",
    "yahoo.com",
    "outlook.com",
    "hotmail.com",
    "icloud.com",
    "seznam.cz",
    "centrum.cz",
    "protonmail.com",
    "proton.me",
    "me.com",
    "mac.com",
    "live.com",
  ])("returns true for freemail domain %s", (domain) => {
    expect(isFreemailDomain(domain)).toBe(true);
  });

  it.each([
    "microsoft.com",
    "vibecoding.cz",
    "czech.io",
    "example.com",
    "company.seznam.cz", // subdoména není v blacklistu
  ])("returns false for corporate/unknown domain %s", (domain) => {
    expect(isFreemailDomain(domain)).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(isFreemailDomain("GMAIL.COM")).toBe(true);
    expect(isFreemailDomain("Gmail.Com")).toBe(true);
  });

  it("trims surrounding whitespace", () => {
    expect(isFreemailDomain("  gmail.com  ")).toBe(true);
  });

  it("returns false for empty string", () => {
    expect(isFreemailDomain("")).toBe(false);
  });
});
