// Volání modelů přes OpenRouter pro „Novinky v CC" (fáze 2: třídění changelogu,
// výběr novinek, kontrola faktů, psaní článku). Redakční vrstva oficiálních
// přehledů (editor.ts) má vlastní volač a zůstává beze změny.

export interface LlmEnv {
  OPENROUTER_API_KEY?: string;
  /** Psaní a výběr (default Sonnet 5.5). Sdílí proměnnou s editor.ts. */
  CC_NEWS_LLM_MODEL?: string;
  /** Třídění, extrakce z dokumentace, kontrola faktů (default Haiku 5.5). */
  CC_NEWS_CLASSIFY_MODEL?: string;
}

export const DEFAULT_WRITE_MODEL = "anthropic/claude-sonnet-5.5";
export const DEFAULT_CLASSIFY_MODEL = "anthropic/claude-haiku-5.5";
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

/** Vytáhne JSON z odpovědi modelu (toleruje ```json ohraničení a text okolo). */
export function parseJsonLoose<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (fenced ? fenced[1]! : text).trim();
  const start = raw.search(/[[{]/);
  const end = Math.max(raw.lastIndexOf("]"), raw.lastIndexOf("}"));
  if (start < 0 || end < start) throw new Error("cc-news LLM: odpověď neobsahuje JSON");
  return JSON.parse(raw.slice(start, end + 1)) as T;
}

/**
 * Volání, které má vrátit JSON. Neplatnou odpověď (neukončený řetězec, uvozovky
 * v textu, useknutí) zkusí až 2× znovu s mírně vyšší teplotou.
 */
export async function llmJson<T>(llm: LlmFn, system: string, user: string, maxTokens = 8000): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return parseJsonLoose<T>(await llm(system, user, { maxTokens, attempt }));
    } catch (err) {
      lastErr = err;
      // Síťová/HTTP chyba ani timeout se neopakují tady — o retry rozhodne fronta.
      // (Opakovaný 240s timeout by konzumenta zdržel až na 12 minut.)
      if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) throw err;
      if (err instanceof Error && /LLM .* failed|OPENROUTER|content-type/.test(err.message)) throw err;
    }
  }
  throw lastErr;
}
