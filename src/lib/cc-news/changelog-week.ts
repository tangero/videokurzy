// Založení týdenního vydání „Novinky v Claude Code" ze changelogu (fáze 2) a
// denní údržba zdroje: synchronizace changelogu, snímek dokumentace, zmrazení
// týdne. Samotný článek staví až konzument fronty (weekly.ts) — tady se jen
// zakládá řádek cc_news_item ve stavu draft.

import { and, eq, gte, lte } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";
import { nanoid } from "nanoid";
import { ccChangeItem, ccNewsItem } from "../../db/schema";
import {
  changelogSourceId, compareVersions, isoWeekBounds, ORPHAN_DAYS, parseVersionRange, weekFromSourceId, weekKey, weekVersionRange,
} from "./changelog-source";
import { sha256Hex } from "./detect";

type Db = ReturnType<typeof drizzle>;
type Week = { year: number; week: number };

export const officialSourceId = (w: Week) => `/docs/en/whats-new/${weekKey(w)}`;

export type CreateWeekOutcome =
  | { kind: "created"; itemId: string; sourceId: string; versionRange: string }
  | { kind: "exists"; itemId: string; sourceId: string }
  | { kind: "official"; sourceId: string }
  | { kind: "empty"; sourceId: string };

/**
 * Nejvyšší verze, kterou pokrývá nějaké vydání (oficiální i ze changelogu)
 * za týden PŘED cílovým týdnem. Novější vydání se ignorují — jinak by po
 * pondělním založení posledního týdne už nešly založit zpětné týdny.
 */
export async function lastCoveredVersion(db: Db, before?: Week): Promise<string | null> {
  const rows = await db.select({ sourceId: ccNewsItem.sourceId, versionRange: ccNewsItem.versionRange }).from(ccNewsItem);
  let max: string | null = null;
  for (const r of rows) {
    const w = weekFromSourceId(r.sourceId);
    if (before && w && w.year * 100 + w.week >= before.year * 100 + before.week) continue;
    const to = parseVersionRange(r.versionRange)?.to;
    if (to && (!max || compareVersions(to, max) > 0)) max = to;
  }
  return max;
}

/**
 * Založí vydání pro ISO týden `week` (idempotentně). Nezakládá, pokud:
 * - vydání pro tento týden už existuje (ze changelogu),
 * - existuje oficiální přehled Anthropicu za stejný týden (měl by stejný slug),
 * - v týdnu nevyšla žádná nová verze.
 */
export async function createChangelogWeekItem(db: Db, week: Week, now: Date): Promise<CreateWeekOutcome> {
  const sourceId = changelogSourceId(week);
  const [existing] = await db.select({ id: ccNewsItem.id }).from(ccNewsItem).where(eq(ccNewsItem.sourceId, sourceId)).limit(1);
  if (existing) return { kind: "exists", itemId: existing.id, sourceId };
  const [official] = await db.select({ id: ccNewsItem.id }).from(ccNewsItem).where(eq(ccNewsItem.sourceId, officialSourceId(week))).limit(1);
  if (official) return { kind: "official", sourceId };

  const { start, end } = isoWeekBounds(week.year, week.week);
  const entries = await db
    .selectDistinct({ version: ccChangeItem.version, publishedAt: ccChangeItem.publishedAt })
    .from(ccChangeItem)
    .where(and(gte(ccChangeItem.publishedAt, new Date(start.getTime() - ORPHAN_DAYS * 86_400_000)), lte(ccChangeItem.publishedAt, end)));
  // Verze, které už pokrývá jiné (i novější) vydání, se nepřiberou — jinak by
  // zpětně založený týden zopakoval sobotní verze z vydání následujícího týdne.
  const covered = (await db.select({ sourceId: ccNewsItem.sourceId, versionRange: ccNewsItem.versionRange }).from(ccNewsItem))
    .map((r) => parseVersionRange(r.versionRange))
    .filter((r): r is { from: string; to: string } => !!r);
  const free = entries.filter((e) => !covered.some((r) => compareVersions(e.version, r.from) >= 0 && compareVersions(e.version, r.to) <= 0));
  const range = weekVersionRange(free, await lastCoveredVersion(db, week), start, end);
  if (!range) return { kind: "empty", sourceId };

  const versionRange = `v${range.from}–v${range.to}`;
  const id = nanoid();
  const inserted = await db
    .insert(ccNewsItem)
    .values({
      id,
      sourceId,
      contentHash: await sha256Hex(`changelog:${range.versions.join(",")}`),
      weekLabel: `Week ${week.week}`,
      versionRange,
      status: "draft",
      createdAt: now,
    })
    .onConflictDoNothing({ target: ccNewsItem.sourceId })
    .returning({ id: ccNewsItem.id });
  if (inserted.length === 0) {
    const [raced] = await db.select({ id: ccNewsItem.id }).from(ccNewsItem).where(eq(ccNewsItem.sourceId, sourceId)).limit(1);
    return { kind: "exists", itemId: raced?.id ?? id, sourceId };
  }
  return { kind: "created", itemId: id, sourceId, versionRange };
}
