// Dlouhodobý vývoj jednoho tématu (/novinky-cc/temata/<téma>): týdenní osa od
// první změny, detail vybraného týdne, milníky a srovnání s dalšími sledovanými
// nástroji. Výpočet je čistá funkce nad řádky cc_change_item (testovatelná bez
// DB); načtení z D1 a cache řeší loadTopicHistory.

import { and, eq, sql } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";
import { ccChangeItem } from "../../db/schema";
import { isoWeek, weekKey } from "./changelog-source";
import { isoWeekStart } from "./trends";
import { CLAUDE_CODE, TOOLS, type ToolKey } from "../tools/registry";

type Db = ReturnType<typeof drizzle>;
const DAY = 86_400_000;
const WEEK = 7 * DAY;

export interface HistoryItem {
  id: string;
  tool: string;
  version: string;
  publishedAt: number; // epoch ms
  type: string;
  text: string;
  significance: number;
  reason: string | null;
  followsId: string | null;
  relation: string | null;
  followReason: string | null;
}

export interface HistoryWeek {
  key: string; // 2026-w41
  start: number; // pondělí 00:00 UTC, epoch ms
  added: number; // nové funkce a změny (vše kromě Fixed)
  fixed: number;
  major: number;
  /** Podíl tématu na všech změnách nástroje v týdnu (%), když je součet známý. */
  share: number | null;
  /** Všechny změny nástroje v týdnu (jmenovatel podílu). */
  toolTotal: number | null;
}

export interface Milestone {
  id: string;
  weekKey: string;
  version: string;
  publishedAt: number;
  title: string; // české zdůvodnění, jinak originál
  text: string;
}

export interface WeekDetail {
  key: string;
  start: number;
  versions: string[];
  major: HistoryItem[];
  added: HistoryItem[];
  fixed: HistoryItem[];
  prevKey: string | null;
  nextKey: string | null;
}

export type Phase = "peak" | "rising" | "steady" | "quiet" | "dormant";

export interface ToolHistory {
  tool: ToolKey;
  name: string;
  since: number | null; // první změna v tématu
  total: number;
  majorCount: number;
  weeks: HistoryWeek[];
  milestones: Milestone[];
  /** Fáze: poslední 4 uzavřené týdny proti průměru celé historie tématu. */
  phase: Phase;
  recentPerWeek: number;
  avgPerWeek: number;
  lastAt: number | null;
}

/** Klíč týdne a jeho pondělí pro epoch ms. */
export function weekOf(ms: number): { key: string; start: number } {
  return { key: weekKey(isoWeek(new Date(ms))), start: isoWeekStart(new Date(ms)) };
}

/**
 * Fáze tématu z tempa: poslední 4 uzavřené týdny proti průměru od první změny.
 * Hranice jsou záměrně hrubé, aby se popisek neměnil s každou jednotlivou položkou.
 */
export function phaseOf(recentPerWeek: number, avgPerWeek: number, peakPerWeek: number, weeksSinceLast: number): Phase {
  if (weeksSinceLast > 12) return "dormant";
  if (recentPerWeek >= peakPerWeek && recentPerWeek > 0) return "peak";
  if (recentPerWeek >= avgPerWeek * 1.5) return "rising";
  if (recentPerWeek <= avgPerWeek * 0.5) return "quiet";
  return "steady";
}

/**
 * Historie tématu u jednoho nástroje. `totals` = počet všech změn nástroje po
 * týdnech (pondělí epoch ms → počet), pro podíl tématu. `now` určuje konec osy.
 */
export function buildToolHistory(tool: ToolKey, items: HistoryItem[], totals: Map<number, number>, now: Date): ToolHistory {
  const own = items.filter((i) => i.tool === tool).sort((a, b) => a.publishedAt - b.publishedAt);
  const name = TOOLS[tool].name;
  const currentWeek = isoWeekStart(now);
  if (!own.length) {
    return { tool, name, since: null, total: 0, majorCount: 0, weeks: [], milestones: [], phase: "dormant", recentPerWeek: 0, avgPerWeek: 0, lastAt: null };
  }
  const first = weekOf(own[0]!.publishedAt).start;
  const byWeek = new Map<number, HistoryWeek>();
  for (let s = first; s <= currentWeek; s += WEEK) {
    const key = weekKey(isoWeek(new Date(s)));
    byWeek.set(s, { key, start: s, added: 0, fixed: 0, major: 0, share: null, toolTotal: null });
  }
  for (const i of own) {
    const w = byWeek.get(weekOf(i.publishedAt).start);
    if (!w) continue;
    if (i.type === "Fixed") w.fixed++;
    else w.added++;
    if (i.significance === 3) w.major++;
  }
  const weeks = [...byWeek.values()];
  for (const w of weeks) {
    const t = totals.get(w.start);
    w.share = t ? (100 * (w.added + w.fixed)) / t : null;
    w.toolTotal = t ?? null;
  }
  // Tempo počítá jen uzavřené týdny (rozpracovaný týden by fázi podhodnotil).
  const closed = weeks.filter((w) => w.start < currentWeek);
  const recent = closed.slice(-4);
  const n = (w: HistoryWeek) => w.added + w.fixed;
  const recentPerWeek = recent.length ? recent.reduce((s, w) => s + n(w), 0) / recent.length : 0;
  const avgPerWeek = closed.length ? closed.reduce((s, w) => s + n(w), 0) / closed.length : 0;
  // Vrchol = nejlepší čtyřtýdenní průměr ze všech dřívějších oken, i těch, která
  // se s posledními čtyřmi týdny překrývají (jinak by špička těsně před nimi unikla).
  let peakPerWeek = 0;
  for (let i = 0; i + 4 <= closed.length - 1; i++) {
    peakPerWeek = Math.max(peakPerWeek, closed.slice(i, i + 4).reduce((s, w) => s + n(w), 0) / 4);
  }
  const lastAt = own[own.length - 1]!.publishedAt;
  const weeksSinceLast = Math.floor((currentWeek - weekOf(lastAt).start) / WEEK);

  const milestones: Milestone[] = own
    .filter((i) => i.significance === 3)
    .map((i) => ({ id: i.id, weekKey: weekOf(i.publishedAt).key, version: i.version, publishedAt: i.publishedAt, title: i.reason?.trim() || i.text, text: i.text }));

  return {
    tool, name, since: own[0]!.publishedAt, total: own.length, majorCount: milestones.length, weeks, milestones,
    phase: phaseOf(recentPerWeek, avgPerWeek, peakPerWeek, weeksSinceLast), recentPerWeek, avgPerWeek, lastAt,
  };
}

const semver = (v: string) => v.split(".").map((x) => parseInt(x, 10) || 0);
const cmpVersion = (a: string, b: string) => {
  const [x, y] = [semver(a), semver(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
};

/** Detail jednoho týdne; bez platného `key` vezme poslední týden se změnou. */
export function weekDetail(history: ToolHistory, items: HistoryItem[], key: string | null): WeekDetail | null {
  const active = history.weeks.filter((w) => w.added + w.fixed > 0);
  if (!active.length) return null;
  const idx = key ? active.findIndex((w) => w.key === key) : -1;
  const w = active[idx >= 0 ? idx : active.length - 1]!;
  const i = active.indexOf(w);
  const inWeek = items
    .filter((x) => x.tool === history.tool && weekOf(x.publishedAt).start === w.start)
    .sort((a, b) => cmpVersion(b.version, a.version) || b.significance - a.significance);
  return {
    key: w.key, start: w.start,
    versions: [...new Set(inWeek.map((x) => x.version))].sort(cmpVersion),
    major: inWeek.filter((x) => x.significance === 3),
    added: inWeek.filter((x) => x.significance !== 3 && x.type !== "Fixed"),
    fixed: inWeek.filter((x) => x.significance !== 3 && x.type === "Fixed"),
    prevKey: active[i - 1]?.key ?? null,
    nextKey: active[i + 1]?.key ?? null,
  };
}

export interface TopicHistory {
  topic: string;
  tools: ToolHistory[]; // první je Claude Code
  items: HistoryItem[];
  terms: Term[];
}

/** Načte položky tématu všech nástrojů a týdenní součty nástrojů z D1. */
export async function loadTopicHistory(db: Db, topic: string, now: Date): Promise<TopicHistory> {
  const rows = await db
    .select({
      id: ccChangeItem.id, tool: ccChangeItem.tool, version: ccChangeItem.version, publishedAt: ccChangeItem.publishedAt,
      type: ccChangeItem.type, text: ccChangeItem.text, significance: ccChangeItem.significance, reason: ccChangeItem.reason,
      followsId: ccChangeItem.followsId, relation: ccChangeItem.relation, followReason: ccChangeItem.followReason,
    })
    .from(ccChangeItem)
    .where(eq(ccChangeItem.topic, topic));
  const items: HistoryItem[] = rows.map((r) => ({ ...r, publishedAt: r.publishedAt.getTime(), significance: r.significance ?? 1 }));
  // Pondělí týdne v sekundách: den od epochy (čtvrtek) posunutý na pondělí.
  const wk = sql<number>`(${ccChangeItem.publishedAt} / 86400 - ((${ccChangeItem.publishedAt} / 86400 + 3) % 7)) * 86400`;
  const totalsRows = await db
    .select({ tool: ccChangeItem.tool, wk, n: sql<number>`count(*)` })
    .from(ccChangeItem)
    .where(and(sql`${ccChangeItem.tool} in (${sql.join(Object.keys(TOOLS).map((t) => sql`${t}`), sql`, `)})`))
    .groupBy(ccChangeItem.tool, wk);
  const tools = (Object.keys(TOOLS) as ToolKey[]).sort((a, b) => (a === CLAUDE_CODE ? -1 : b === CLAUDE_CODE ? 1 : 0));
  return {
    topic,
    items,
    terms: extractTerms(items),
    tools: tools.map((t) => {
      const totals = new Map(totalsRows.filter((r) => r.tool === t).map((r) => [Number(r.wk) * 1000, Number(r.n)]));
      return buildToolHistory(t, items, totals, now);
    }),
  };
}

// ─── Slovník tématu ────────────────────────────────────────────────

export type TermKind = "event" | "key" | "command" | "env" | "dotted";

export interface TermUse {
  count: number;
  first: number; // epoch ms první zmínky v changelogu
  version: string;
  itemId: string;
}

export interface Term {
  term: string;
  kind: TermKind;
  uses: Partial<Record<ToolKey, TermUse>>;
}

/**
 * Druh identifikátoru, nebo null pro běžné slovo. Bere jen tvary, které v textu
 * changelogu označují API: události (PreToolUse), klíče (onFailure), tečkové
 * názvy (tool.check), příkazy (/hooks) a proměnné prostředí (CLAUDE_ENV_FILE).
 */
/** Názvy produktů a jazyků, které mají tvar události, ale nejsou API tématu. */
const NOT_TERMS = new Set(["PowerShell", "JavaScript", "TypeScript", "GitHub", "GitLab", "JetBrains", "IntelliJ", "WebStorm", "PyCharm", "VSCode", "OpenTelemetry", "OAuth", "MacOS", "iTerm", "WezTerm", "OpenAI", "DeepSeek", "LiteLLM", "BigQuery", "PostgreSQL", "MySQL", "SQLite", "YouTube", "LinkedIn", "WordPress", "ClaudeCode", "GrokBuild", "NodeJS", "WebSocket", "WebSockets"]);

export function termKind(t: string): TermKind | null {
  if (t.length < 4 || t.length > 40 || NOT_TERMS.has(t)) return null;
  // Názvy souborů (settings.json, config.toml) nejsou API tématu.
  if (/\.(json|jsonc|toml|ya?ml|md|txt|js|ts|sh|py|lock)$/i.test(t)) return null;
  if (/^\/[a-z][a-z0-9-]+$/.test(t)) return "command";
  if (/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/.test(t)) return "env";
  if (/^[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]*)+$/.test(t)) return "event";
  if (/^[a-z][a-z0-9]*(?:[A-Z][a-z0-9]*)+$/.test(t)) return "key";
  if (/^[a-z][a-z0-9]*(?:\.[a-z][a-zA-Z0-9]*)+$/.test(t)) return "dotted";
  return null;
}

/** Identifikátory z textů změn: obsah `zpětných uvozovek` a slova v PascalCase. */
export function extractTerms(items: HistoryItem[]): Term[] {
  const terms = new Map<string, Term>();
  for (const i of [...items].sort((a, b) => a.publishedAt - b.publishedAt)) {
    const found = new Set<string>();
    for (const m of i.text.matchAll(/`([^`]{2,60})`/g)) found.add(m[1]!.trim().replace(/\(\)$/, "").replace(/^["']|["']$/g, ""));
    for (const m of i.text.matchAll(/\b[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]*)+\b/g)) found.add(m[0]);
    for (const t of found) {
      const kind = termKind(t);
      if (!kind) continue;
      const term = terms.get(t) ?? { term: t, kind, uses: {} };
      const tool = i.tool as ToolKey;
      const u = term.uses[tool];
      if (u) u.count++;
      else term.uses[tool] = { count: 1, first: i.publishedAt, version: i.version, itemId: i.id };
      terms.set(t, term);
    }
  }
  return [...terms.values()];
}

/** Změny, které daný pojem zmiňují (v `uvozovkách` i jako slovo), od nejstarší. */
export function termMentions(items: HistoryItem[], term: string): HistoryItem[] {
  const esc = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(^|[^A-Za-z0-9_])${esc}($|[^A-Za-z0-9_])`);
  return items.filter((i) => re.test(i.text)).sort((a, b) => a.publishedAt - b.publishedAt);
}

/** Nejčastěji uváděná stránka dokumentace v textech změn nástroje (např. code.claude.com/docs/en/hooks). */
export function docsLink(items: HistoryItem[], tool: string): string | null {
  const counts = new Map<string, number>();
  for (const i of items) {
    if (i.tool !== tool) continue;
    for (const m of i.text.matchAll(/https:\/\/(?:code\.claude\.com|docs\.anthropic\.com)\/docs\/[a-z-]+\/[a-z0-9/-]+/gi)) {
      const u = m[0].replace(/[).,]+$/, "");
      counts.set(u, (counts.get(u) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

export const topicHistoryKvKey = (topic: string, weekStart: number) => `cc-news:topic:v1:${topic}:${weekStart}`;

/** Historie tématu s hodinovou cache v KV (klíč nese týden, nový týden počítá znovu). */
export async function getTopicHistory(env: { KV: KVNamespace }, db: Db, topic: string, now: Date): Promise<TopicHistory> {
  const key = topicHistoryKvKey(topic, isoWeekStart(now));
  try {
    const hit = await env.KV.get<TopicHistory>(key, "json");
    if (hit) return hit;
  } catch (err) {
    console.error("[cc-news] čtení historie tématu z KV selhalo:", (err as Error)?.message);
  }
  const history = await loadTopicHistory(db, topic, now);
  try {
    await env.KV.put(key, JSON.stringify(history), { expirationTtl: 3600 });
  } catch (err) {
    console.error("[cc-news] zápis historie tématu do KV selhal:", (err as Error)?.message);
  }
  return history;
}
