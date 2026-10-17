// Sledované nástroje (Novinky v CC + interní sledování dalších agentů).
// Klíč jde do sloupce cc_change_item.tool a do KV klíčů.

export type ToolKey = "claude-code" | "grok-build";

export const TOOLS: Record<ToolKey, { name: string }> = {
  "claude-code": { name: "Claude Code" },
  "grok-build": { name: "Grok Build" },
};

export const CLAUDE_CODE: ToolKey = "claude-code";

export function toolName(key: string): string {
  return TOOLS[key as ToolKey]?.name ?? key;
}

export function isToolKey(key: string): key is ToolKey {
  return key in TOOLS;
}
