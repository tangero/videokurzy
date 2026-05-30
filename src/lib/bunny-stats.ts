import { drizzle } from "drizzle-orm/d1";
import { isNotNull } from "drizzle-orm";
import { lesson, videoStats } from "../db/schema";
import type { Env } from "../types";

const BUNNY_API_BASE = "https://video.bunnycdn.com";

export interface VideoStatistics {
  views: number;
  /**
   * Součet watchTimeChart z bunny.net. POZOR: jednotku bunny dokumentace přesně
   * neuvádí — po prvním ostrém synci ověřit (porovnat s délkou×views) a případně
   * normalizovat. Ukládáme jako "sekundy", dokud se neprokáže jinak.
   */
  watchTimeSeconds: number;
  /** 0–100, per video. Na úrovni knihovny chybí. */
  engagementScore: number;
}

/** Sečte hodnoty z bunny "chartu" (mapa den → číslo). */
function sumChart(chart: unknown): number {
  if (!chart || typeof chart !== "object") return 0;
  let total = 0;
  for (const value of Object.values(chart as Record<string, unknown>)) {
    const n = Number(value);
    if (Number.isFinite(n)) total += n;
  }
  return total;
}

/**
 * Stáhne agregované statistiky jednoho videa z bunny.net Stream Statistics API.
 * Volá se server-side (ostré BUNNY_* creds jsou jen v produkčním workeru).
 */
export async function fetchVideoStatistics(
  env: Pick<Env, "BUNNY_API_KEY" | "BUNNY_LIBRARY_ID">,
  videoGuid: string,
  dateFrom = "2026-01-01",
): Promise<VideoStatistics> {
  const url =
    `${BUNNY_API_BASE}/library/${env.BUNNY_LIBRARY_ID}/statistics` +
    `?videoGuid=${encodeURIComponent(videoGuid)}&dateFrom=${dateFrom}`;

  const res = await fetch(url, {
    headers: { AccessKey: env.BUNNY_API_KEY, Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Bunny statistics ${res.status}: ${res.statusText}`);
  }

  const data = (await res.json()) as Record<string, unknown>;
  return {
    views: Math.round(sumChart(data.viewsChart)),
    watchTimeSeconds: Math.round(sumChart(data.watchTimeChart)),
    engagementScore: Math.round(Number(data.engagementScore) || 0),
  };
}

/**
 * Stáhne agregované bunny.net statistiky pro každé video s GUID a upsertne je
 * do `video_stats`. Chyba jednoho videa neshodí ostatní.
 *
 * Tuto funkci lze volat jak z cronu, tak ručně z adminu.
 */
export async function syncVideoStats(
  db: ReturnType<typeof drizzle>,
  env: Env,
): Promise<{ synced: number; errors: number }> {
  const lessons = await db
    .select({ guid: lesson.bunnyVideoId })
    .from(lesson)
    .where(isNotNull(lesson.bunnyVideoId));

  let synced = 0;
  let errors = 0;

  for (const l of lessons) {
    if (!l.guid) continue;
    try {
      const s = await fetchVideoStatistics(env, l.guid);
      const now = new Date();

      await db
        .insert(videoStats)
        .values({
          videoGuid: l.guid,
          views: s.views,
          watchTimeSeconds: s.watchTimeSeconds,
          engagementScore: s.engagementScore,
          syncedAt: now,
        })
        .onConflictDoUpdate({
          target: videoStats.videoGuid,
          set: {
            views: s.views,
            watchTimeSeconds: s.watchTimeSeconds,
            engagementScore: s.engagementScore,
            syncedAt: now,
          },
        });

      synced++;
    } catch (err) {
      errors++;
      console.error(`[bunny-stats] video ${l.guid} failed:`, err);
    }
  }

  return { synced, errors };
}
