// Anglický týdenní přehled „Claude Code weekly“ pro vibecoding.cz/en.
//
// Píše se rovnou anglicky z uloženého ověřeného výběru (WeekSelection z weekly.ts),
// nepřekládá se z češtiny. Spouští ho schválení české verze (fronta
// cc-news.en-weekly). Výsledek je pull request do repa webu se souborem podle
// kontraktu v docs/english-section.md (vibecoding-site); vydání = sloučení PR.
// Selhání nesmí ovlivnit české vydání ani newsletter: běží jen ve frontě.
//
// GitHub operace jsou idempotentní (větev, soubor i PR se při opakování
// znovupoužijí), takže retry fronty nevyrobí duplicitní PR.

import type { LlmEnv, LlmFn } from "./llm";
import { openRouterLlm, writeModel } from "./llm";
import { isoWeekBounds } from "./changelog-source";
import { CLAUDE_CODE, toolName, type ToolKey } from "../tools/registry";
import { selectionKvKey, writeWeeklyArticle, yamlQuote, type WeekSelection, type WriterLang } from "./weekly";

export interface EnglishEnv extends LlmEnv {
  KV: KVNamespace;
  VIBECODING_SITE_GITHUB_TOKEN?: string;
  /** owner/repo webu, výchozí tangero/vibecoding-site. */
  VIBECODING_SITE_REPO?: string;
}

const DEFAULT_REPO = "tangero/vibecoding-site";

/**
 * Napsaný anglický markdown. Retry fronty i ostrý běh po náhledu ho použijí znovu:
 * v PR je přesně to, co ukázal náhled, a model se neplatí dvakrát.
 */
export const englishMdKvKey = (itemId: string) => `cc-news:en-md:${itemId}`;
/** sha souboru, který generátor naposledy zapsal na větev PR (pozná ruční úpravy). */
export const englishShaKvKey = (itemId: string) => `cc-news:en-sha:${itemId}`;
const EN_MD_TTL_SEC = 60 * 24 * 60 * 60;
/** Anglický prompt autora pro nástroj (pro Claude Code beze změny proti původnímu textu). */
export const writerSystemEn = (name: string) => [
  `You are Patrick Zandl, writing the weekly '${name} weekly' update for the English section of vibecoding.cz.`,
  `The reader is an advanced ${name} user; do not explain the basics of the tool. The text should be`,
  "read to the end because it answers the reader's question and because a person with an opinion stands behind it.",
  "",
  "INPUT: the week's main features and minor wins with the cited changelog and documentation entries.",
  "Take facts ONLY from the cited entries. Do not infer anything: no numbers, prices, limits, plans,",
  "setting names or versions that are not in the input.",
  "",
  "STRUCTURE (in this order):",
  "- LEAD: one paragraph in italics. Open with the problem or tension the week addresses and summarise",
  "  the most important topics. No rhetorical question the text then answers itself. The news framing",
  "  (period, versions, number of releases) belongs in the second paragraph.",
  "- Sections separated by a `---` line, headings `## ` aimed at the reader (no absolute claims).",
  "  Never use a `# ` heading.",
  "- Each single-point paragraph starts with a bold lead-in (**Like this.**). Bullets only for lists of conditions.",
  "- 1) The MAIN TOPIC of the week in most detail: what it is, how it works, what it is good for, and its",
  "  CONDITIONS if the input has them: availability and plans, prerequisites, limitations, usage limits.",
  "- 2) 'Changes for everyday work': the other main features.",
  "- 3) 'Technical notes': shorter paragraphs on integrations, tools and minor wins, grouped by area.",
  "- 4) 'What to take away', split by reader: terminal user, user of parallel sessions, admin of",
  "  integrations and company deployments. What each should try or check.",
  `- At the end, in italics, a note on sources and period: the ${name} changelog (versions from–to,`,
  "  dates) and the documentation; for beta features note that availability may change.",
  "",
  "VOICE:",
  "- Address the reader as 'you'. First-person opinion is allowed only where the input facts support it",
  "  (e.g. the practical impact of a change). No unsupported judgements or speculation about company motives.",
  "- NEVER invent personal experience, anecdotes or habits of the author ('I used to manually…', 'every day I missed…').",
  "- Admit uncertainty plainly, put scepticism in parentheses, dry humour yes, irony at the reader's expense never.",
  "  Marketing superlatives (revolutionary, groundbreaking, game changer, cutting-edge) are forbidden.",
  "- Start sentences with subject and verb; vary short and long sentences, never three long ones in a row.",
  "",
  "LANGUAGE:",
  "- Plain, conversational international English (American spelling). No Czech-specific context: no",
  "  courses, Czech events, CZK prices or local references.",
  "- Mid-sentence dash is a spaced hyphen ( - ). NEVER an em dash (—).",
  "- No negative parallelism ('it's not A, it's B', 'not A but B'): just say B.",
  "- No clichés: 'In today's world', 'It is important to note', 'plays a key role', 'In conclusion',",
  "  chains of 'Moreover / Furthermore / Additionally', the rule of three, 'delve', 'landscape'.",
  "- Keep practical details from the input: keyboard shortcuts, setting and variable names the reader uses",
  "  to turn a feature on or off. Mention versions only as listed for the cited entries.",
  "- Links only to documentation URLs given in the input (docLink field); never invent others.",
  "- The reader never sees the input: never mention 'the input', 'the entries' or what they leave out.",
  "  Skip a missing detail, or point to the documentation.",
  "",
  'OUTPUT: JSON {"title": "<headline naming the main feature, without the tool name or week number>",',
  ' "excerpt": "<1-2 sentences, used as meta description>", "summaryPoints": ["<4-6 sentences on what is new>"],',
  ' "body": "<markdown article WITHOUT a title, starts with the lead>"}.',
  "Do not use the double-quote character inside text values; use single quotes.",
].join("\n");

export const WRITER_SYSTEM_EN = writerSystemEn("Claude Code");

const VERSION_FIX_SYSTEM_EN = [
  "You fix version numbers in an English article. You get the ARTICLE, a list of WRONG VERSIONS (not on any",
  "cited entry) and the real versions of each feature (FEATURE VERSIONS). Replace each wrong version with the",
  "correct one for the feature it belongs to, or remove it. Do NOT change anything else. Return only the markdown.",
].join("\n");

const MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** „September 14–20, 2026“, „September 28 – October 4, 2026“. */
export function englishDateRange(a: Date, b: Date): string {
  const m = (x: Date) => MONTHS_EN[x.getUTCMonth()]!;
  if (a.getUTCMonth() === b.getUTCMonth()) return `${m(a)} ${a.getUTCDate()}–${b.getUTCDate()}, ${b.getUTCFullYear()}`;
  return `${m(a)} ${a.getUTCDate()} – ${m(b)} ${b.getUTCDate()}, ${b.getUTCFullYear()}`;
}

export const englishWriter = (tool: ToolKey): WriterLang => ({
  system: writerSystemEn(toolName(tool)),
  versionFixSystem: VERSION_FIX_SYSTEM_EN,
  user: (sel) => [
    `WEEK: ${sel.weekLabel}, ${englishDateRange(new Date(sel.from), new Date(sel.to))}; versions ${sel.range.from} to ${sel.range.to} (${sel.releases} releases, ${sel.entries} changelog entries).`,
    "",
    "MAIN FEATURES (in order of importance):",
    ...sel.features.map((f, n) => [
      `${n + 1}. ${f.title} | versions: ${f.versions.join(", ")} | docLink: ${f.docLink ?? "-"}`,
      `   ${f.lede}`,
      ...f.sources.map((l) => `   - ${l}`),
    ].join("\n")),
    "",
    "MINOR WINS:",
    ...sel.minorWins.map((w) => `- ${w.text} | versions: ${w.versions.join(", ") || "-"}`),
    "",
    "TOPICS (context, not a list to cover): " + sel.topics.join(", "),
  ].join("\n"),
  incomplete: (missing) => `THE PREVIOUS ANSWER WAS INCOMPLETE. Return JSON with all fields: ${missing}.`,
});

export const ENGLISH_WRITER = englishWriter(CLAUDE_CODE);

const pad = (n: number) => String(n).padStart(2, "0");

/** Den vydání = pondělí po uzavřeném týdnu (stálý, nemění se s retry ani pozdním schválením). */
export function publicationDate(sel: Pick<WeekSelection, "week">): Date {
  return new Date(isoWeekBounds(sel.week.year, sel.week.week).end.getTime() + 1);
}

/** Cesta souboru podle kontraktu: src/content/english/<tool>-weekly-<rok>-w<NN>.md. */
export function englishWeeklyPath(sel: Pick<WeekSelection, "tool" | "week">): string {
  return `src/content/english/${sel.tool}-weekly-${sel.week.year}-w${pad(sel.week.week)}.md`;
}

/** Markdown souboru s front matterem podle kontraktu (bez translation_of: český článek je za paywallem). */
export function englishWeeklyMarkdown(
  sel: WeekSelection,
  written: { title: string; excerpt: string; summaryPoints: string[]; body: string },
  date: Date = publicationDate(sel),
): string {
  const name = toolName(sel.tool);
  const headline = written.title.replace(new RegExp(`^${name}[,:]?\\s*(Week\\s*\\d+\\s*[:,-]\\s*)?`, "i"), "").trim();
  // Titulek = jen headline; nástroj a týden web ukáže z polí tool a week.
  const title = headline || written.title.trim();
  // Nadpisy v těle od ##: případný # se sníží o úroveň (mimo bloky kódu).
  const body = written.body
    .split(/(^```[\s\S]*?^```)/m)
    .map((part) => (part.startsWith("```") ? part : part.replace(/^# /gm, "## ")))
    .join("")
    .trim();
  const points = written.summaryPoints.filter((p) => p.trim());
  return [
    "---",
    `title: ${yamlQuote(title)}`,
    `date: '${date.toISOString().slice(0, 10)}'`,
    "author: Patrick Zandl",
    "type: news",
    "series: weekly-updates",
    `tool: ${sel.tool}`,
    `week: ${sel.week.year}-W${pad(sel.week.week)}`,
    "categories:",
    `  - ${name}`,
    `post_excerpt: ${yamlQuote(written.excerpt)}`,
    // Prázdný klíč by byl null a schéma webu by ho odmítlo.
    ...(points.length ? ["summary_points:", ...points.map((p) => `  - ${yamlQuote(p)}`)] : []),
    "---",
    "",
    body,
    "",
  ].join("\n");
}

// ─── GitHub ───────────────────────────────────────────────────────

type GhFetch = typeof fetch;

/** Chyba GitHub API. Trvalé chyby (špatný token, repo, oprávnění) se neopakují. */
export class GithubError extends Error {
  constructor(message: string, readonly status: number) { super(message); this.name = "GithubError"; }
  get permanent(): boolean { return [401, 403, 404, 422].includes(this.status); }
}

/** Minimální klient GitHub REST API (token jen pro repo webu). */
function github(token: string, repo: string, f: GhFetch) {
  const call = async (method: string, path: string, body?: unknown): Promise<Response> =>
    f(`https://api.github.com/repos/${repo}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "videokurzy-cc-news",
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
  const json = async <T>(res: Response, what: string): Promise<T> => {
    if (!res.ok) throw new GithubError(`GitHub ${what} failed: ${res.status} ${(await res.text()).slice(0, 200)}`, res.status);
    return (await res.json()) as T;
  };
  return { call, json };
}

/** UTF-8 → base64 (GitHub contents API). */
function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export interface SitePr { url: string; branch: string; path: string; created: boolean; sha?: string }

/** Existuje soubor na výchozí větvi repa (tj. už je vydaný)? */
export async function fileOnDefaultBranch(token: string, repo: string, path: string, f: GhFetch = fetch): Promise<boolean> {
  const gh = github(token, repo, f);
  const res = await gh.call("GET", `/contents/${path.split("/").map(encodeURIComponent).join("/")}`);
  if (res.status === 404) return false;
  await gh.json(res, "read file on default branch");
  return true;
}

/**
 * Otevře (nebo znovupoužije) PR s jedním souborem. Větev se zakládá z výchozí
 * větve repa; existující větev, soubor i otevřený PR se při opakování aktualizují.
 */
export async function openSitePullRequest(
  token: string,
  repo: string,
  file: { path: string; content: string },
  pr: { branch: string; title: string; body: string },
  f: GhFetch = fetch,
  guard: { lastWrittenSha?: string | null; overwrite?: boolean } = {},
): Promise<SitePr | { edited: true; branch: string; path: string }> {
  const gh = github(token, repo, f);
  const { default_branch: base } = await gh.json<{ default_branch: string }>(await gh.call("GET", ""), "repo");
  const { object } = await gh.json<{ object: { sha: string } }>(await gh.call("GET", `/git/ref/heads/${base}`), "base ref");

  const ref = await gh.call("POST", "/git/refs", { ref: `refs/heads/${pr.branch}`, sha: object.sha });
  if (!ref.ok && ref.status !== 422) await gh.json(ref, "create branch"); // 422 = větev už existuje

  const encodedPath = file.path.split("/").map(encodeURIComponent).join("/");
  const existing = await gh.call("GET", `/contents/${encodedPath}?ref=${encodeURIComponent(pr.branch)}`);
  const sha = existing.ok ? (await existing.json() as { sha: string }).sha : undefined;
  if (!existing.ok && existing.status !== 404) await gh.json(existing, "read file");
  // Soubor na větvi, který jsme nezapsali my (ruční úprava v PR), se bez overwrite nepřepíše.
  if (sha && sha !== guard.lastWrittenSha && !guard.overwrite) return { edited: true, branch: pr.branch, path: file.path };
  const written = await gh.json<{ content?: { sha?: string } }>(await gh.call("PUT", `/contents/${encodedPath}`, {
    message: pr.title,
    content: toBase64(file.content),
    branch: pr.branch,
    ...(sha ? { sha } : {}),
  }), "write file");
  const writtenSha = written.content?.sha;

  const owner = repo.split("/")[0]!;
  const open = await gh.json<{ html_url: string }[]>(
    await gh.call("GET", `/pulls?state=open&head=${encodeURIComponent(`${owner}:${pr.branch}`)}`), "list pulls");
  if (open[0]) return { url: open[0].html_url, branch: pr.branch, path: file.path, created: false, sha: writtenSha };
  const created = await gh.json<{ html_url: string }>(
    await gh.call("POST", "/pulls", { title: pr.title, head: pr.branch, base, body: pr.body }), "create pull");
  return { url: created.html_url, branch: pr.branch, path: file.path, created: true, sha: writtenSha };
}

// ─── Celý krok ────────────────────────────────────────────────────

export type EnglishOutcome =
  | { kind: "no-selection" }
  | { kind: "already-published"; path: string }
  | { kind: "edited-on-branch"; path: string; branch: string }
  | { kind: "no-token"; markdown: string; path: string }
  | { kind: "pr"; pr: SitePr };

/**
 * Z uloženého výběru napíše anglický článek a otevře PR do repa webu.
 * - Bez tokenu (nebo `dryRun`) jen vrátí markdown (zkouška nanečisto).
 * - Vydání bez uloženého výběru (starší než tato funkce) se přeskočí.
 * - Článek, který už je na výchozí větvi webu, se bez `force` nepřepisuje
 *   (opakované schválení nesmaže ruční úpravy vydané verze).
 * - Napsaný markdown se ukládá a znovu použije; `regenerate` napíše nový.
 */
export async function publishEnglishWeekly(
  env: EnglishEnv,
  itemId: string,
  opts: { llm?: LlmFn; fetch?: GhFetch; dryRun?: boolean; force?: boolean; regenerate?: boolean } = {},
): Promise<EnglishOutcome> {
  const sel = await env.KV.get<WeekSelection>(selectionKvKey(itemId), "json");
  if (!sel) return { kind: "no-selection" };
  const path = englishWeeklyPath(sel);
  const token = opts.dryRun ? undefined : env.VIBECODING_SITE_GITHUB_TOKEN;
  const repo = env.VIBECODING_SITE_REPO || DEFAULT_REPO;
  if (token && !opts.force && (await fileOnDefaultBranch(token, repo, path, opts.fetch))) {
    return { kind: "already-published", path };
  }

  type Cached = { markdown: string; review: string[] };
  let cached = opts.regenerate ? null : await env.KV.get<Cached>(englishMdKvKey(itemId), "json");
  if (!cached) {
    const written = await writeWeeklyArticle(opts.llm ?? openRouterLlm(env, writeModel(env)), sel, englishWriter(sel.tool));
    cached = {
      markdown: englishWeeklyMarkdown(sel, written),
      review: [
        written.versionIssues.length ? `- ⚠️ verze mimo citované položky: ${written.versionIssues.join(", ")}` : "",
        written.strippedLinks.length ? `- odstraněné odkazy: ${written.strippedLinks.join(", ")}` : "",
        written.editorNotes.length ? `- poznámky modelu: ${written.editorNotes.join(" / ")}` : "",
      ].filter(Boolean),
    };
    await env.KV.put(englishMdKvKey(itemId), JSON.stringify(cached), { expirationTtl: EN_MD_TTL_SEC });
  }
  if (!token) return { kind: "no-token", markdown: cached.markdown, path };

  const week = `${sel.week.year}-W${pad(sel.week.week)}`;
  const pr = await openSitePullRequest(
    token,
    repo,
    { path, content: cached.markdown },
    {
      branch: `en-weekly/${sel.tool}-${sel.week.year}-w${pad(sel.week.week)}`,
      title: `${toolName(sel.tool)} weekly ${week}`,
      body: [
        `Anglický týdenní přehled ${toolName(sel.tool)} za ${week} (${sel.weekLabel}), verze ${sel.range.from}–${sel.range.to}.`,
        "",
        `Napsáno rovnou anglicky z ověřeného výběru ${sel.tool === CLAUDE_CODE ? "české verze" : "interního týdenního přehledu"} (\`${itemId}\`, KV \`${selectionKvKey(itemId)}\`): ${sel.features.length} hlavních novinek, ${sel.minorWins.length} drobností z ${sel.entries} položek changelogu.`,
        "",
        "Kontroly v kódu:",
        ...(cached.review.length ? cached.review : ["- bez nálezů (verze, odkazy, poznámky)"]),
        "",
        "Vydání = sloučení tohoto PR.",
        "",
        "🤖 Generated by videokurzy (cc-news.en-weekly)",
      ].join("\n"),
    },
    opts.fetch,
    { lastWrittenSha: await env.KV.get(englishShaKvKey(itemId)), overwrite: opts.force },
  );
  if ("edited" in pr) return { kind: "edited-on-branch", path: pr.path, branch: pr.branch };
  if (pr.sha) await env.KV.put(englishShaKvKey(itemId), pr.sha, { expirationTtl: EN_MD_TTL_SEC });
  return { kind: "pr", pr };
}
