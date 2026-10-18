// Interní týdenní přehled dalšího sledovaného nástroje (zatím Grok Build).
// Stejný výběr a kontrola faktů jako u Novinek v CC (selectAndVerify), ale nic
// se nepíše ani nepublikuje: výsledek se uloží do KV a ukáže v adminu.

import { and, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";
import { ccChangeItem } from "../../db/schema";
import { compareVersions, isoWeek, isoWeekBounds, weekKey } from "../cc-news/changelog-source";
import { assertWeekClassified, classifyPending, linkFollowsForVersions } from "../cc-news/classify";
import { diffDocsWeeks, docsIndexKey, docsWeekKey, type DocsIndex, type DocsSource } from "../cc-news/docs-snapshot";
import { classifyModel, openRouterLlm, writeModel, type LlmEnv } from "../cc-news/llm";
import { selectAndVerify, type WeeklyLlms } from "../cc-news/weekly";
import { GROK_BUILD_DOCS } from "./grok-build";
import type { ToolKey } from "./registry";

type Db = ReturnType<typeof drizzle>;
type Week = { year: number; week: number };

export const TOOL_DOCS: Partial<Record<ToolKey, DocsSource>> = { "grok-build": GROK_BUILD_DOCS };

export const toolWeekKvKey = (tool: ToolKey, w: Week) => `tools:week:${tool}:${weekKey(w)}`;

export interface ToolWeek {
  tool: ToolKey;
  week: Week;
  builtAt: string;
  versions: string[];
  /** Invariant „žádný zdroj se neztratil“: sebrané položky = zatříděné + nezatříděné. */
  counts: { collected: number; classified: number; unclassified: number; docsChanges: number };
  docsFrozen: boolean;
  features: { title: string; lede: string; docLink: string | null; sources: string[] }[];
  minorWins: { text: string; sources: string[] }[];
  skipped: { id: string; reason: string }[];
  fixed: { title: string; problem: string }[];
  dropped: { title: string; problem: string }[];
}

/** Témata posledních uložených týdnů nástroje (výběr je nemá opakovat). */
async function previousTitles(kv: KVNamespace, tool: ToolKey, week: Week): Promise<string[]> {
  const out: string[] = [];
  let w = week;
  for (let i = 0; i < 2; i++) {
    w = isoWeek(new Date(isoWeekBounds(w.year, w.week).start.getTime() - 86_400_000));
    const prev = await kv.get<ToolWeek>(toolWeekKvKey(tool, w), "json");
    if (prev) out.push(...prev.features.map((f) => f.title));
  }
  return out;
}

export async function buildToolWeek(
  db: Db, env: LlmEnv & { KV: KVNamespace }, tool: ToolKey, week: Week, now: Date,
  llms: WeeklyLlms = { classify: openRouterLlm(env, classifyModel(env)), write: openRouterLlm(env, writeModel(env)) },
): Promise<ToolWeek> {
  const { start, end } = isoWeekBounds(week.year, week.week);
  const inWeek = and(eq(ccChangeItem.tool, tool), gte(ccChangeItem.publishedAt, start), lte(ccChangeItem.publishedAt, end));
  const versions = [...new Set((await db.selectDistinct({ v: ccChangeItem.version }).from(ccChangeItem).where(inWeek)).map((r) => r.v))]
    .sort(compareVersions);

  if (versions.length > 0) {
    const pending = await db.select({ id: ccChangeItem.id }).from(ccChangeItem)
      .where(and(inWeek, isNull(ccChangeItem.classifiedAt))).limit(1);
    if (pending.length > 0) await classifyPending(db, env, now, 1000, llms.classify, { tool, versions });
    await assertWeekClassified(db, tool, versions);
    await linkFollowsForVersions(db, env, versions, llms.classify, tool);
  }
  const rows = (versions.length
    ? await db.select().from(ccChangeItem).where(and(eq(ccChangeItem.tool, tool), inArray(ccChangeItem.version, versions.slice(0, 90))))
    : []).sort((a, b) => compareVersions(a.version, b.version) || a.ord - b.ord);

  // Dokumentace: zmrazený konec minulého a tohoto týdne.
  const src = TOOL_DOCS[tool];
  let docs: Awaited<ReturnType<typeof diffDocsWeeks>>["changes"] = [];
  let signals: Awaited<ReturnType<typeof diffDocsWeeks>>["signals"] = [];
  let knownPages: string[] = [];
  let docsFrozen = false;
  if (src) {
    const prevWeek = isoWeek(new Date(start.getTime() - 86_400_000));
    const [after, before, current] = await Promise.all([
      env.KV.get<DocsIndex>(docsWeekKey(week, src), "json"),
      env.KV.get<DocsIndex>(docsWeekKey(prevWeek, src), "json"),
      env.KV.get<DocsIndex>(docsIndexKey(src), "json"),
    ]);
    docsFrozen = !!(after && before);
    if (after && before) ({ changes: docs, signals } = await diffDocsWeeks(env.KV, before, after, llms.classify, llms.write, src));
    knownPages = Object.keys((after ?? current)?.pages ?? {});
  }
  const docLinks = src ? knownPages.map((p) => `${src.prefix}${p}`) : [];

  const empty = rows.length === 0 && docs.length === 0;
  const result = empty
    ? null
    : await selectAndVerify({ tool, rows, docs, signals, previous: await previousTitles(env.KV, tool, week), docLinks, llms });

  const out: ToolWeek = {
    tool,
    week,
    builtAt: now.toISOString(),
    versions,
    counts: {
      collected: rows.length,
      classified: rows.filter((r) => r.classifiedAt).length,
      unclassified: rows.filter((r) => !r.classifiedAt).length,
      docsChanges: docs.length,
    },
    docsFrozen,
    features: (result?.kept ?? []).map((f) => ({ title: f.title, lede: f.lede, docLink: f.docLink, sources: f.sourceIds.map(result!.lineOf) })),
    minorWins: (result?.selection.minorWins ?? []).map((w) => ({ text: w.text, sources: w.sourceIds.map(result!.lineOf) })),
    skipped: result?.selection.skipped ?? [],
    fixed: result?.fixed ?? [],
    dropped: result?.dropped ?? [],
  };
  await env.KV.put(toolWeekKvKey(tool, week), JSON.stringify(out));
  return out;
}
