// Pevný seznam témat pro třídění changelogu Claude Code („Novinky v CC",
// fáze 2). Model smí vybrat jen klíč z tohoto seznamu; co se nehodí,
// jde do `other`. Popis jde do promptu, proto má být konkrétní.

export interface Topic {
  key: string;
  label: string;
  description: string;
}

export const TOPICS: Topic[] = [
  { key: "prompt_cache", label: "Prompt cache", description: "prompt caching: cache hits/misses, cache TTL (5m/1h), cache writes, anything that keeps or breaks prompt-cache reuse" },
  { key: "context", label: "Kontext a kompakce", description: "context window, compaction/autocompact, idle compaction, token budgets, conversation length limits" },
  { key: "memory", label: "Paměť a instrukce", description: "CLAUDE.md, memory, rules, output styles, system prompt contents and instructions" },
  { key: "models", label: "Modely a uvažování", description: "model selection, effort, thinking, fast mode, model aliases, model-specific behaviour" },
  { key: "permissions", label: "Oprávnění a bezpečnost", description: "permission rules and prompts, auto mode and its classifier, sandbox, security fixes, trust dialogs" },
  { key: "tools", label: "Vestavěné nástroje", description: "built-in tools: Read, Edit, Write, Bash, PowerShell, Grep/Glob, WebFetch/WebSearch, ToolSearch, LSP" },
  { key: "mcp", label: "MCP", description: "MCP servers, MCP auth/OAuth, MCP tools/resources, `/mcp`" },
  { key: "hooks", label: "Hooks", description: "hooks of any kind (command, prompt, agent hooks), hook events and their payloads" },
  { key: "agents", label: "Subagenti a workflow", description: "subagents, forks, agent teams/teammates, Workflow tool, background tasks and agents view" },
  { key: "plugins", label: "Pluginy a skills", description: "plugins, marketplaces, skills, slash commands, mods, `claude plugin`" },
  { key: "sessions", label: "Relace a soubory", description: "session resume/continue/rewind, checkpoints, worktrees, git integration, file handling" },
  { key: "cloud", label: "Cloud a vzdálené relace", description: "Claude Code on the web, cloud sessions, Remote Control, self-hosted runners, Claude Tag, Code Review" },
  { key: "ide", label: "IDE a desktop", description: "VS Code, JetBrains, the desktop app and their integrations" },
  { key: "tui", label: "Terminál a ovládání", description: "terminal UI rendering, fullscreen, keybindings, status line, input, notifications, `/config` UI" },
  { key: "sdk", label: "SDK a headless", description: "Agent SDK, `claude -p` / print mode, headless and CI usage, stream-json output" },
  { key: "providers", label: "Přihlášení, poskytovatelé, účtování", description: "login/auth, Bedrock, Vertex, LLM gateways, API keys, usage limits, credits, billing" },
  { key: "telemetry", label: "Telemetrie a náklady", description: "OpenTelemetry, metrics/events, `/cost`, usage statistics, logging" },
  { key: "integrations", label: "Chrome, Design, Artifacts", description: "Claude in Chrome, Claude Design, artifacts publishing and other product integrations" },
  { key: "performance", label: "Výkon a stabilita", description: "startup time, memory use, crashes, hangs — only when performance/stability is the main point" },
  { key: "other", label: "Ostatní", description: "anything that fits none of the above" },
];

export const TOPIC_KEYS = new Set(TOPICS.map((t) => t.key));

export function topicLabel(key: string): string {
  return TOPICS.find((t) => t.key === key)?.label ?? key;
}
