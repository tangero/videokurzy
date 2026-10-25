// Sledované nástroje (Novinky v CC + sledování dalších agentů).
// Klíč jde do sloupce cc_change_item.tool a do KV klíčů.

export type ToolKey = "claude-code" | "grok-build" | "codex" | "antigravity" | "muse-code" | "grok-bot";

export interface ToolInfo {
  name: string;
  /**
   * coding = programovací agent (Novinky v CC, témata, mapa ekosystému, dohánění).
   * assistant = osobní AI asistent (Grok Bot, později Dots, Duet, Muse): do témat
   * ani ekosystému nepatří, jeho položky se netřídí do taxonomie CC (topic zůstává
   * NULL) a týdně z nich vzniká český zápis /novinky/<tool>/ na webu (assistant-cs.ts).
   */
  kind: "coding" | "assistant";
  /**
   * Anglický týdenní přehled na vibecoding.cz/en se při automatickém vydávání
   * zakládá sám. Nástroj musí být i ve WEEKLY_TOOLS webu, jinak PR neprojde.
   */
  englishWeekly: boolean;
  /** Složka rubriky článků na vibecoding.cz (/articles/<složka>/…). */
  siteFolder: string;
  /** Stránka rubriky na vibecoding.cz, jen když existuje. */
  rubricUrl?: string;
}

export const TOOLS: Record<ToolKey, ToolInfo> = {
  "claude-code": { name: "Claude Code", kind: "coding", englishWeekly: true, siteFolder: "claude-code", rubricUrl: "https://www.vibecoding.cz/claude-code/" },
  "grok-build": { name: "Grok Build", kind: "coding", englishWeekly: true, siteFolder: "grok-build" },
  codex: { name: "Codex CLI", kind: "coding", englishWeekly: true, siteFolder: "openai-codex", rubricUrl: "https://www.vibecoding.cz/openai-codex/" },
  antigravity: { name: "Antigravity CLI", kind: "coding", englishWeekly: true, siteFolder: "antigravity" },
  "muse-code": { name: "Muse Code", kind: "coding", englishWeekly: true, siteFolder: "muse-code" },
  // Osobní asistent xAI (ne coding agent). Anglická řada zatím není, jen český zápis /novinky/grok-bot/.
  "grok-bot": { name: "Grok Bot", kind: "assistant", englishWeekly: false, siteFolder: "grok-bot" },
};

/** Programovací agenti: jen ti patří do témat, mapy ekosystému a dohánění. */
export const CODING_TOOLS = (Object.keys(TOOLS) as ToolKey[]).filter((k) => TOOLS[k].kind === "coding");

/** Osobní asistenti s českým týdenním zápisem na webu (/novinky/<tool>/). */
export const ASSISTANT_TOOLS = (Object.keys(TOOLS) as ToolKey[]).filter((k) => TOOLS[k].kind === "assistant");

export function isAssistantTool(key: string): boolean {
  return isToolKey(key) && TOOLS[key].kind === "assistant";
}

export const CLAUDE_CODE: ToolKey = "claude-code";

export function toolName(key: string): string {
  return TOOLS[key as ToolKey]?.name ?? key;
}

export function isToolKey(key: string): key is ToolKey {
  return key in TOOLS;
}

/**
 * Verze s odvozeným datem vydání (changelog nástroje data neuvádí) a vydané verze,
 * které changelog ještě nemá. Zapisuje synchronizace nástroje, čte mapa ekosystému.
 */
export interface ToolDates {
  syncedAt: string;
  /** upper = datum nejbližší novější verze (vydáno nejpozději tehdy), first-seen = den prvního výskytu. */
  approx: { version: string; at: string; basis: "upper" | "first-seen" }[];
  missing: { version: string; at: string }[];
}

export const toolDatesKvKey = (tool: ToolKey) => `tools:dates-approx:${tool}`;
