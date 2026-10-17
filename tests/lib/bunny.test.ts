import { describe, it, expect } from "vitest";
import { generateSignedEmbedUrl } from "../../src/lib/bunny";

describe("generateSignedEmbedUrl — startSeconds", () => {
  it("bez startSeconds nemá parametr t", () => {
    const url = generateSignedEmbedUrl("lib1", "vid1", "key1");
    expect(url).not.toContain("&t=");
  });

  it("se startSeconds > 0 přidá &t=<vteřiny>", () => {
    const url = generateSignedEmbedUrl("lib1", "vid1", "key1", 4, 323);
    expect(url).toContain("&t=323");
    expect(url).toContain("autoplay=false");
  });

  it("startSeconds = 0 nepřidá parametr t", () => {
    const url = generateSignedEmbedUrl("lib1", "vid1", "key1", 4, 0);
    expect(url).not.toContain("&t=");
  });

  it("vždy zapíná nativní ovládání rychlosti přehrávání", () => {
    const url = generateSignedEmbedUrl("lib1", "vid1", "key1");
    expect(url).toContain("showSpeed=true");
  });
});

describe("generateSignedEmbedUrl — token", () => {
  it("token = SHA256_HEX(tokenKey + videoId + expires), ne HMAC", async () => {
    const { createHash } = await import("node:crypto");
    const url = new URL(generateSignedEmbedUrl("lib1", "vid1", "key1"));
    const expires = url.searchParams.get("expires")!;
    const expected = createHash("sha256").update(`key1vid1${expires}`).digest("hex");
    expect(url.searchParams.get("token")).toBe(expected);
  });
});
