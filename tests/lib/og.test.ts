import { describe, expect, it } from "vitest";
import { DEFAULT_OG_DESCRIPTION, lessonOgDescription, markdownExcerpt } from "../../src/lib/og";

describe("markdownExcerpt", () => {
  it("strips markdown syntax", () => {
    expect(
      markdownExcerpt("## Nadpis\n\nKrátký **popis lekce** s [odkazem](https://vibecoding.cz).\n\n- první bod\n- `kód`")
    ).toBe("Nadpis Krátký popis lekce s odkazem. první bod kód");
  });

  it("truncates on a word boundary with ellipsis", () => {
    const out = markdownExcerpt("slovo ".repeat(100), 50);
    expect(out.length).toBeLessThanOrEqual(50);
    expect(out.endsWith("slovo…")).toBe(true);
  });

  it("returns empty string for empty input", () => {
    expect(markdownExcerpt(null)).toBe("");
    expect(markdownExcerpt("   ")).toBe("");
  });
});

describe("lessonOgDescription", () => {
  it("falls back to module title, then default", () => {
    expect(lessonOgDescription("", "Základy")).toContain("Základy");
    expect(lessonOgDescription(null)).toBe(DEFAULT_OG_DESCRIPTION);
  });
});
