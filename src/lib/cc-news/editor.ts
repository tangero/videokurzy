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

  const minorWins = parseMinorWins(md);

  return { weekLabel, dateRange, perex, versionRange, features, minorWins };
}

/**
 * Drobnosti („Other wins"). Reálný digest je drží v MDX bloku
 * `<div className="digest-wins-grid"><div>…</div>…</div>`, ne jako markdown
 * odrážky. Primárně parsujeme grid; fallback na markdown odrážky pod nadpisem
 * „Other wins"/„Also this week" pro starší/jiný tvar. Odkazy uvnitř položek se
 * převedou na markdown `[text](url)`, zbylé HTML značky se odstraní.
 */
export function parseMinorWins(md: string): string[] {
  const wins: string[] = [];

  // Od začátku gridu po konec digest-wins bloku (nebo konec souboru). Hranici
  // neurčujeme přes `</div></div>` (vnořené <a>/<code> by ji posunuly), ale
  // bereme zbytek a posbíráme přímé <div>…</div> položky (bez vnořeného <div>).
  const gridStart = md.search(/digest-wins-grid"?\s*>/i);
  if (gridStart !== -1) {
    const tail = md.slice(gridStart);
    for (const m of tail.matchAll(/<div>((?:(?!<\/?div\b)[\s\S])*?)<\/div>/gi)) {
      const t = htmlItemToMarkdown(m[1]);
      if (t) wins.push(t);
    }
    if (wins.length > 0) return wins;
  }

  // Fallback: markdown odrážky pod nadpisem drobností.
  const minorSection = md.match(/(?:Other wins|Also this week)[\s\S]*?(?:\n#|$)/i)?.[0] ?? "";
  for (const m of minorSection.matchAll(/^[-*]\s+(.+)$/gm)) {
    const t = htmlItemToMarkdown(m[1]);
    if (t) wins.push(t);
  }
  return wins;
}

/** Převede HTML položku drobnosti na markdown: <a href> → [text](url), zbytek stripne. */
function htmlItemToMarkdown(html: string): string {
  const withLinks = html.replace(
    /<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi,
    (_m, href, text) => {
      const label = stripTags(text);
      const url = href.startsWith("http") ? href : `${DOC_BASE}${href}`;
      return label ? `[${label}](${url})` : "";
    }
  );
  return stripTags(withLinks);
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

  // Front matter MUSÍ být na začátku dokumentu (YAML hlavička .md), pak nadpis.
  const lines: string[] = [fm, "", `# ${title}`, ""];

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

/**
 * Prostředí pro LLM vrstvu. Redakční model běží přes OpenRouter (OpenAI-
 * kompatibilní API) — model `anthropic/claude-sonnet-latest`. Klíč
 * `OPENROUTER_API_KEY` je v .dev.vars (lokálně) i Cloudflare Secrets (běh).
 */
export interface EditorEnv {
  CC_NEWS_LLM?: string;        // flag „1" zapne LLM vrstvu
  OPENROUTER_API_KEY?: string; // OpenRouter klíč
  CC_NEWS_LLM_MODEL?: string;  // volitelný override modelu
}

const DEFAULT_LLM_MODEL = "anthropic/claude-sonnet-4.6";

export interface RenderOptions {
  /** Injektovatelný LLM volač pro testy; bez něj se použije reálné API. */
  llm?: (systemPrompt: string, userContent: string) => Promise<string>;
  /** Už naparsovaný digest (ušetří druhý parseDigest, když volající parsuje sám). */
  parsed?: ParsedDigest;
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
  const parsed = opts.parsed ?? parseDigest(digestMd);
  const skeleton = renderArticleSkeleton(parsed);

  const llmEnabled = env.CC_NEWS_LLM === "1" && (opts.llm || env.OPENROUTER_API_KEY);
  if (!llmEnabled) {
    return { markdown: skeleton, usedLlm: false };
  }

  const system = buildEditorSystemPrompt();
  const llm = opts.llm ?? defaultLlm(env);
  const refined = await llm(system, skeleton);
  return { markdown: stripWrappingFence(refined) + "\n", usedLlm: true };
}

/** Systémový prompt nesoucí redakční + jazyková pravidla pro LLM vrstvu. */
export function buildEditorSystemPrompt(): string {
  return [
    "Jsi český technický redaktor. Dostaneš strukturovanou kostru článku „Novinky",
    "v Claude Code\" (fakta z týdenního changelogu) a přepíšeš ji do hotového",
    "redakčního článku ve spisovné češtině. Čtenářem je pokročilý uživatel Claude",
    "Code — nevysvětluj základy nástroje.",
    "",
    "STRUKTURA (přesně v tomto pořadí):",
    "1. YAML front matter — KOMPLETNĚ česky: `title` je výstižný český nadpis",
    "   vystihující hlavní změny (ne „Week N\"); `post_excerpt` česky shrnuje, co",
    "   se za období stalo a jaký je charakter změn; `summary_points` jsou české",
    "   věty. Zachovej klíče author, categories, layout.",
    "2. `# ` nadpis = stejný český title.",
    "3. Rámující PEREX (1 odstavec): věcně shrň, co se za období stalo a jaký je",
    "   celkový charakter (kolik verzí, zda velký release, jaké linie změn). Bez",
    "   disclaimeru o changelogu či vendor self-reportu.",
    "4. Bodový PŘEHLED velkých změn, u každé číslo verze v závorce.",
    "5. Rozepsané VELKÉ ZMĚNY — každá vlastní odstavec (ne odrážka), řazené DLE",
    "   VÁHY (co mění schopnosti nebo bezpečnost nahoru, komfort a kosmetika dolů),",
    "   ne dle čísla verze. U každé doplň krátkou INTERPRETACI/úsudek (proč to",
    "   mění, komu to pomůže), oddělenou od faktického výčtu. Verze v závorce na",
    "   konci, odkaz na konkrétní sekci dokumentace.",
    "6. DROBNOSTI na konci jako odrážky, každá na jeden řádek.",
    "7. Rámující ZÁVĚR (1 odstavec): syntéza — celkové vyznění období, co je",
    "   nejzajímavější pro koho.",
    "",
    "JAZYK:",
    "- Spisovná čeština, vykání, markdown. Pomlčky s mezerami, nikdy spojovník.",
    "- Žádný negativní paralelismus („není X, ale Y\").",
    "- České výrazy místo anglicismů, kde existuje ekvivalent; ponech zavedené",
    "  termíny bez českého protějšku: prompt cache, hooks, MCP, auto mode, safe mode, release, build, shell.",
    "- „Subagent\" je rod životný: plurál „subagenti\" (subagenti mohou spouštět",
    "  vlastní subagenty).",
    "- Proměnlivá délka vět — krátké údery vedle delších vysvětlení.",
    "",
    "VĚRNOST: Nepřidávej fakta, která v kostře nejsou. Interpretace je úsudek nad",
    "fakty, ne nový fakt. Informaci mimo zdroj označ a doporuč ověřit před tiskem.",
    "",
    "Vrať POUZE výsledný markdown článku počínaje řádkem `---` front matter.",
    "NEobaluj výstup do code-fence (žádné ```markdown ani ```yaml), nepřidávej",
    "úvodní ani závěrečný komentář.",
  ].join("\n");
}

/**
 * Očistí výstup LLM od obalujících code-fence. LLM někdy obalí front matter do
 * ```yaml … ``` nebo celý článek do ```markdown … ```. Sundá fence na začátku
 * (s případným jazykem) i fence vložený hned za uzavírací `---` front matteru.
 */
export function stripWrappingFence(md: string): string {
  let s = md.trim();
  // Fence na úplném začátku: ```yaml / ```markdown / ```
  s = s.replace(/^```[a-zA-Z]*\n/, "");
  // Fence hned po uzavírajícím --- front matteru (LLM obalil jen hlavičku).
  s = s.replace(/^(---\n[\s\S]*?\n---)\n```\s*\n/, "$1\n");
  // Fence na úplném konci.
  s = s.replace(/\n```\s*$/, "");
  return s.trim();
}

/** Reálný LLM volač přes OpenRouter (OpenAI-kompatibilní). Jen když je klíč + flag. */
function defaultLlm(env: EditorEnv) {
  return async (system: string, user: string): Promise<string> => {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPENROUTER_API_KEY ?? ""}`,
        "content-type": "application/json",
        // Doporučené hlavičky OpenRouteru pro atribuci.
        "HTTP-Referer": "https://kurzy.vibecoding.cz",
        "X-Title": "Novinky v Claude Code",
      },
      body: JSON.stringify({
        model: env.CC_NEWS_LLM_MODEL ?? DEFAULT_LLM_MODEL,
        max_tokens: 4096,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (!res.ok) throw new Error(`cc-news LLM API failed: ${res.status}`);
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return data.choices?.[0]?.message?.content ?? "";
  };
}
