// Kdo koho dohání (/novinky-cc/temata, /novinky-cc/dohanani): funkce Claude Code,
// které jiný sledovaný nástroj zavedl později. Kandidáti vznikají z pravidel nad
// slovníkem identifikátorů (extractTerms), každého ověří model a verdikt se uloží
// do cc_catchup. Stránky čtou jen ověřené páry; těžký výpočet běží ve frontě
// (cc-news.catchup) po dotřídění changelogu.

import { and, eq, inArray, isNotNull, ne, or, sql } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";
import { ccCatchup, ccChangeItem } from "../../db/schema";
import { TOPICS } from "./taxonomy";
import { extractTerms, type HistoryItem } from "./topic-history";
import { llmJson, openRouterLlm, writeModel, isTransportError, type LlmEnv, type LlmFn } from "./llm";
import { TREND_THRESHOLD_PP } from "./trends";
import type { ToolFocus } from "./topics-overview";
import { CLAUDE_CODE, TOOLS, toolName, type ToolKey } from "../tools/registry";

type Db = ReturnType<typeof drizzle>;
const DAY = 86_400_000;
const WEEK = 7 * DAY;
export const MONTH_DAYS = 30.44;

export const CATCHUP_PROMPT_VERSION = "catchup-v1";
/** Pojem u nástroje počítáme až 3 týdny po začátku sledování (dřív jde o stav při startu, ne o novinku). */
export const GRACE_MS = 21 * DAY;
/** „Dohání teď“: dohnaná funkce za posledních 8 týdnů. */
export const RECENT_CATCHUP_MS = 8 * WEEK;
/** Obecné příkazy, které má každý nástroj odjakživa. */
const GENERIC = new Set(["/help", "/config", "/settings", "/login", "/logout", "/model", "/usage", "/feedback", "/status", "/exit", "/clear", "/version", "/doctor", "/new", "/quit"]);
const VERIFY_BATCH = 12;
const INSERT_CHUNK = 5; // 17 sloupců × 5 < 100 vázaných parametrů D1

export interface CatchupCandidate {
  id: string; // `<nástroj>:<pojem>`
  tool: ToolKey;
  term: string;
  topic: string;
  ccItemId: string;
  ccAt: number;
  ccVersion: string;
  ccType: string;
  otherItemId: string;
  otherAt: number;
  otherVersion: string;
}

/** Témata, ve kterých Claude Code od začátku sledování nástroje přidal pojmy, které nástroj nemá. */
export interface LeadTopic { key: string; label: string; n: number }
export interface ToolLead { since: number; topics: LeadTopic[] }

/**
 * Kandidáti na dohánění a náskok Claude Code. Kandidát = pojem, který Claude Code
 * zmínil dřív a nástroj ho poprvé zmíní u položky Added aspoň GRACE_MS po začátku
 * sledování. Stejný pojem ve více tématech se počítá jednou (nejdřívější zmínka CC).
 */
export type TopicItem = HistoryItem & { topic: string | null };

export function findCandidates(items: TopicItem[]): { candidates: CatchupCandidate[]; lead: Partial<Record<ToolKey, ToolLead>> } {
  const byId = new Map(items.map((i) => [i.id, i]));
  const label = new Map(TOPICS.map((t) => [t.key, t.label]));
  const byTopic = new Map<string, TopicItem[]>();
  for (const i of items) {
    if (!i.topic || i.topic === "other") continue;
    const list = byTopic.get(i.topic);
    if (list) list.push(i);
    else byTopic.set(i.topic, [i]);
  }
  const best = new Map<string, CatchupCandidate>();
  const lead: Partial<Record<ToolKey, ToolLead>> = {};
  for (const tool of (Object.keys(TOOLS) as ToolKey[]).filter((t) => t !== CLAUDE_CODE)) {
    const own = items.filter((i) => i.tool === tool);
    if (!own.length) continue;
    const since = Math.min(...own.map((i) => i.publishedAt));
    const leadCounts = new Map<string, number>();
    for (const [topic, its] of byTopic) {
      const pair = its.filter((i) => i.tool === CLAUDE_CODE || i.tool === tool);
      for (const term of extractTerms(pair)) {
        if (GENERIC.has(term.term)) continue;
        const a = term.uses[CLAUDE_CODE];
        const b = term.uses[tool];
        if (a && b) {
          if (b.first <= a.first || b.first < since + GRACE_MS || byId.get(b.itemId)?.type !== "Added") continue;
          const id = `${tool}:${term.term}`;
          const prev = best.get(id);
          if (prev && prev.ccAt <= a.first) continue;
          best.set(id, {
            id, tool, term: term.term, topic,
            ccItemId: a.itemId, ccAt: a.first, ccVersion: a.version, ccType: byId.get(a.itemId)?.type ?? "",
            otherItemId: b.itemId, otherAt: b.first, otherVersion: b.version,
          });
        } else if (a && !b && a.first >= since && byId.get(a.itemId)?.type === "Added") {
          leadCounts.set(topic, (leadCounts.get(topic) ?? 0) + 1);
        }
      }
    }
    lead[tool] = {
      since,
      topics: [...leadCounts].sort((x, y) => y[1] - x[1]).slice(0, 3).map(([key, n]) => ({ key, label: label.get(key) ?? key, n })),
    };
  }
  return { candidates: [...best.values()].sort((x, y) => x.otherAt - y.otherAt), lead };
}

// ─── Ověření modelem ──────────────────────────────────────────────

const VERIFY_SYSTEM = [
  "You compare changelog entries of AI coding CLI tools.",
  "Each CANDIDATE names a TERM (command, hook event, setting) that Claude Code had earlier,",
  "the Claude Code entry where it first appeared, and the OTHER tool's entry where the term first appears.",
  "Decide whether the OTHER entry INTRODUCES that feature to the other tool (adds the command/event/setting",
  "for the first time, with essentially the same purpose as in Claude Code).",
  "Answer no when the entry only changes, fixes, restricts, disables or extends a feature that evidently",
  "already existed, or mentions the term only in passing, or the term means something different there.",
  'Return a JSON array: {"id": "<candidate id>", "verdict": "yes"|"no", "title": "<what the feature does, Czech, max 8 words, lowercase start>", "reason": "<why, Czech, max 15 words>"}',
  "One object per candidate. Never invent ids.",
  "Never use the double-quote character inside title or reason; use „ “ if you must quote.",
].join("\n");

interface Verdict { id: string; verdict: string; title?: string; reason?: string }

type CandidateRow = typeof ccCatchup.$inferSelect;

const candidateText = (c: CandidateRow, texts: Map<string, string>) =>
  [
    `CANDIDATE ${c.id}`,
    `TERM: ${c.term}`,
    `CLAUDE CODE (${new Date(c.ccAt).toISOString().slice(0, 10)}, v${c.ccVersion}): ${texts.get(c.ccItemId) ?? "?"}`,
    `${toolName(c.tool).toUpperCase()} (${new Date(c.otherAt).toISOString().slice(0, 10)}, v${c.otherVersion}): ${texts.get(c.otherItemId) ?? "?"}`,
  ].join("\n");

async function verifyBatch(llm: LlmFn, batch: CandidateRow[], texts: Map<string, string>): Promise<Verdict[]> {
  try {
    const out = await llmJson<Verdict[] | Verdict | Record<string, unknown>>(llm, VERIFY_SYSTEM, batch.map((c) => candidateText(c, texts)).join("\n\n"), 4000);
    if (Array.isArray(out)) return out;
    if (out && typeof out === "object" && "id" in out) return [out as Verdict];
    return (Object.values(out ?? {}).find(Array.isArray) as Verdict[] | undefined) ?? [];
  } catch (err) {
    if (batch.length <= 2 || isTransportError(err)) throw err;
    const half = Math.ceil(batch.length / 2);
    return [...await verifyBatch(llm, batch.slice(0, half), texts), ...await verifyBatch(llm, batch.slice(half), texts)];
  }
}

/**
 * Ověří čekající kandidáty (i ty s verdiktem starší verze promptu). Kandidát,
 * kterého model vynechal, zůstane čekat na příští běh. Vrací počet ověřených.
 */
export async function verifyPending(db: Db, env: LlmEnv, now: Date, limit = 60, llm: LlmFn = openRouterLlm(env, writeModel(env))): Promise<number> {
  const pending = await db
    .select()
    .from(ccCatchup)
    .where(or(eq(ccCatchup.verdict, "pending"), ne(ccCatchup.promptVersion, CATCHUP_PROMPT_VERSION)))
    .limit(limit);
  if (!pending.length) return 0;
  const ids = [...new Set(pending.flatMap((c) => [c.ccItemId, c.otherItemId]))];
  const texts = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 90) {
    const rows = await db.select({ id: ccChangeItem.id, text: ccChangeItem.text }).from(ccChangeItem).where(inArray(ccChangeItem.id, ids.slice(i, i + 90)));
    for (const r of rows) texts.set(r.id, r.text);
  }
  let done = 0;
  for (let i = 0; i < pending.length; i += VERIFY_BATCH) {
    const batch = pending.slice(i, i + VERIFY_BATCH);
    const known = new Set(batch.map((c) => c.id));
    const seen = new Set<string>();
    const updates = [];
    for (const v of await verifyBatch(llm, batch, texts)) {
      if (!v?.id || !known.has(v.id) || seen.has(v.id) || (v.verdict !== "yes" && v.verdict !== "no")) continue;
      seen.add(v.id);
      updates.push(db.update(ccCatchup).set({
        verdict: v.verdict,
        title: String(v.title ?? "").slice(0, 120) || null,
        reason: String(v.reason ?? "").slice(0, 300) || null,
        checkedAt: now,
        promptVersion: CATCHUP_PROMPT_VERSION,
      }).where(eq(ccCatchup.id, v.id)));
    }
    if (updates.length) await db.batch(updates as [any, ...any[]]);
    if (seen.size < batch.length) console.warn(`[cc-news] dohánění: model ověřil ${seen.size}/${batch.length} kandidátů`);
    done += seen.size;
  }
  return done;
}

// ─── Běh ve frontě ────────────────────────────────────────────────

export const catchupLeadKvKey = "cc-news:catchup:lead:v1";
export const catchupKvKey = (weekStart: number) => `cc-news:catchup:v1:${weekStart}`;

/** Načte zatříděné položky všech nástrojů (s textem) pro pravidla. */
async function loadItems(db: Db): Promise<TopicItem[]> {
  const rows = await db
    .select({ id: ccChangeItem.id, tool: ccChangeItem.tool, version: ccChangeItem.version, publishedAt: ccChangeItem.publishedAt, type: ccChangeItem.type, text: ccChangeItem.text, topic: ccChangeItem.topic })
    .from(ccChangeItem)
    .where(and(isNotNull(ccChangeItem.topic), ne(ccChangeItem.topic, "other")));
  return rows.map((r) => ({ ...r, topic: r.topic!, publishedAt: r.publishedAt.getTime(), significance: 1, reason: null, followsId: null, relation: null, followReason: null }));
}

/** Uloží nové kandidáty (existující nechá být) a náskok CC do KV. Vrací počet nových. */
export async function syncCandidates(db: Db, kv: KVNamespace, now: Date): Promise<number> {
  const { candidates, lead } = findCandidates(await loadItems(db));
  await kv.put(catchupLeadKvKey, JSON.stringify(lead));
  const known = new Set((await db.select({ id: ccCatchup.id }).from(ccCatchup)).map((r) => r.id));
  const fresh = candidates.filter((c) => !known.has(c.id));
  for (let i = 0; i < fresh.length; i += INSERT_CHUNK) {
    await db.insert(ccCatchup).values(fresh.slice(i, i + INSERT_CHUNK).map((c) => ({
      ...c, ccAt: new Date(c.ccAt), otherAt: new Date(c.otherAt), createdAt: now,
    }))).onConflictDoNothing();
  }
  return fresh.length;
}

// ─── Souhrn pro stránky ───────────────────────────────────────────

export interface CatchupPair {
  tool: ToolKey;
  term: string;
  topic: string;
  topicLabel: string;
  title: string | null;
  ccAt: number;
  ccVersion: string;
  /** První zmínka u CC nebyla Added: funkce existovala nejpozději od ccAt. */
  ccExact: boolean;
  otherAt: number;
  otherVersion: string;
  lagDays: number;
}

export interface ToolCatchup {
  tool: ToolKey;
  name: string;
  since: number | null;
  pairs: CatchupPair[];
  medianLagDays: number | null;
  /** Témata, kde nástroj dohání teď (nedávno dohnaná funkce a rostoucí podíl). */
  now: { key: string; label: string }[];
  lead: LeadTopic[];
}

export interface Catchup {
  to: number;
  tools: ToolCatchup[];
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/** Ověřené páry seskupené po nástrojích; `focus` nese změnu podílu témat u nástrojů. */
export function buildCatchup(rows: CandidateRow[], lead: Partial<Record<ToolKey, ToolLead>>, focus: ToolFocus[], to: number): Catchup {
  const label = new Map(TOPICS.map((t) => [t.key, t.label]));
  const deltas = new Map(focus.map((f) => [f.tool, f.deltas]));
  const tools = (Object.keys(TOOLS) as ToolKey[]).filter((t) => t !== CLAUDE_CODE).map((tool) => {
    const pairs: CatchupPair[] = rows
      .filter((r) => r.tool === tool && r.verdict === "yes")
      .map((r) => ({
        tool, term: r.term, topic: r.topic, topicLabel: label.get(r.topic) ?? r.topic, title: r.title,
        ccAt: r.ccAt.getTime(), ccVersion: r.ccVersion, ccExact: r.ccType === "Added",
        otherAt: r.otherAt.getTime(), otherVersion: r.otherVersion,
        lagDays: Math.round((r.otherAt.getTime() - r.ccAt.getTime()) / DAY),
      }))
      .sort((a, b) => b.otherAt - a.otherAt);
    const d = deltas.get(tool) ?? {};
    const nowKeys = [...new Set(pairs.filter((p) => p.otherAt >= to - RECENT_CATCHUP_MS && p.otherAt < to && (d[p.topic] ?? 0) >= TREND_THRESHOLD_PP).map((p) => p.topic))];
    return {
      tool, name: TOOLS[tool].name, since: lead[tool]?.since ?? null, pairs,
      medianLagDays: median(pairs.map((p) => p.lagDays)),
      now: nowKeys.sort((a, b) => (d[b] ?? 0) - (d[a] ?? 0)).map((key) => ({ key, label: label.get(key) ?? key })),
      lead: lead[tool]?.topics ?? [],
    };
  });
  return { to, tools };
}

/** Souhrn s hodinovou cache v KV. `focus` a `to` z přehledu témat (stejná okna). */
export async function getCatchup(env: { KV: KVNamespace }, db: Db, focus: ToolFocus[], to: number): Promise<Catchup> {
  const key = catchupKvKey(to);
  try {
    const hit = await env.KV.get<Catchup>(key, "json");
    if (hit) return hit;
  } catch (err) {
    console.error("[cc-news] čtení dohánění z KV selhalo:", (err as Error)?.message);
  }
  const rows = await db.select().from(ccCatchup).where(eq(ccCatchup.verdict, "yes"));
  const lead = (await env.KV.get<Partial<Record<ToolKey, ToolLead>>>(catchupLeadKvKey, "json").catch(() => null)) ?? {};
  const out = buildCatchup(rows, lead, focus, to);
  try {
    await env.KV.put(key, JSON.stringify(out), { expirationTtl: 3600 });
  } catch (err) {
    console.error("[cc-news] zápis dohánění do KV selhal:", (err as Error)?.message);
  }
  return out;
}

/** Počet ověřených i čekajících kandidátů (pro admin a logy). */
export async function catchupCounts(db: Db): Promise<Record<string, number>> {
  const rows = await db.select({ verdict: ccCatchup.verdict, n: sql<number>`count(*)` }).from(ccCatchup).groupBy(ccCatchup.verdict);
  return Object.fromEntries(rows.map((r) => [r.verdict, Number(r.n)]));
}
