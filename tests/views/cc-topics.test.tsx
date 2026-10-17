import { describe, expect, it } from "vitest";
import { CcTopicPage, CcTopicsPage } from "../../src/views/cc-news";

const user = { name: "Test", email: "t@example.com" };

describe("stránky vývoje témat", () => {
  it("přehled odkazuje na jednotlivá témata s počtem změn", () => {
    const html = String(<CcTopicsPage user={user} topics={[{ key: "prompt_cache", label: "Prompt cache", description: "cache", count: 49, lastAt: Date.UTC(2026, 9, 16) }]} />);
    expect(html).toContain('href="/novinky-cc/temata/prompt_cache"');
    expect(html).toContain("49 změn");
  });

  it("časová osa ukazuje vazbu „navazuje na“ s kotvou na dřívější změnu", () => {
    const html = String(
      <CcTopicPage
        user={user}
        topic={{ key: "prompt_cache", label: "Prompt cache", description: "cache", count: 2, lastAt: null }}
        entries={[
          { id: "2.1.302#aaaa1111", version: "2.1.302", publishedAt: Date.UTC(2026, 9, 16), significance: 2, text: "Fixed a prompt cache miss", reason: null,
            follows: { id: "2.1.267#bbbb2222", version: "2.1.267", relation: "rozšiřuje", reason: "stejný problém" } },
          { id: "2.1.267#bbbb2222", version: "2.1.267", publishedAt: Date.UTC(2026, 8, 9), significance: 3, text: "Fixed tools added mid-session", reason: null, follows: null },
        ]}
      />,
    );
    expect(html).toContain('id="z-2-1-267-bbbb2222"');
    expect(html).toContain('href="#z-2-1-267-bbbb2222"');
    expect(html).toContain("navazuje na");
    expect(html).toContain("(rozšiřuje)");
    expect(html).toContain("zásadní");
  });
});
