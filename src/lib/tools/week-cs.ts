// Krátký český souhrn týdne dalšího sledovaného nástroje pro mapu ekosystému
// (/novinky-cc/ekosystem). Píše se z ověřeného výběru týdne (selectAndVerify,
// KV `cc-news:selection:<tool>-<rok>-wNN`), ne z anglického přehledu: 3–5 vět
// místo článku, bez schvalování. Nový výběr souhrn zneplatní (buildToolWeek).

import { llmJson, openRouterLlm, writeModel, type LlmEnv, type LlmFn } from "../cc-news/llm";
import { selectionKvKey, type WeekSelection } from "../cc-news/weekly";
import { toolName, type ToolKey } from "./registry";
import { toolSelectionId, toolWeekCsKvKey } from "./weekly-tool";

type Week = { year: number; week: number };

export const MAX_POINTS = 5;

export interface ToolWeekCs {
  v: 1;
  tool: ToolKey;
  week: Week;
  builtAt: string;
  points: string[];
}

export const CS_SYSTEM = (name: string) => [
  `Píšeš pro předplatitele kurzů o Claude Code krátký český souhrn týdne nástroje ${name}.`,
  "Čtenář zná Claude Code a chce vědět, co nového přinesl konkurenční nástroj. Souhrn stojí na",
  "přehledové stránce vedle ostatních nástrojů, žádný článek.",
  "",
  "VSTUP: hlavní novinky týdne (FEATURE: název, popis, verze) a drobnosti (MINOR), anglicky,",
  "ověřené proti changelogu. Fakta ber VÝHRADNĚ ze vstupu. Nic nedomýšlej: žádná čísla, ceny, limity,",
  "tarify, názvy nastavení ani verze, které ve vstupu nejsou. Žádné srovnání s Claude Code.",
  "",
  `VÝSTUP: 3 až ${MAX_POINTS} vět, nejdůležitější první. Když je ve vstupu méně novinek, napiš tolik vět,`,
  "kolik je novinek. Každá věta je samostatná, řekne co je nového a k čemu to je, nejvýš 30 slov.",
  "Drobnosti zmiň, jen když nejsou hlavní novinky aspoň tři.",
  "",
  "JAZYK: spisovná věcná čeština, oznamovací způsob, bez marketingových superlativů a bez názoru.",
  "Anglicismy nahraď českými ekvivalenty, kde existují; zavedené IT termíny ponech. Názvy příkazů,",
  "přepínačů, nastavení a souborů dej do `zpětných apostrofů`. Pomlčka je krátká s mezerami ( - ),",
  "nikdy em dash (—). Nepiš o „vstupu“ ani o tom, co v něm chybí.",
  "",
  'VÝSTUP: JSON {"points": ["<věta>", …]}. Uvnitř vět nepoužívej dvojité uvozovky; v češtině piš „ “.',
].join("\n");

/** Vstup pro model: hlavní novinky a drobnosti z ověřeného výběru. */
export function csUserMessage(sel: WeekSelection): string {
  const lines = [
    ...sel.features.map((f) => `FEATURE: ${f.title} — ${f.lede} (verze ${f.versions.join(", ") || "neuvedena"})`),
    ...sel.minorWins.map((w) => `MINOR: ${w.text}`),
  ];
  return `NÁSTROJ: ${toolName(sel.tool)}, týden ${sel.week.week}/${sel.week.year}\n\n${lines.join("\n")}`;
}

/** Ověří odpověď modelu: 1–5 neprázdných vět, nejvýš tolik, kolik má výběr položek. */
export function validateCsPoints(out: unknown, sel: WeekSelection): string[] {
  const raw = (out as { points?: unknown })?.points;
  if (!Array.isArray(raw)) throw new Error("tools.week-cs: odpověď nemá pole points");
  const points = raw
    .filter((p): p is string => typeof p === "string")
    .map((p) => p.replace(/\s*—\s*/g, " - ").replace(/\s+/g, " ").trim())
    .filter((p) => p.length > 0);
  const limit = Math.min(MAX_POINTS, sel.features.length + sel.minorWins.length);
  if (points.length === 0) throw new Error("tools.week-cs: model nevrátil žádnou větu");
  if (points.length > limit) throw new Error(`tools.week-cs: ${points.length} vět, povoleno nejvýš ${limit}`);
  return points;
}

/**
 * Napíše a uloží souhrn týdne. Bez uloženého výběru (prázdný týden) souhrn smaže
 * a vrátí null. Síťové chyby modelu propaguje, o opakování rozhodne fronta.
 */
export async function writeToolWeekCs(
  env: LlmEnv & { KV: KVNamespace }, tool: ToolKey, week: Week, now: Date,
  llm: LlmFn = openRouterLlm(env, writeModel(env)),
): Promise<ToolWeekCs | null> {
  const key = toolWeekCsKvKey(tool, week);
  const sel = await env.KV.get<WeekSelection>(selectionKvKey(toolSelectionId(tool, week)), "json");
  if (!sel || (sel.features.length === 0 && sel.minorWins.length === 0)) {
    await env.KV.delete(key);
    return null;
  }
  const out = await llmJson<unknown>(llm, CS_SYSTEM(toolName(tool)), csUserMessage(sel), 2000);
  const cs: ToolWeekCs = { v: 1, tool, week, builtAt: now.toISOString(), points: validateCsPoints(out, sel) };
  await env.KV.put(key, JSON.stringify(cs));
  return cs;
}
