// Přehled témat na /novinky-cc/temata: co je teď v centru vývoje Claude Code,
// co roste a co ustupuje, s týdenním průběhem podílu a srovnáním s ostatními
// nástroji. Podíl, okna i směr přebírá z trends.ts (stejná čísla jako panel na
// /novinky-cc); navíc počítá podíl tématu po jednotlivých týdnech obou oken.

import { and, gte, isNotNull, lt, sql } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";
import { ccChangeItem } from "../../db/schema";
import { TOOLS, type ToolKey } from "../tools/registry";
import { TOPICS, TOPIC_ABOUT } from "./taxonomy";
import { computeTopicTrends, isoWeekStart, PREVIOUS_WEEKS, RECENT_WEEKS, type TopicTrend, type TopicTrends } from "./trends";

type Db = ReturnType<typeof drizzle>;

const WEEK = 7 * 86_400_000;
export const STRIP_WEEKS = PREVIOUS_WEEKS + RECENT_WEEKS;
/** U ostatních nástrojů nejvýš tolik hlavních témat. */
const TOOL_TOP = 3;

/** Počet zatříděných položek jednoho nástroje, tématu a týdne. */
export interface OverviewRow {
  tool: string;
  topic: string;
  /** Pořadí týdne od začátku pruhu (0 = nejstarší). */
  week: number;
  n: number;
}

export interface TopicOverview extends TopicTrend {
  /** Česká věta o tématu (TOPIC_ABOUT). */
  description: string;
  /** Podíl tématu v jednotlivých týdnech pruhu (%), null = týden bez zatříděných změn. */
  weeks: (number | null)[];
}

export interface ToolFocus {
  tool: ToolKey;
  name: string;
  /** Zatříděné změny nástroje za poslední 4 týdny. */
  total: number;
  /** Hlavní témata nástroje s podílem a podílem téhož tématu u Claude Code. */
  top: { key: string; label: string; share: number; ccShare: number }[];
}

export interface TopicsOverview {
  from: number;
  to: number;
  /** Pondělí prvního týdne pruhu, epoch ms. */
  stripFrom: number;
  total: number;
  topics: TopicOverview[];
  tools: ToolFocus[];
}

/** Sestaví přehled z trendů a týdenních počtů; čistá funkce kvůli testům a náhledům. */
export function buildTopicsOverview(trends: TopicTrends, rows: OverviewRow[]): TopicsOverview {
  const stripFrom = trends.from - PREVIOUS_WEEKS * WEEK;
  const cc = rows.filter((r) => r.tool === "claude-code");
  const weekTotals = Array<number>(STRIP_WEEKS).fill(0);
  for (const r of cc) if (r.week >= 0 && r.week < STRIP_WEEKS) weekTotals[r.week]! += r.n;
  const desc = new Map(TOPICS.map((t) => [t.key, TOPIC_ABOUT[t.key] ?? ""]));
  const topics = trends.topics.map((t) => {
    const counts = Array<number>(STRIP_WEEKS).fill(0);
    for (const r of cc) if (r.topic === t.key && r.week >= 0 && r.week < STRIP_WEEKS) counts[r.week]! += r.n;
    return {
      ...t,
      description: desc.get(t.key) ?? "",
      weeks: counts.map((n, i) => (weekTotals[i]! > 0 ? (100 * n) / weekTotals[i]! : null)),
    };
  });

  const ccShare = new Map(trends.topics.map((t) => [t.key, t.share]));
  const label = new Map(TOPICS.map((t) => [t.key, t.label]));
  const recentFrom = PREVIOUS_WEEKS;
  const tools: ToolFocus[] = (Object.keys(TOOLS) as ToolKey[])
    .filter((k) => k !== "claude-code")
    .map((tool) => {
      const own = rows.filter((r) => r.tool === tool && r.week >= recentFrom && r.topic !== "other");
      const byTopic = new Map<string, number>();
      for (const r of own) byTopic.set(r.topic, (byTopic.get(r.topic) ?? 0) + r.n);
      // Jmenovatel včetně „Ostatní“, stejně jako u Claude Code.
      const total = rows.filter((r) => r.tool === tool && r.week >= recentFrom).reduce((s, r) => s + r.n, 0);
      const top = [...byTopic]
        .sort((a, b) => b[1] - a[1])
        .slice(0, TOOL_TOP)
        .map(([key, n]) => ({ key, label: label.get(key) ?? key, share: total ? (100 * n) / total : 0, ccShare: ccShare.get(key) ?? 0 }));
      return { tool, name: TOOLS[tool].name, total, top };
    });

  return { from: trends.from, to: trends.to, stripFrom, total: trends.total, topics, tools };
}

export async function computeTopicsOverview(db: Db, now: Date): Promise<TopicsOverview> {
  const trends = await computeTopicTrends(db, now);
  const stripFrom = isoWeekStart(now) - STRIP_WEEKS * WEEK;
  const fromS = stripFrom / 1000;
  const rows = await db
    .select({
      tool: ccChangeItem.tool,
      topic: ccChangeItem.topic,
      week: sql<number>`cast((${ccChangeItem.publishedAt} - ${fromS}) / 604800 as integer)`,
      n: sql<number>`count(*)`,
    })
    .from(ccChangeItem)
    .where(and(isNotNull(ccChangeItem.topic), gte(ccChangeItem.publishedAt, new Date(stripFrom)), lt(ccChangeItem.publishedAt, new Date(trends.to))))
    .groupBy(ccChangeItem.tool, ccChangeItem.topic, sql`3`);
  return buildTopicsOverview(trends, rows.map((r) => ({ tool: r.tool, topic: r.topic!, week: Number(r.week), n: Number(r.n) })));
}

export const overviewKvKey = (weekStart: number) => `cc-news:topics-overview:v1:${weekStart}`;

/** Přehled s hodinovou cache v KV (stejný rytmus jako trendy). */
export async function getTopicsOverview(env: { KV: KVNamespace }, db: Db, now: Date): Promise<TopicsOverview> {
  const key = overviewKvKey(isoWeekStart(now));
  try {
    const hit = await env.KV.get<TopicsOverview>(key, "json");
    if (hit) return hit;
  } catch (err) {
    console.error("[cc-news] čtení přehledu témat z KV selhalo:", (err as Error)?.message);
  }
  const overview = await computeTopicsOverview(db, now);
  try {
    await env.KV.put(key, JSON.stringify(overview), { expirationTtl: 3600 });
  } catch (err) {
    console.error("[cc-news] zápis přehledu témat do KV selhal:", (err as Error)?.message);
  }
  return overview;
}
