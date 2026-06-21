import { describe, expect, it } from "vitest";
import {
  parseDigest,
  orderByWeight,
  renderArticleSkeleton,
  renderArticle,
  buildEditorSystemPrompt,
  stripWrappingFence,
  type DigestFeature,
} from "../../src/lib/cc-news/editor";

describe("stripWrappingFence", () => {
  it("removes a ```yaml fence wrapping the front matter", () => {
    const wrapped = "```yaml\n---\ntitle: X\n---\n```\n\n# X\nobsah";
    const out = stripWrappingFence(wrapped);
    expect(out.startsWith("---")).toBe(true);
    expect(out).not.toMatch(/```/);
    expect(out).toMatch(/# X/);
  });

  it("removes ```markdown fences around the whole article", () => {
    expect(stripWrappingFence("```markdown\n# X\ntělo\n```")).toBe("# X\ntělo");
  });

  it("leaves clean markdown untouched", () => {
    expect(stripWrappingFence("---\ntitle: X\n---\n# X")).toBe("---\ntitle: X\n---\n# X");
  });
});

// Zkrácený, ale strukturně věrný fixture reálného whats-new .md (Week 24),
// ověřeno proti https://code.claude.com/docs/en/whats-new/2026-w24.md.
const DIGEST = `> ## Documentation Index
> Fetch the complete documentation index at: https://code.claude.com/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# Week 24 · June 8–12, 2026

> Move a session to a new directory with /cd, let subagents spawn their own subagents, and troubleshoot a broken configuration with safe mode.

<div className="digest-meta">
  <span>Releases <a href="/docs/en/changelog#2-1-166">v2.1.166 → v2.1.176</a></span>
  <span>3 features · June 8–12</span>
</div>

<div className="digest-feature">
  <div className="digest-feature-header">
    <span className="digest-feature-title">Move a session with /cd</span>
    <span className="digest-feature-pill">v2.1.169</span>
  </div>
  <p className="digest-feature-lede">The new <code>/cd</code> command moves the current session to a different working directory without rebuilding the prompt cache.</p>
  <a className="digest-feature-link" href="/docs/en/commands#all-commands">Commands reference</a>
</div>

<div className="digest-feature">
  <div className="digest-feature-header">
    <span className="digest-feature-title">Subagents can spawn subagents</span>
    <span className="digest-feature-pill">v2.1.172</span>
  </div>
  <p className="digest-feature-lede">Subagents can now spawn their own subagents, capped at five levels deep.</p>
  <a className="digest-feature-link" href="/docs/en/sub-agents#spawn-nested-subagents">Spawn nested subagents</a>
</div>

<div className="digest-feature">
  <div className="digest-feature-header">
    <span className="digest-feature-title">Troubleshoot with safe mode</span>
    <span className="digest-feature-pill">v2.1.169</span>
  </div>
  <p className="digest-feature-lede">Start Claude Code with safe mode to launch with all customizations disabled.</p>
  <a className="digest-feature-link" href="/docs/en/troubleshooting#safe-mode">Safe mode</a>
</div>

<div className="digest-wins">
  <p className="digest-wins-title">Other wins</p>

  <div className="digest-wins-grid">
    <div><a href="/docs/en/model-config#fallback-model-chains"><code>fallbackModel</code></a> configures up to three fallback models tried in order</div>
    <div>Session titles are now generated in the language of your conversation</div>
    <div>Browsing a marketplace's plugins in <code>/plugin</code> now has a search bar</div>
  </div>
</div>

[Full changelog for v2.1.166–v2.1.176 →](/en/changelog#2-1-166)
`;

describe("cc-news editor — parseDigest", () => {
  const d = parseDigest(DIGEST);

  it("extracts week label, date range and version range", () => {
    expect(d.weekLabel).toBe("Week 24");
    expect(d.dateRange).toBe("June 8–12, 2026");
    expect(d.versionRange).toBe("v2.1.166 → v2.1.176");
  });

  it("takes the real perex, not the Documentation Index boilerplate", () => {
    expect(d.perex).toMatch(/Move a session to a new directory/);
    expect(d.perex).not.toMatch(/Documentation Index/);
  });

  it("parses all features with title, version and doc link", () => {
    expect(d.features).toHaveLength(3);
    expect(d.features[0]).toMatchObject({
      title: "Move a session with /cd",
      version: "v2.1.169",
      docLink: "/docs/en/commands#all-commands",
    });
    expect(d.features[1].title).toBe("Subagents can spawn subagents");
  });

  it("collects minor wins from the real digest-wins-grid MDX block", () => {
    expect(d.minorWins).toHaveLength(3);
    // odkaz uvnitř položky převeden na markdown [text](url):
    expect(d.minorWins[0]).toMatch(
      /\[fallbackModel\]\(https:\/\/code\.claude\.com\/docs\/en\/model-config#fallback-model-chains\)/
    );
    expect(d.minorWins[1]).toMatch(/Session titles/);
    expect(d.minorWins[2]).toMatch(/search bar/);
  });
});

describe("cc-news editor — orderByWeight", () => {
  it("puts security/safe-mode above comfort features, stable on ties", () => {
    const feats: DigestFeature[] = [
      { title: "Move with /cd", version: "v1", lede: "comfort command", docLink: null },
      { title: "Safe mode", version: "v2", lede: "disable customizations for security", docLink: null },
      { title: "Subagents nested", version: "v3", lede: "subagent capability", docLink: null },
    ];
    const ordered = orderByWeight(feats).map((f) => f.title);
    expect(ordered[0]).toBe("Safe mode");        // bezpečnost nahoru
    expect(ordered.indexOf("Subagents nested")).toBeLessThan(ordered.indexOf("Move with /cd"));
  });
});

describe("cc-news editor — renderArticleSkeleton (R2 struktura)", () => {
  const md = renderArticleSkeleton(parseDigest(DIGEST));

  it("starts with YAML front matter (first line ---) then the # heading", () => {
    // Front matter MUSÍ být na začátku .md dokumentu, nadpis až za ním.
    expect(md.startsWith("---\n")).toBe(true);
    expect(md).toMatch(/author: Patrick Zandl/);
    expect(md).toMatch(/categories:/);
    expect(md).toMatch(/title: /);
    expect(md).toMatch(/post_excerpt: /);
    expect(md).toMatch(/summary_points:/);
    // nadpis je za uzavřením front matteru
    expect(md).toMatch(/\n---\n\n# Co je nového v Claude Code — Week 24/);
  });

  it("includes a bullet overview with version numbers in parentheses", () => {
    expect(md).toMatch(/- Troubleshoot with safe mode \(v2\.1\.169\)/);
  });

  it("renders each big change as a paragraph ending with version and doc link", () => {
    expect(md).toMatch(/\*\*Subagents can spawn subagents\.\*\*.*\(v2\.1\.172\)/);
    expect(md).toMatch(/Dokumentace: https:\/\/code\.claude\.com\/docs\/en\/sub-agents#spawn-nested-subagents/);
  });

  it("orders safe mode (security) before the /cd comfort command", () => {
    expect(md.indexOf("Troubleshoot with safe mode")).toBeLessThan(md.indexOf("Move a session with /cd"));
  });

  it("lists minor wins from the real digest-wins-grid as bullets at the end", () => {
    expect(md).toMatch(/Drobnosti:/);
    expect(md).toMatch(/- \[fallbackModel\]\(https:\/\/code\.claude\.com\/docs\/en\/model-config#fallback-model-chains\)/);
    expect(md).toMatch(/- Session titles/);
  });

  it("does not inject a changelog disclaimer into the perex", () => {
    const perexLine = md.split("\n").find((l) => l.startsWith("Za období")) ?? "";
    expect(perexLine).not.toMatch(/changelog|self-report|oficiáln/i);
  });
});

describe("cc-news editor — renderArticle (D-1 LLM flag)", () => {
  it("returns the deterministic skeleton when the LLM flag is off", async () => {
    const out = await renderArticle(DIGEST, {});
    expect(out.usedLlm).toBe(false);
    expect(out.markdown).toMatch(/# Co je nového v Claude Code — Week 24/);
  });

  it("uses the injected LLM when flag is on, passing rules in the system prompt", async () => {
    let seenSystem = "";
    const out = await renderArticle(
      DIGEST,
      { CC_NEWS_LLM: "1" },
      {
        llm: async (system) => {
          seenSystem = system;
          return "# Český článek\nplný překlad";
        },
      }
    );
    expect(out.usedLlm).toBe(true);
    expect(out.markdown).toMatch(/Český článek/);
    expect(seenSystem).toMatch(/subagenti/); // jazykové pravidlo předáno
  });

  it("system prompt carries the binding language rules", () => {
    const sp = buildEditorSystemPrompt();
    expect(sp).toMatch(/vykání/);
    expect(sp).toMatch(/Pomlčky s mezerami/);
    expect(sp).toMatch(/safe mode/);
  });
});
