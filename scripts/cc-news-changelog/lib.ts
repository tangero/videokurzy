// Sdílené pomůcky pro experiment „Novinky v CC ze changelogu" (fáze 1, lokálně).
// Nic tu nesahá na produkci: jen čte GitHub/code.claude.com a volá OpenRouter.
// Odpovědi LLM se cachují na disk podle hashe vstupu, takže opakovaný běh
// (nebo rozšíření historie dozadu) nic znovu neplatí.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const OUT_DIR = process.env.CC_OUT_DIR ?? join(process.cwd(), ".cc-news-out");
export const CACHE_DIR = join(OUT_DIR, "cache");
mkdirSync(CACHE_DIR, { recursive: true });

export const MODEL_CLASSIFY = "anthropic/claude-haiku-5.5";
export const MODEL_WRITE = "anthropic/claude-sonnet-5.5";

// Ceny OpenRouter ($ / token) pro odhad nákladů běhu.
const PRICES: Record<string, [number, number]> = {
  [MODEL_CLASSIFY]: [0.0000001, 0.0000005],
  [MODEL_WRITE]: [0.000002, 0.00001],
};
export const costLog = { calls: 0, cached: 0, usd: 0 };

export function sha(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 24);
}

export function readJson<T>(path: string): T | null {
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : null;
}

export function writeJson(path: string, data: unknown): void {
  writeFileSync(path, JSON.stringify(data, null, 2));
}

function apiKey(): string {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;
  const devVars = readFileSync(join(process.cwd(), ".dev.vars"), "utf8");
  const m = devVars.match(/^OPENROUTER_API_KEY="?([^"\n]+)"?/m);
  if (!m) throw new Error("Chybí OPENROUTER_API_KEY (env ani .dev.vars)");
  return m[1]!;
}

/**
 * Jedno volání chat completions s diskovou cache. `promptVersion` patří do
 * klíče cache — změna promptu = nové volání, stará odpověď zůstane pro srovnání.
 */
export async function llm(opts: {
  model: string;
  system: string;
  user: string;
  promptVersion: string;
  maxTokens?: number;
}): Promise<string> {
  const key = sha([opts.model, opts.promptVersion, opts.system, opts.user].join("\u0000"));
  const path = join(CACHE_DIR, `${key}.json`);
  const hit = readJson<{ content: string }>(path);
  if (hit) {
    costLog.cached++;
    return hit.content;
  }
  for (let attempt = 1; ; attempt++) {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey()}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: opts.model,
        temperature: 0,
        max_tokens: opts.maxTokens ?? 8000,
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: opts.user },
        ],
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      if (attempt < 3 && (res.status === 429 || res.status >= 500)) {
        await new Promise((r) => setTimeout(r, 2000 * attempt));
        continue;
      }
      throw new Error(`OpenRouter ${res.status}: ${body.slice(0, 300)}`);
    }
    const data = (await res.json()) as {
      choices: { message: { content: string } }[];
      usage?: { prompt_tokens: number; completion_tokens: number };
    };
    const content = data.choices[0]?.message.content ?? "";
    const [pin, pout] = PRICES[opts.model] ?? [0, 0];
    costLog.calls++;
    costLog.usd += (data.usage?.prompt_tokens ?? 0) * pin + (data.usage?.completion_tokens ?? 0) * pout;
    writeJson(path, {
      content,
      model: opts.model,
      promptVersion: opts.promptVersion,
      at: new Date().toISOString(),
      usage: data.usage,
    });
    return content;
  }
}

/** Vytáhne JSON z odpovědi modelu (toleruje ```json ohraničení a text okolo). */
export function parseJsonLoose<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (fenced ? fenced[1]! : text).trim();
  const start = raw.search(/[[{]/);
  const end = Math.max(raw.lastIndexOf("]"), raw.lastIndexOf("}"));
  return JSON.parse(raw.slice(start, end + 1)) as T;
}

/**
 * Volání LLM, které má vrátit JSON. Když odpověď nejde naparsovat (neukončený
 * řetězec, uvozovky v textu, useknutí), zkusí to až 2× znovu s jinou verzí
 * promptu v klíči cache — špatná odpověď zůstane v cache, ale už se nepoužije.
 */
export async function llmJson<T>(opts: Parameters<typeof llm>[0]): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    const out = await llm({ ...opts, promptVersion: opts.promptVersion + (attempt ? `-retry${attempt}` : "") });
    try {
      return parseJsonLoose<T>(out);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

/** Zpracuje položky s omezenou paralelitou (OpenRouter rate limit). */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!);
      }
    }),
  );
  return out;
}

// ─── Changelog ────────────────────────────────────────────────────

export type ChangeType = "Added" | "Fixed" | "Improved" | "Changed" | "Removed" | "Deprecated" | "Other";

export interface ChangeItem {
  id: string;          // „2.1.263#12"
  version: string;     // „2.1.263"
  publishedAt: string; // ISO datum vydání verze
  type: ChangeType;
  scope: string | null; // prefix typu „[VSCode]", „Windows", „Self-hosted runner"
  text: string;
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** Rozloží řádek changelogu na prefix (platforma) a typ změny. */
export function parseItemLine(line: string): { type: ChangeType; scope: string | null; text: string } {
  let text = line.replace(/^-\s+/, "").trim();
  let scope: string | null = null;
  const bracket = text.match(/^\[([^\]]+)\]\s*/);
  if (bracket) {
    scope = bracket[1]!;
    text = text.slice(bracket[0].length);
  } else {
    const colon = text.match(/^(Windows|macOS|Linux|Self-hosted runner|VS ?Code|JetBrains|Desktop|SDK|Agent SDK):\s*/i);
    if (colon) {
      scope = colon[1]!;
      text = text.slice(colon[0].length);
    }
  }
  const t = text.match(/^(Added|Fixed|Improved|Changed|Removed|Deprecated)\b/)?.[1] as ChangeType | undefined;
  return { type: t ?? "Other", scope, text };
}

/**
 * Položky changelogu od `minVersion` výš, nejstarší první.
 *
 * Zdroj položek je CHANGELOG.md (úplný). GitHub releases NEPOUŽÍVÁME: některé
 * verze tam chybí (např. 2.1.243 se 60 položkami). Datum vydání bereme ze
 * stránky changelogu v dokumentaci (`<Update label="2.1.243" description="August 25, 2026">`).
 */
export async function fetchReleases(minVersion: string): Promise<ChangeItem[]> {
  const cachePath = join(OUT_DIR, `changelog-items-${minVersion}.json`);
  const cached = readJson<ChangeItem[]>(cachePath);
  if (cached) return cached;
  const [md, docs] = await Promise.all([
    fetch("https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md").then((r) => r.text()),
    fetch("https://code.claude.com/docs/en/changelog.md").then((r) => r.text()),
  ]);
  const dates = new Map<string, string>();
  for (const m of docs.matchAll(/<Update label="([\d.]+)" description="([^"]+)"/g)) {
    const d = new Date(`${m[2]} 12:00 UTC`);
    if (!Number.isNaN(+d)) dates.set(m[1]!, d.toISOString());
  }
  const items: ChangeItem[] = [];
  for (const m of md.matchAll(/^## (\d+\.\d+\.\d+)\s*\n([\s\S]*?)(?=^## |(?![\s\S]))/gm)) {
    const version = m[1]!;
    if (compareVersions(version, minVersion) < 0) continue;
    const publishedAt = dates.get(version);
    if (!publishedAt) {
      console.error(`[changelog] ${version}: chybí datum v dokumentaci, přeskočeno`);
      continue;
    }
    m[2]!.split("\n").filter((l) => /^-\s+/.test(l)).forEach((l, i) => {
      items.push({ id: `${version}#${i + 1}`, version, publishedAt, ...parseItemLine(l) });
    });
  }
  items.sort((a, b) => compareVersions(a.version, b.version) || idx(a) - idx(b));
  writeJson(cachePath, items);
  return items;
}

const idx = (i: ChangeItem) => Number(i.id.split("#")[1]);

/** Množina skutečných URL dokumentace z llms.txt (whitelist odkazů). */
export async function fetchDocWhitelist(): Promise<string[]> {
  const cachePath = join(OUT_DIR, "docs-whitelist.json");
  const cached = readJson<string[]>(cachePath);
  if (cached) return cached;
  const txt = await (await fetch("https://code.claude.com/docs/llms.txt")).text();
  const urls = [...new Set([...txt.matchAll(/https:\/\/code\.claude\.com\/docs\/en\/[^\s)]+/g)].map((m) =>
    m[0].replace(/\.md$/, ""),
  ))];
  writeJson(cachePath, urls);
  return urls;
}
