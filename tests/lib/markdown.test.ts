import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../../src/lib/markdown";

describe("renderMarkdown", () => {
  it("renders basic markdown and escapes raw HTML", () => {
    const html = renderMarkdown("Text s **tučným** slovem a `kódem`.\n\n- položka\n- <script>alert(1)</script>");

    expect(html).toContain("<strong>tučným</strong>");
    expect(html).toContain("<code>kódem</code>");
    expect(html).toContain("<ul>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>");
  });

  it("keeps http links and rejects unsafe protocols", () => {
    const html = renderMarkdown("[web](https://vibecoding.cz) [bad](javascript:alert(1))");

    expect(html).toContain('href="https://vibecoding.cz/"');
    expect(html).toContain('href="#"');
  });

  it("renders heading levels h1, h2, h3 (ne doslovné mřížky v <p>)", () => {
    const html = renderMarkdown("# Nadpis 1\n\n## Nadpis 2\n\n### Nadpis 3");

    expect(html).toContain("<h1>Nadpis 1</h1>");
    expect(html).toContain("<h2>Nadpis 2</h2>");
    expect(html).toContain("<h3>Nadpis 3</h3>");
    // Mřížka se nesmí objevit jako doslovný text odstavce.
    expect(html).not.toContain("<p># ");
    expect(html).not.toContain("# Nadpis");
  });
});
