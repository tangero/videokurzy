// Třídění položek changelogu do témat, hodnocení významu a hledání návazností
// (Novinky v CC, fáze 2). Prompty odpovídají lokálnímu experimentu
// (scripts/cc-news-changelog/run.mts, classify-v2 / follow-v2), aby nové položky
// byly zatříděné stejně jako historický backfill.

import { and, asc, desc, eq, gte, inArray, isNull, lt, ne, sql } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";
import { ccChangeItem } from "../../db/schema";
import type { ChangelogEntry } from "./changelog-source";
import { TOPICS, TOPIC_KEYS } from "./taxonomy";
import { classifyModel, isTransportError, llmJson, openRouterLlm, type LlmEnv, type LlmFn } from "./llm";

type Db = ReturnType<typeof drizzle>;
type Row = typeof ccChangeItem.$inferSelect;

export const CLASSIFY_PROMPT_VERSION = "classify-v2";
const BATCH = 50;
// D1: max 100 vázaných parametrů na dotaz → INSERT po 8 řádcích (12 sloupců).
const INSERT_CHUNK = 8;

// D1 batch = jeden subrequest pro mnoho příkazů (limit subrequestů workeru).
async function runBatched(db: Db, stmts: any[], size = 50): Promise<void> {
  for (let i = 0; i < stmts.length; i += size) {
    const chunk = stmts.slice(i, i + size);
    if (chunk.length > 0) await db.batch(chunk as [any, ...any[]]);
  }
}

const line = (i: Pick<Row, "id" | "type" | "scope" | "text">) =>
  `${i.id} | ${i.type}${i.scope ? ` [${i.scope}]` : ""} | ${i.text}`;

/** Vloží nové položky changelogu (už uložené beze změny přeskočí). Vrací počet nových. */
export async function syncChangelogEntries(db: Db, entries: ChangelogEntry[]): Promise<number> {
  if (entries.length === 0) return 0;
  const known = new Set<string>();
  const versions = [...new Set(entries.map((e) => e.version))];
  for (let i = 0; i < versions.length; i += 90) {
    const rows = await db
      .select({ id: ccChangeItem.id })
      .from(ccChangeItem)
      .where(inArray(ccChangeItem.version, versions.slice(i, i + 90)));
    for (const r of rows) known.add(r.id);
  }
  const fresh = entries.filter((e) => !known.has(e.id));
  // Řádky, které z changelogu zmizely (Anthropic upravil text → nové id), smazat,
  // jinak by v článku i na stránce témat byla stará i nová formulace téže změny.
  const current = new Set(entries.map((e) => e.id));
  const stale = [...known].filter((id) => !current.has(id));
  const deletes = [];
  for (let i = 0; i < stale.length; i += 90) {
    deletes.push(db.delete(ccChangeItem).where(inArray(ccChangeItem.id, stale.slice(i, i + 90))));
  }
  // Vazby na smazané řádky vynulovat, jinak stránka témat ukáže rozbitou návaznost.
  for (let i = 0; i < stale.length; i += 90) {
    deletes.push(db.update(ccChangeItem)
      .set({ followsId: null, relation: null, followReason: null })
      .where(inArray(ccChangeItem.followsId, stale.slice(i, i + 90))));
  }
  await runBatched(db, deletes);
  const inserts = [];
  for (let i = 0; i < fresh.length; i += INSERT_CHUNK) {
    inserts.push(db
      .insert(ccChangeItem)
      .values(fresh.slice(i, i + INSERT_CHUNK).map((e) => ({
        id: e.id, version: e.version, publishedAt: e.publishedAt, ord: e.ord,
        type: e.type, scope: e.scope, text: e.text,
      })))
      .onConflictDoNothing());
  }
  await runBatched(db, inserts);
  return fresh.length;
}

const CLASSIFY_SYSTEM = [
  "You classify Claude Code changelog entries. For EACH entry return one object:",
  `{"id": "<id>", "topic": "<topic key>", "significance": 1|2|3, "reason": "<max 12 words, Czech>"}`,
  "",
  "Topic = the ONE key that best matches what the entry is about. Use only these keys:",
  ...TOPICS.map((t) => `- ${t.key}: ${t.description}`),
  "",
  "Significance (for an advanced Claude Code user):",
  "3 = new user-visible capability (a new command, tool, mode, output style, panel, setting a user",
  "    would turn on), a new model, changed default behaviour, removal/breaking change",
  "2 = noticeable improvement, security hardening, or fix of a problem many users hit",
  "1 = niche/platform-specific fix, cosmetic change, wording, rare edge case",
  "",
  "Answer with a JSON array only, same order and count as the input.",
  "Never use the double-quote character inside reason; use „ “ if you must quote.",
].join("\n");

interface Classified { id: string; topic: string; significance: number; reason: string }

/** Dávka, která ani po opakování nevrátí platný JSON, se rozpůlí. */
async function classifyBatch(llm: LlmFn, batch: Row[]): Promise<Classified[]> {
  try {
    const out = await llmJson<Classified[] | Classified>(llm, CLASSIFY_SYSTEM, batch.map(line).join("\n"), 6000);
    return Array.isArray(out) ? out : [out];
  } catch (err) {
    // Síťová chyba ani timeout se dávkou nespraví, rozpůlení by jen násobilo čekání.
    if (batch.length <= 5 || isTransportError(err)) throw err;
    const half = Math.ceil(batch.length / 2);
    return [...(await classifyBatch(llm, batch.slice(0, half))), ...(await classifyBatch(llm, batch.slice(half)))];
  }
}

/**
 * Roztřídí až `limit` dosud nezatříděných položek (nejstarší verze první).
 * Vrací počet zatříděných. `llm` je injektovatelný pro testy.
 */
export async function classifyPending(
  db: Db, env: LlmEnv, now: Date, limit = 200, llm: LlmFn = openRouterLlm(env, classifyModel(env)),
  versions?: string[],
): Promise<number> {
  const pending = await db
    .select()
    .from(ccChangeItem)
    .where(versions ? and(isNull(ccChangeItem.classifiedAt), inArray(ccChangeItem.version, versions.slice(0, 90))) : isNull(ccChangeItem.classifiedAt))
    .orderBy(asc(ccChangeItem.publishedAt), asc(ccChangeItem.ord))
    .limit(limit);
  let done = 0;
  for (let i = 0; i < pending.length; i += BATCH) {
    const batch = pending.slice(i, i + BATCH);
    const ids = new Set(batch.map((b) => b.id));
    const results = await classifyBatch(llm, batch);
    const updates = [];
    for (const c of results) {
      if (!c?.id || !ids.has(c.id)) continue;
      updates.push(db
        .update(ccChangeItem)
        .set({
          topic: TOPIC_KEYS.has(c.topic) ? c.topic : "other",
          significance: [1, 2, 3].includes(c.significance) ? c.significance : 1,
          reason: String(c.reason ?? "").slice(0, 300),
          classifiedAt: now,
          promptVersion: CLASSIFY_PROMPT_VERSION,
        })
        .where(eq(ccChangeItem.id, c.id)));
      done++;
    }
    await runBatched(db, updates);
  }
  return done;
}

// ─── Návaznost ────────────────────────────────────────────────────

const FOLLOW_SYSTEM = [
  "You link Claude Code changelog entries to EARLIER entries of the same topic.",
  "You get HISTORY (earlier entries) and NEW entries. For each NEW entry decide whether it",
  "directly continues a specific earlier entry: extends the same feature, fixes/regresses it,",
  "changes its default, or adds a setting for it. Shared topic alone is NOT enough.",
  "The earlier entry may also be a NEW entry listed above it.",
  `Return a JSON array: {"id": "<new id>", "followsId": "<earlier id>" | null, "relation": "rozšiřuje"|"opravuje"|"mění"|"nastavení" | null, "reason": "<max 15 words, Czech>"}`,
  "Use null when there is no clear direct predecessor. Never invent ids.",
  "Never use the double-quote character inside reason; use „ “ if you must quote.",
].join("\n");

interface Follow { id: string; followsId: string | null; relation: string | null; reason: string }

const FOLLOW_BATCH = 25;

/** Návaznosti jedné dávky; nevalidní JSON rozpůlí (jako třídění), síťovou chybu vyhodí. */
async function followBatch(llm: LlmFn, history: Row[], batch: Row[]): Promise<Follow[]> {
  const user = `HISTORY:\n${history.map(line).join("\n") || "(none)"}\n\nNEW:\n${batch.map(line).join("\n")}`;
  try {
    const out = await llmJson<Follow[] | Follow>(llm, FOLLOW_SYSTEM, user, 6000);
    return Array.isArray(out) ? out : [out];
  } catch (err) {
    if (batch.length <= 5 || isTransportError(err)) throw err;
    const half = Math.ceil(batch.length / 2);
    return [...await followBatch(llm, history, batch.slice(0, half)), ...await followBatch(llm, [...history, ...batch.slice(0, half)].slice(-25), batch.slice(half))];
  }
}

/**
 * U významných (2–3) zatříděných položek v rozsahu verzí najde, na kterou
 * dřívější položku téhož tématu navazují. Historie = 25 posledních významných
 * položek tématu před rozsahem.
 */
export async function linkFollowsForVersions(
  db: Db, env: LlmEnv, versions: string[], llm: LlmFn = openRouterLlm(env, classifyModel(env)),
): Promise<number> {
  if (versions.length === 0) return 0;
  const fresh: Row[] = [];
  for (let i = 0; i < versions.length; i += 90) {
    fresh.push(...await db.select().from(ccChangeItem).where(and(
      inArray(ccChangeItem.version, versions.slice(i, i + 90)),
      gte(ccChangeItem.significance, 2),
      ne(ccChangeItem.topic, "other"),
    )));
  }
  fresh.sort((a, b) => +a.publishedAt - +b.publishedAt || a.ord - b.ord);
  const byTopic = new Map<string, Row[]>();
  for (const r of fresh) byTopic.set(r.topic!, [...(byTopic.get(r.topic!) ?? []), r]);

  let linked = 0;
  for (const [topic, list] of byTopic) {
    const history = (await db
      .select()
      .from(ccChangeItem)
      .where(and(eq(ccChangeItem.topic, topic), gte(ccChangeItem.significance, 2), lt(ccChangeItem.publishedAt, list[0]!.publishedAt)))
      .orderBy(desc(ccChangeItem.publishedAt), desc(ccChangeItem.ord))
      .limit(25)).reverse();
    if (history.length === 0 && list.length < 2) continue;
    const order = new Map([...history, ...list].map((r, n) => [r.id, n]));
    // Po dávkách: dlouhá odpověď nad celým tématem končí useknutým nebo nevalidním JSON.
    const out: Follow[] = [];
    for (let i = 0; i < list.length; i += FOLLOW_BATCH) {
      // Historie dávky = starší historie + předchozí nové položky (posledních 25).
      const hist = [...history, ...list.slice(0, i)].slice(-25);
      try {
        out.push(...await followBatch(llm, hist, list.slice(i, i + FOLLOW_BATCH)));
      } catch (err) {
        if (isTransportError(err)) throw err;
        console.error(`[cc-news] návaznost ${topic}: ${(err as Error).message}`);
      }
    }
    const updates = [];
    for (const f of out) {
      if (!f?.id || !f.followsId || !order.has(f.id) || !order.has(f.followsId)) continue;
      if (order.get(f.followsId)! >= order.get(f.id)!) continue;
      updates.push(db
        .update(ccChangeItem)
        .set({ followsId: f.followsId, relation: f.relation, followReason: String(f.reason ?? "").slice(0, 300) })
        .where(eq(ccChangeItem.id, f.id)));
      linked++;
    }
    await runBatched(db, updates);
  }
  return linked;
}

/**
 * Spodní hranice denní synchronizace: verze vydaná před `days` dny (nebo nejstarší
 * uložená). Okno zachytí verze, ke kterým dokumentace doplnila datum až později.
 */
export async function syncFloorVersion(db: Db, now: Date, days = 14): Promise<string | null> {
  const [r] = await db
    .select({ version: ccChangeItem.version })
    .from(ccChangeItem)
    .where(lt(ccChangeItem.publishedAt, new Date(now.getTime() - days * 86_400_000)))
    .orderBy(desc(ccChangeItem.publishedAt), desc(ccChangeItem.version))
    .limit(1);
  return r?.version ?? null;
}

/** Počet dosud nezatříděných položek (pro cron: má smysl řadit další dávku?). */
export async function countUnclassified(db: Db): Promise<number> {
  const [r] = await db.select({ n: sql<number>`count(*)` }).from(ccChangeItem).where(isNull(ccChangeItem.classifiedAt));
  return Number(r?.n ?? 0);
}
