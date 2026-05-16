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
});
