// Kam se vývoj Claude Code teď soustředí: podíl témat na položkách changelogu
// za poslední 4 celé týdny proti předchozím 13 (čtvrtletí). Stránka /novinky-cc.
//
// Podíl, ne počet: tempo vydávání kolísá (podzim 2026 zhruba 2,6× víc položek
// týdně než v létě), takže absolutní počty by ukazovaly růst všude. Opravy
// (type Fixed) tvoří kolem dvou třetin položek, proto se drží zvlášť od nových
// funkcí a změn, jinak by vyhrálo téma s nejvíc chybami.

import { and, eq, gte, isNotNull, lt, sql } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";
import { ccChangeItem } from "../../db/schema";
import { TOPICS } from "./taxonomy";

type Db = ReturnType<typeof drizzle>;

const DAY = 86_400_000;
export const RECENT_WEEKS = 4;
export const PREVIOUS_WEEKS = 13;
/** Změna podílu (procentní body), od které se téma bere jako rostoucí/klesající. */
export const TREND_THRESHOLD_PP = 1.5;
/** Nejvýš tolik rostoucích témat v horní části stránky. */
const RISING_LIMIT = 3;

export interface TopicTrend {
  key: string;
  label: string;
  /** Podíl na všech zatříděných položkách okna, v procentech. */
  share: number;
  prevShare: number;
  /** share − prevShare v procentních bodech. */
  delta: number;
  direction: "up" | "down" | "flat";
  /** Položky za poslední 4 týdny: nové funkce a změny / opravy. */
  added: number;
  fixed: number;
  /** Zásadní změny (significance 3) za poslední 4 týdny. */
  major: number;
  /** Zdůvodnění nejnovější zásadní změny tématu (česky, z třídění), může chybět. */
  highlight: string | null;
}

export interface TopicTrends {
  /** Začátek a konec (výlučně) posledních 4 týdnů, epoch ms. */
  from: number;
  to: number;
  total: number;
  prevTotal: number;
  topics: TopicTrend[];
  rising: TopicTrend[];
}

/** Pondělí 00:00 UTC ISO týdne, do kterého spadá `now`. */
export function isoWeekStart(now: Date): number {
  const d = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const dow = (new Date(d).getUTCDay() + 6) % 7; // pondělí = 0
  return d - dow * DAY;
}

/**
 * Okna jsou zarovnaná na celé ISO týdny a rozpracovaný týden vynechávají:
 * čísla se během týdne nemění a sedí s rytmem týdenních článků.
 * Nezatříděné položky (topic NULL) se nepočítají ani do jmenovatele.
 */
export async function computeTopicTrends(db: Db, now: Date): Promise<TopicTrends> {
  const to = isoWeekStart(now);
  const from = to - RECENT_WEEKS * 7 * DAY;
  const prevFrom = from - PREVIOUS_WEEKS * 7 * DAY;
  const [fromS, prevFromS] = [from / 1000, prevFrom / 1000];
  const recent = sql`${ccChangeItem.publishedAt} >= ${fromS}`;
  const where = and(
    eq(ccChangeItem.tool, "claude-code"),
    isNotNull(ccChangeItem.topic),
    gte(ccChangeItem.publishedAt, new Date(prevFrom)),
    lt(ccChangeItem.publishedAt, new Date(to)),
  );

  const rows = await db
    .select({
      topic: ccChangeItem.topic,
      fixed: sql<number>`sum(case when ${recent} and ${ccChangeItem.type} = 'Fixed' then 1 else 0 end)`,
      added: sql<number>`sum(case when ${recent} and ${ccChangeItem.type} != 'Fixed' then 1 else 0 end)`,
      major: sql<number>`sum(case when ${recent} and ${ccChangeItem.significance} = 3 then 1 else 0 end)`,
      prev: sql<number>`sum(case when ${ccChangeItem.publishedAt} < ${fromS} and ${ccChangeItem.publishedAt} >= ${prevFromS} then 1 else 0 end)`,
    })
    .from(ccChangeItem)
    .where(where)
    .groupBy(ccChangeItem.topic);

  // Nejnovější zásadní změna každého tématu v okně (SQLite vrátí u max() řádek s maximem).
  const highlights = await db
    .select({ topic: ccChangeItem.topic, reason: ccChangeItem.reason, at: sql<number>`max(${ccChangeItem.publishedAt})` })
    .from(ccChangeItem)
    .where(and(where, recent, eq(ccChangeItem.significance, 3), isNotNull(ccChangeItem.reason)))
    .groupBy(ccChangeItem.topic);
  const reasonOf = new Map(highlights.map((h) => [h.topic, h.reason]));

  const byTopic = new Map(rows.map((r) => [r.topic, r]));
  const n = (x: unknown) => Number(x ?? 0);
  const total = rows.reduce((s, r) => s + n(r.added) + n(r.fixed), 0);
  const prevTotal = rows.reduce((s, r) => s + n(r.prev), 0);
  const pct = (x: number, of: number) => (of > 0 ? (100 * x) / of : 0);

  const topics: TopicTrend[] = TOPICS.filter((t) => t.key !== "other").map((t) => {
    const r = byTopic.get(t.key);
    const added = n(r?.added);
    const fixed = n(r?.fixed);
    const share = pct(added + fixed, total);
    const prevShare = pct(n(r?.prev), prevTotal);
    const delta = share - prevShare;
    return {
      key: t.key, label: t.label, share, prevShare, delta,
      // Bez srovnávacího období se trend neurčuje.
      direction: prevTotal === 0 ? "flat" : delta >= TREND_THRESHOLD_PP ? "up" : delta <= -TREND_THRESHOLD_PP ? "down" : "flat",
      added, fixed, major: n(r?.major),
      highlight: reasonOf.get(t.key)?.trim() || null,
    };
  });
  topics.sort((a, b) => b.share - a.share);

  const rising = topics
    .filter((t) => t.direction === "up")
    .sort((a, b) => b.delta - a.delta)
    .slice(0, RISING_LIMIT);

  return { from, to, total, prevTotal, topics, rising };
}

export const trendsKvKey = (weekStart: number) => `cc-news:trends:v1:${weekStart}`;

/**
 * Trendy s hodinovou cache v KV. Klíč nese začátek týdne, takže nový týden
 * počítá znovu; hodina stačí, aby se projevilo dodatečné zatřídění položek.
 */
export async function getTopicTrends(env: { KV: KVNamespace }, db: Db, now: Date): Promise<TopicTrends> {
  const key = trendsKvKey(isoWeekStart(now));
  try {
    const hit = await env.KV.get<TopicTrends>(key, "json");
    if (hit) return hit;
  } catch (err) {
    console.error("[cc-news] čtení trendů z KV selhalo:", (err as Error)?.message);
  }
  const trends = await computeTopicTrends(db, now);
  try {
    await env.KV.put(key, JSON.stringify(trends), { expirationTtl: 3600 });
  } catch (err) {
    console.error("[cc-news] zápis trendů do KV selhal:", (err as Error)?.message);
  }
  return trends;
}
