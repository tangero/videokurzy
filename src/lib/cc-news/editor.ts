// Redakční zpracování whats-new digestu na článek „Novinky v Claude Code"
// (W-004, R2). Dvě vrstvy dle D-1 (varianta C):
//   1) DETERMINISTICKÁ: parse digest .md → strukturovaný model (verze, velké
//      změny, drobnosti) + render kostry článku dle redakcni-pravidla.md.
//      Plně testovatelné, bez sítě, bez LLM.
//   2) LLM (volitelná, za flagem CC_NEWS_LLM): převede fakta do plné češtiny
//      podle jazykových pravidel. Bez flagu se vrací deterministická kostra.
//
// Editor NIC neodesílá ani nepublikuje — vrací markdown řetězec. Publikace je
// vždy až po lidském schválení (mantinel kontraktu).

/** Jedna velká změna (feature) z digestu. */
export interface DigestFeature {
  title: string;
  version: string | null; // „v2.1.169"
  lede: string;           // popis novinky
  docLink: string | null; // odkaz na konkrétní sekci dokumentace
}

/** Strukturovaný model whats-new digestu po parse. */
export interface ParsedDigest {
  weekLabel: string;        // „Week 24"
  dateRange: string | null; // „June 8–12, 2026"
  perex: string;            // úvodní blockquote
  versionRange: string | null; // „v2.1.166 → v2.1.176"
  features: DigestFeature[];
  minorWins: string[];      // drobnosti („Other wins")
}

const stripTags = (s: string): string =>
  s.replace(/<[^>]+>/g, "").replace(/`([^`]+)`/g, "$1").replace(/\s+/g, " ").trim();

/**
 * Parsuje whats-new digest `.md` (Mintlify MDX) do strukturovaného modelu.
 * Strojová struktura: `# Week N · datum`, perex jako `> …`, `digest-meta`
 * s rozsahem verzí, `digest-feature` bloky (title, pill=verze, lede, link),
 * volitelná sekce „Other wins" / „Also" s drobnostmi.
 */
export function parseDigest(md: string): ParsedDigest {
  const weekLabel = md.match(/^#\s+(Week\s+\d+)/m)?.[1]?.trim() ?? "";
  const dateRange =
    md.match(/^#\s+Week\s+\d+\s*·\s*(.+?)\s*$/m)?.[1]?.trim() ?? null;

  // Perex = první blockquote řádek, který není „Documentation Index" boilerplate.
  const perex =
    md
      .split("\n")
      .map((l) => l.match(/^>\s+(?!#)(.+)$/)?.[1]?.trim())
      .find((l) => l && !/documentation index|fetch the complete|use this file/i.test(l)) ?? "";

  const versionRange =
    md.match(/Releases\s*<a[^>]*>([^<]+)<\/a>/i)?.[1]?.trim() ??
    md.match(/Releases\s+([vV][\d.]+\s*[→-]+\s*[vV][\d.]+)/)?.[1]?.trim() ??
    null;

  const features: DigestFeature[] = [];
  // Rozsekat podle digest-feature bloků (každá velká změna = jeden blok).
  const blocks = md.split(/<div className="digest-feature">/).slice(1);
  for (const block of blocks) {
    const title = stripTags(block.match(/digest-feature-title">([\s\S]*?)<\/span>/)?.[1] ?? "");
    if (!title) continue;
    const version = stripTags(block.match(/digest-feature-pill">([\s\S]*?)<\/span>/)?.[1] ?? "") || null;
    const lede = stripTags(block.match(/digest-feature-lede">([\s\S]*?)<\/p>/)?.[1] ?? "");
    const docLink = block.match(/digest-feature-link"\s+href="([^"]+)"/)?.[1] ?? null;
    features.push({ title, version, lede, docLink });
  }

  // Drobnosti: odrážky pod nadpisem „Other wins"/„Also this week".
  const minorWins: string[] = [];
  const minorSection = md.match(/(?:Other wins|Also this week)[\s\S]*?(?:\n#|$)/i)?.[0] ?? "";
  for (const m of minorSection.matchAll(/^[-*]\s+(.+)$/gm)) {
    const t = stripTags(m[1]);
    if (t) minorWins.push(t);
  }

  return { weekLabel, dateRange, perex, versionRange, features, minorWins };
}

/** Pořadí velkých změn dle váhy (bezpečnost/schopnosti nahoru, komfort dolů). */
const WEIGHT_KEYWORDS: Array<[RegExp, number]> = [
  [/security|safe[- ]?mode|permission|vulnerab|auth/i, 0],
  [/subagent|agent|model|workflow|mcp|hook/i, 1],
  [/command|mode|config|fallback/i, 2],
];

function featureWeight(f: DigestFeature): number {
  const hay = `${f.title} ${f.lede}`;
  for (const [re, w] of WEIGHT_KEYWORDS) if (re.test(hay)) return w;
  return 3;
}

/** Stabilní řazení dle váhy; při shodě zachová pořadí z digestu. */
export function orderByWeight(features: DigestFeature[]): DigestFeature[] {
  return features
    .map((f, i) => ({ f, i, w: featureWeight(f) }))
    .sort((a, b) => a.w - b.w || a.i - b.i)
    .map((x) => x.f);
}

const DOC_BASE = "https://code.claude.com";

const docUrl = (link: string | null): string | null =>
  link ? (link.startsWith("http") ? link : `${DOC_BASE}${link}`) : null;

/**
 * Deterministická KOSTRA článku dle redakcni-pravidla.md. Sestaví validní
 * strukturu (frontmatter, perex, bodový přehled s verzemi, sekce velkých změn
 * řazené dle váhy jako odstavce, drobnosti jako odrážky). Fakta zůstávají v
 * původním znění; plný převod do češtiny dělá LLM vrstva (renderArticleLLM).
 * Bez LLM je výstup strukturně validní, ale jazykově ho je nutné dotáhnout —
 * proto sample (R8) běží přes LLM cestu (D-1).
 */
export function renderArticleSkeleton(d: ParsedDigest): string {
  const ordered = orderByWeight(d.features);
  const title = `Co je nového v Claude Code — ${d.weekLabel}`;

  const summaryPoints = ordered.map(
    (f) => `${f.title}${f.version ? ` (${f.version})` : ""}`
  );

  const fm = [
    "---",
    "author: Patrick Zandl",
    "categories:",
    "- AI",
    "- Claude Code",
    "- Anthropic",
    "- Vývojářské nástroje",
    "layout: post",
    `title: ${title}`,
    `post_excerpt: "Přehled novinek v Claude Code za ${d.weekLabel}${d.versionRange ? ` (${d.versionRange})` : ""}."`,
    "summary_points:",
    ...summaryPoints.map((p) => `- ${p}`),
    "---",
  ].join("\n");

  const lines: string[] = [`# ${title}`, "", fm, ""];

  // Perex (rámující věta + věcný souhrn). Bez disclaimeru o changelogu.
  lines.push(
    `Za období ${d.weekLabel}${d.dateRange ? ` (${d.dateRange})` : ""} přibyly v Claude Code tyto změny. ${d.perex}`.trim()
  );
  lines.push("");

  // Bodový přehled velkých změn s číslem verze v závorce.
  for (const f of ordered) {
    lines.push(`- ${f.title}${f.version ? ` (${f.version})` : ""}`);
  }
  lines.push("");

  // Rozepsané sekce velkých změn — každá jako vlastní odstavec, verze na konci.
  for (const f of ordered) {
    const link = docUrl(f.docLink);
    const ref = link ? ` Dokumentace: ${link}.` : "";
    lines.push(`**${f.title}.** ${f.lede}${ref}${f.version ? ` (${f.version})` : ""}`);
    lines.push("");
  }

  // Drobnosti na konec, každá na jeden řádek jako odrážka.
  if (d.minorWins.length > 0) {
    lines.push("Drobnosti:");
    for (const w of d.minorWins) lines.push(`- ${w}`);
    lines.push("");
  }

  return lines.join("\n").trim() + "\n";
}

/** Prostředí pro LLM vrstvu (klíč v repu dle D-1 / B-004). */
export interface EditorEnv {
  CC_NEWS_LLM?: string;        // flag „1" zapne LLM vrstvu
  ANTHROPIC_API_KEY?: string;  // klíč (dle B-004 je v repu)
}

export interface RenderOptions {
  /** Injektovatelný LLM volač pro testy; bez něj se použije reálné API. */
  llm?: (systemPrompt: string, userContent: string) => Promise<string>;
}

/**
 * Hlavní vstup redakčního zpracování. S `CC_NEWS_LLM=1` převede deterministickou
 * kostru do plné češtiny dle jazykových pravidel přes LLM; jinak vrátí kostru.
 * Vždy staví na deterministicky naparsovaném modelu (fakta se nehalucinují).
 */
export async function renderArticle(
  digestMd: string,
  env: EditorEnv,
  opts: RenderOptions = {}
): Promise<{ markdown: string; usedLlm: boolean }> {
  const parsed = parseDigest(digestMd);
  const skeleton = renderArticleSkeleton(parsed);

  const llmEnabled = env.CC_NEWS_LLM === "1" && (opts.llm || env.ANTHROPIC_API_KEY);
  if (!llmEnabled) {
    return { markdown: skeleton, usedLlm: false };
  }

  const system = buildEditorSystemPrompt();
  const llm = opts.llm ?? defaultLlm(env);
  const refined = await llm(system, skeleton);
  return { markdown: refined.trim() + "\n", usedLlm: true };
}

/** Systémový prompt nesoucí redakční + jazyková pravidla pro LLM vrstvu. */
export function buildEditorSystemPrompt(): string {
  return [
    "Jsi redaktor. Dostaneš kostru článku „Novinky v Claude Code\" a přepíšeš ji",
    "do plné, spisovné češtiny podle těchto závazných pravidel:",
    "- Čeština, formální registr (vykání), markdown. Zachovej YAML front matter.",
    "- Pomlčky s mezerami, nikdy spojovník. Žádný negativní paralelismus.",
    "- České výrazy místo anglicismů, kde existuje ekvivalent; ponech zavedené",
    "  termíny (prompt cache, hooks, MCP, auto mode, safe mode, release, build, shell).",
    "- „Subagent\" je životný: plurál „subagenti\".",
    "- Velké změny jako souvislé odstavce (ne odrážky), proměnlivá délka vět.",
    "- Drobnosti na konci jako odrážky, každá na řádek.",
    "- Suché konstatování, žádná vata. Čtenář je pokročilý uživatel Claude Code.",
    "- Zachovej čísla verzí v závorkách a odkazy na dokumentaci.",
    "- Nepřidávej fakta, která v kostře nejsou. Informaci mimo zdroj označ a",
    "  doporuč ověřit před tiskem.",
    "Vrať jen výsledný markdown článku.",
  ].join("\n");
}

/** Reálný LLM volač přes Anthropic Messages API (jen když je klíč a flag). */
function defaultLlm(env: EditorEnv) {
  return async (system: string, user: string): Promise<string> => {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": env.ANTHROPIC_API_KEY ?? "",
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-opus-4-8",
        max_tokens: 4096,
        system,
        messages: [{ role: "user", content: user }],
      }),
    });
    if (!res.ok) throw new Error(`cc-news LLM API failed: ${res.status}`);
    const data = (await res.json()) as { content?: Array<{ text?: string }> };
    return data.content?.map((c) => c.text ?? "").join("") ?? "";
  };
}
