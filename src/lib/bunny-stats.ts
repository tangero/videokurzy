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
