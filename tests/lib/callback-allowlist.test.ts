import { describe, expect, it } from "vitest";
import { isAllowedCallback } from "../../src/lib/callback-allowlist";

describe("isAllowedCallback", () => {
  it.each([
    ["https://vibecoding.cz/auth/verify", true],
    ["https://kurz.vibecoding.cz/auth/verify", true],
    ["https://any.sub.vibecoding.cz/x", true],
    ["http://localhost:4321/auth/verify", true],
    ["http://localhost/foo", true],
    ["https://evil.com/auth", false],
    ["https://vibecoding.cz.evil.com/x", false],
    ["javascript:alert(1)", false],
    ["not-a-url", false],
    ["", false],
  ])("%s -> %s", (input, expected) => {
    expect(isAllowedCallback(input)).toBe(expected);
  });
});
