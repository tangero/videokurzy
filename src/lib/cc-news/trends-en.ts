// Anglický snímek trendů pro vibecoding.cz/en/trends/: přehled témat vývoje
// Claude Code a dohánění mezi nástroji v jednom JSON souboru. Jednou týdně (po
// přepočtu dohánění) jde do repa webu jako PR, při automatickém vydávání se sám
// sloučí. Stejný obsah se znovu neposílá. Kontrakt souboru: docs/english-section.md webu.

import { eq } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";
import { ccCatchup } from "../../db/schema";
import { isoWeek } from "./changelog-source";
import { buildCatchup, catchupLeadKvKey, type Catchup, type ToolLead } from "./catchup";
import { DEFAULT_REPO, openSitePullRequest, readSiteFile, type EnglishEnv, type GhFetch, type SitePr } from "./english";
import { TOPIC_EN } from "./taxonomy";
import { computeTopicsOverview, type TopicsOverview } from "./topics-overview";
import type { ToolKey } from "../tools/registry";

type Db = ReturnType<typeof drizzle>;
const DAY = 86_400_000;

export const TRENDS_PATH = "src/data/dev-trends.json";
export const TRENDS_VERSION = 1;

const r1 = (x: number) => Math.round(x * 10) / 10;
const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const enLabel = (key: string) => TOPIC_EN[key]?.label ?? key;

export interface TrendsSnapshot {
  version: number;
  /** Poslední uzavřený ISO týden okna, např. „2026-W42“. */
  week: string;
  /** Okno 4 týdnů (from včetně, to včetně) a začátek týdenního pruhu, YYYY-MM-DD. */
  from: string;
  to: string;
  stripFrom: string;
  stripWeeks: number;
  total: number;
  headline: string;
  thresholdPp: number;
  topics: {
    key: string; label: string; about: string;
    share: number; prevShare: number; delta: number; direction: "up" | "flat" | "down"; major: number;
    weeks: (number | null)[];
  }[];
  tools: { tool: string; name: string; total: number; top: { key: string; label: string; share: number; ccShare: number }[] }[];
  catchup: {
    tool: string; name: string; since: string | null; medianLagDays: number | null;
    now: string[];
    lead: { label: string; n: number }[];
    pairs: { term: string; topic: string; label: string; title: string | null; cc: string; ccVersion: string; ccExact: boolean; other: string; otherVersion: string; lagDays: number }[];
  }[];
}

function headline(o: TopicsOverview): string {
  const fmt = (x: number) => `${x > 0 ? "+" : x < 0 ? "−" : "±"}${Math.abs(r1(x)).toFixed(1)} pp`;
  const [top] = o.topics;
  const up = o.topics.filter((t) => t.direction === "up").sort((a, b) => b.delta - a.delta).slice(0, 3);
  const down = o.topics.filter((t) => t.direction === "down").sort((a, b) => a.delta - b.delta)[0];
  const items = up.map((t) => `${enLabel(t.key)} (${fmt(t.delta)})`);
  // Názvy témat samy obsahují čárky, spojka se proto vkládá před poslední prvek.
  const list = items.length > 1 ? `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}` : items.join("");
  let s = top ? `Most changes went to ${enLabel(top.key)}: ${r1(top.share).toFixed(1)} %.` : "";
  if (up.length) s += ` Gaining the most: ${list}.`;
  if (down) s += ` Losing the most: ${enLabel(down.key)} (${fmt(down.delta)}).`;
  return s.trim();
}

/** Čistá funkce: přehled a dohánění → anglický snímek (zaokrouhlená čísla, stabilní pořadí). */
export function buildTrendsSnapshot(o: TopicsOverview, cu: Catchup, stripWeeks: number, thresholdPp: number): TrendsSnapshot {
  const lastDay = o.to - DAY;
  const w = isoWeek(new Date(lastDay));
  return {
    version: TRENDS_VERSION,
    week: `${w.year}-W${String(w.week).padStart(2, "0")}`,
    from: isoDate(o.from),
    to: isoDate(lastDay),
    stripFrom: isoDate(o.stripFrom),
    stripWeeks,
    total: o.total,
    headline: headline(o),
    thresholdPp,
    topics: o.topics
      .filter((t) => t.key !== "other" && (t.share > 0 || t.prevShare > 0))
      .map((t) => ({
        key: t.key, label: enLabel(t.key), about: TOPIC_EN[t.key]?.about ?? "",
        share: r1(t.share), prevShare: r1(t.prevShare), delta: r1(t.delta), direction: t.direction, major: t.major,
        weeks: t.weeks.map((x) => (x === null ? null : r1(x))),
      })),
    tools: o.tools.map((t) => ({
      tool: t.tool, name: t.name, total: t.total,
      top: t.top.map((x) => ({ key: x.key, label: enLabel(x.key), share: r1(x.share), ccShare: r1(x.ccShare) })),
    })),
    catchup: cu.tools.map((t) => ({
      tool: t.tool, name: t.name, since: t.since ? isoDate(t.since) : null, medianLagDays: t.medianLagDays,
      now: t.now.map((x) => enLabel(x.key)),
      lead: t.lead.map((l) => ({ label: enLabel(l.key), n: l.n })),
      pairs: t.pairs.map((p) => ({
        term: p.term, topic: p.topic, label: enLabel(p.topic), title: p.titleEn,
        cc: isoDate(p.ccAt), ccVersion: p.ccVersion, ccExact: p.ccExact,
        other: isoDate(p.otherAt), otherVersion: p.otherVersion, lagDays: p.lagDays,
      })),
    })),
  };
}

export const trendsJson = (s: TrendsSnapshot) => `${JSON.stringify(s, null, 2)}\n`;

/** Snímek z aktuálních dat (bez cache, aby po přepočtu dohánění seděl hned). */
export async function computeTrendsSnapshot(env: { KV: KVNamespace }, db: Db, now: Date): Promise<TrendsSnapshot> {
  const { STRIP_WEEKS } = await import("./topics-overview");
  const { TREND_THRESHOLD_PP } = await import("./trends");
  const o = await computeTopicsOverview(db, now);
  const rows = await db.select().from(ccCatchup).where(eq(ccCatchup.verdict, "yes"));
  const lead = (await env.KV.get<Partial<Record<ToolKey, ToolLead>>>(catchupLeadKvKey, "json")) ?? {};
  return buildTrendsSnapshot(o, buildCatchup(rows, lead, o.tools, o.to), STRIP_WEEKS, TREND_THRESHOLD_PP);
}

export type TrendsOutcome =
  | { kind: "dry-run"; json: string }
  | { kind: "unchanged"; week: string }
  | { kind: "empty" }
  | { kind: "pr"; pr: SitePr; week: string }
  | { kind: "no-token"; json: string };

/** Pošle snímek do repa webu jako PR, když se liší od vydaného. */
export async function publishEnglishTrends(
  env: EnglishEnv, db: Db, now: Date, opts: { dryRun?: boolean; fetch?: GhFetch } = {},
): Promise<TrendsOutcome> {
  const snap = await computeTrendsSnapshot(env, db, now);
  const json = trendsJson(snap);
  if (opts.dryRun) return { kind: "dry-run", json };
  if (snap.total === 0) return { kind: "empty" };
  const token = env.VIBECODING_SITE_GITHUB_TOKEN;
  if (!token) return { kind: "no-token", json };
  const repo = env.VIBECODING_SITE_REPO || DEFAULT_REPO;
  if ((await readSiteFile(token, repo, TRENDS_PATH, opts.fetch)) === json) return { kind: "unchanged", week: snap.week };
  const pairs = snap.catchup.reduce((s, t) => s + t.pairs.length, 0);
  const pr = await openSitePullRequest(
    token, repo,
    { path: TRENDS_PATH, content: json },
    {
      branch: `en-trends/${snap.week.toLowerCase()}`,
      title: `Development trends ${snap.week}`,
      body: [
        `Anglický snímek trendů pro /en/trends/ za 4 týdny ${snap.from} až ${snap.to} (${snap.total} změn Claude Code), ${pairs} ověřených případů dohánění.`,
        "",
        `> ${snap.headline}`,
        "",
        "Vydání = sloučení tohoto PR.",
        "",
        "🤖 Generated by videokurzy (cc-news.en-trends)",
      ].join("\n"),
    },
    opts.fetch,
    // Datový soubor nikdo ručně neupravuje: novější snímek přepíše i nesloučenou větev.
    { overwrite: true },
  );
  if ("edited" in pr) throw new Error("unreachable: overwrite");
  return { kind: "pr", pr, week: snap.week };
}
