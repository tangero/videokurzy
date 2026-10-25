// Volání modelů přes OpenRouter pro „Novinky v CC" (fáze 2: třídění changelogu,
// výběr novinek, kontrola faktů, psaní článku). Redakční vrstva oficiálních
// přehledů (editor.ts) má vlastní volač a zůstává beze změny.

export interface LlmEnv {
  OPENROUTER_API_KEY?: string;
  /** Psaní a výběr (default nejnovější Sonnet). Sdílí proměnnou s editor.ts. */
  CC_NEWS_LLM_MODEL?: string;
  /** Třídění, extrakce z dokumentace, kontrola faktů (default nejnovější Haiku). */
  CC_NEWS_CLASSIFY_MODEL?: string;
}

// Aliasy OpenRouteru ukazují na nejnovější verzi; konkrétní ID OpenRouter časem
// vyřazuje a volání pak padá. Pevnou verzi lze vynutit proměnnými výše.
export const DEFAULT_WRITE_MODEL = "~anthropic/claude-sonnet-latest";
export const DEFAULT_CLASSIFY_MODEL = "~anthropic/claude-haiku-latest";
// Výběr novinek nad stovkami položek trvá u Sonnetu i 2 minuty.
const LLM_TIMEOUT_MS = 240_000;

export type LlmFn = (system: string, user: string, opts?: { maxTokens?: number; attempt?: number }) => Promise<string>;

export function writeModel(env: LlmEnv): string {
  return env.CC_NEWS_LLM_MODEL ?? DEFAULT_WRITE_MODEL;
}

export function classifyModel(env: LlmEnv): string {
  return env.CC_NEWS_CLASSIFY_MODEL ?? DEFAULT_CLASSIFY_MODEL;
}

/** Reálný volač OpenRouteru pro daný model. */
export function openRouterLlm(env: LlmEnv, model: string): LlmFn {
  return async (system, user, opts = {}) => {
    if (!env.OPENROUTER_API_KEY) throw new Error("cc-news: chybí OPENROUTER_API_KEY");
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        "content-type": "application/json",
        "HTTP-Referer": "https://kurzy.vibecoding.cz",
        "X-Title": "Novinky v Claude Code",
      },
      body: JSON.stringify({
        model,
        // Opakovaný pokus po neplatném JSON nesmí vrátit stejnou odpověď.
        temperature: opts.attempt ? 0.3 : 0,
        max_tokens: opts.maxTokens ?? 8000,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
      signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`cc-news LLM ${model} failed: ${res.status}`);
    if (!res.headers.get("content-type")?.includes("application/json")) {
      throw new Error("cc-news LLM: neočekávaný content-type (ne JSON)");
    }
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return data.choices?.[0]?.message?.content ?? "";
  };
}

/** Síťová/HTTP chyba nebo timeout volání modelu (ne neplatný JSON v odpovědi). */
export function isTransportError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return err.name === "TimeoutError" || err.name === "AbortError" || /LLM .* failed|OPENROUTER|content-type/.test(err.message);
}

/** Vytáhne JSON z odpovědi modelu (toleruje ```json ohraničení a text okolo). */
export function parseJsonLoose<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (fenced ? fenced[1]! : text).trim();
  const start = raw.search(/[[{]/);
  const end = Math.max(raw.lastIndexOf("]"), raw.lastIndexOf("}"));
  if (start < 0 || end < start) throw new Error("cc-news LLM: odpověď neobsahuje JSON");
  const json = raw.slice(start, end + 1);
  try {
    return JSON.parse(json) as T;
  } catch (err) {
    // Model občas opíše ukázku příkazu s dvojitými uvozovkami do textu
    // („spusť "grok --x"“) a celý JSON je neplatný i po opakování.
    // Jindy chybí čárka mezi prvky na samostatných řádcích.
    const repaired = escapeInnerQuotes(json).replace(/([}\]"])(\s*\n\s*)(?=[{"])/g, "$1,$2");
    try {
      return JSON.parse(repaired) as T;
    } catch {
      // Výřez kolem chyby do logu, ať je vidět, co model vrátil.
      const pos = Number((err as Error).message.match(/position (\d+)/)?.[1] ?? -1);
      const around = pos >= 0 ? ` …${json.slice(Math.max(0, pos - 150), pos + 50)}…` : "";
      throw new SyntaxError(`${(err as Error).message}${around}`);
    }
  }
}

/**
 * Escapuje dvojité uvozovky uvnitř řetězců. Uvozovka řetězec ukončuje, jen když
 * za ní (po mezerách) následuje `,` `:` `}` `]` nebo konec; jinak je součástí textu.
 */
export function escapeInnerQuotes(json: string): string {
  let out = "";
  let inString = false;
  for (let i = 0; i < json.length; i++) {
    const ch = json[i]!;
    if (!inString) {
      if (ch === '"') inString = true;
      out += ch;
      continue;
    }
    if (ch === "\\") {
      out += ch + (json[i + 1] ?? "");
      i++;
      continue;
    }
    if (ch === '"') {
      const next = json.slice(i + 1).match(/^\s*(.)/)?.[1];
      if (next === undefined || ",:}]".includes(next)) {
        inString = false;
        out += ch;
      } else {
        out += '\\"';
      }
      continue;
    }
    out += ch;
  }
  return out;
}

/**
 * Volání, které má vrátit JSON. Neplatnou odpověď (neukončený řetězec, uvozovky
 * v textu, useknutí) zkusí až 2× znovu s mírně vyšší teplotou.
 */
export async function llmJson<T>(llm: LlmFn, system: string, user: string, maxTokens = 8000, firstAttempt = 0): Promise<T> {
  let lastErr: unknown;
  for (let attempt = firstAttempt; attempt < firstAttempt + 3; attempt++) {
    try {
      return parseJsonLoose<T>(await llm(system, user, { maxTokens, attempt }));
    } catch (err) {
      lastErr = err;
      // Síťová/HTTP chyba ani timeout se neopakují tady — o retry rozhodne fronta.
      // (Opakovaný 240s timeout by konzumenta zdržel až na 12 minut.)
      if (isTransportError(err)) throw err;
    }
  }
  throw lastErr;
}
