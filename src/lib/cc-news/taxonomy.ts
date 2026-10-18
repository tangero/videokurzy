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

/** Česká jednovětá charakteristika tématu pro čtenáře (popis v TOPICS je pro prompt). */
export const TOPIC_ABOUT: Record<string, string> = {
  prompt_cache: "Jak Claude Code znovu využívá už zpracovaný kontext, aby odpovídal rychleji a levněji.",
  context: "Kontextové okno, automatická kompakce a limity délky konverzace.",
  memory: "CLAUDE.md, paměť, pravidla a styly výstupu: co si agent nese mezi relacemi.",
  models: "Výběr modelu, míra uvažování, rychlý režim a chování konkrétních modelů.",
  permissions: "Co smí agent udělat sám: pravidla oprávnění, auto mode, sandbox a bezpečnostní opravy.",
  tools: "Vestavěné nástroje agenta: čtení a úpravy souborů, shell, vyhledávání, web.",
  mcp: "Napojení externích nástrojů a dat přes Model Context Protocol.",
  hooks: "Vlastní skripty a kontroly, které se spustí při událostech agenta, třeba před voláním nástroje.",
  agents: "Subagenti, týmy agentů, workflow a úlohy běžící na pozadí.",
  plugins: "Pluginy, skills, marketplace a vlastní příkazy.",
  sessions: "Relace, návrat ke konverzaci, checkpointy, worktree a práce s gitem.",
  cloud: "Claude Code na webu, vzdálené relace, Slack a cloudové běhy.",
  ide: "Rozšíření pro VS Code a JetBrains a desktopová aplikace.",
  tui: "Terminálové rozhraní: vykreslování, klávesové zkratky, stavový řádek a nastavení.",
  sdk: "Agent SDK a neinteraktivní běh v CI a skriptech.",
  providers: "Přihlášení, Bedrock, Vertex a další poskytovatelé, limity a účtování.",
  telemetry: "OpenTelemetry, metriky, sledování nákladů a logování.",
  integrations: "Claude in Chrome, Claude Design, artefakty a další produktové integrace.",
  performance: "Rychlost startu, spotřeba paměti, pády a zamrzání.",
  other: "Změny, které nepatří do žádného jiného tématu.",
};

/** Oddíl českého taháku na vibecoding.cz pro téma (kotva v /cheat-sheet/claude-code). */
const CHEAT_SHEET_SECTION: Record<string, string> = {
  hooks: "hooks", plugins: "skills", tools: "tools", mcp: "mcp", sessions: "worktrees",
  integrations: "integrations", tui: "shortcuts", sdk: "cli", memory: "files", permissions: "settings",
};

export function cheatSheetUrl(topic: string): string {
  const section = CHEAT_SHEET_SECTION[topic];
  return `https://www.vibecoding.cz/cheat-sheet/claude-code/?lang=cs${section ? `#${section}` : ""}`;
}
