// Sdílené formátování dat (cs-CZ) pro views. Dřív trojí kopie fmtDate v
// admin-newsletter / admin-stats / cc-news; konsolidováno sem.
//
// POZOR na jednotky: tyhle helpery berou MILISEKUNDY (epoch ms). admin-stats
// pracuje se SEKUNDAMI (Bunny API), proto si tam ponechává vlastní *1000 wrapper.

interface FmtDateOpts {
  /** Měsíc: "numeric" (6.) nebo "long" (června). Default "numeric". */
  month?: "numeric" | "long";
  /** Co vrátit pro null/0. Default "—". */
  fallback?: string;
}

/** Datum z epoch ms → lokalizovaný cs-CZ řetězec. null/0 → fallback. */
export function fmtDate(ms: number | null, opts: FmtDateOpts = {}): string {
  if (!ms) return opts.fallback ?? "—";
  return new Date(ms).toLocaleDateString("cs-CZ", {
    day: "numeric",
    month: opts.month ?? "numeric",
    year: "numeric",
  });
}

/** Datum + čas z epoch ms → lokalizovaný cs-CZ řetězec. null/0 → fallback. */
export function fmtDateTime(ms: number | null, fallback = "—"): string {
  if (!ms) return fallback;
  return new Date(ms).toLocaleString("cs-CZ", {
    day: "numeric",
    month: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
