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
