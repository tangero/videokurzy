// Sledované nástroje (Novinky v CC + sledování dalších agentů).
// Klíč jde do sloupce cc_change_item.tool a do KV klíčů.

export type ToolKey = "claude-code" | "grok-build" | "codex" | "antigravity";

export interface ToolInfo {
  name: string;
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
  "claude-code": { name: "Claude Code", englishWeekly: true, siteFolder: "claude-code", rubricUrl: "https://www.vibecoding.cz/claude-code/" },
  "grok-build": { name: "Grok Build", englishWeekly: true, siteFolder: "grok-build" },
  codex: { name: "Codex CLI", englishWeekly: false, siteFolder: "openai-codex", rubricUrl: "https://www.vibecoding.cz/openai-codex/" },
  antigravity: { name: "Antigravity CLI", englishWeekly: false, siteFolder: "antigravity" },
};

export const CLAUDE_CODE: ToolKey = "claude-code";

export function toolName(key: string): string {
  return TOOLS[key as ToolKey]?.name ?? key;
}

export function isToolKey(key: string): key is ToolKey {
  return key in TOOLS;
}
