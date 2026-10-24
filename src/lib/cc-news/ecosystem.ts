// Mapa ekosystému na /novinky-cc/ekosystem: co se za poslední týden a čtyři týdny
// dělo u všech sledovaných nástrojů. Claude Code nese český článek, ostatní
// nástroje krátký český souhrn týdne (tools/week-cs.ts); témata a tempo bere
// z přehledu témat (topics-overview.ts), dohánění z catchup.ts.

import { isoWeek, isoWeekBounds, lastClosedWeek } from "./changelog-source";
import { englishWeeklyUrls } from "./english";
import { TOPICS } from "./taxonomy";
import type { TopicsOverview } from "./topics-overview";
import { CLAUDE_CODE, TOOLS, toolDatesKvKey, type ToolDates, type ToolKey } from "../tools/registry";
import type { ToolWeekCs } from "../tools/week-cs";
import { toolWeekCsKvKey, toolWeekKvKey, type ToolWeek } from "../tools/weekly-tool";

type Week = { year: number; week: number };

/** Kolik týdnů zpět hledat poslední týden s novinkami (vydání z GitHubu nechodí každý týden). */
export const LOOKBACK_WEEKS = 4;

export interface MatrixRow {
  key: string;
  label: string;
  /** Podíl tématu na změnách nástroje za 4 týdny (%), v pořadí `tools`; null = nástroj nemá změny. */
  shares: (number | null)[];
}

export interface EcosystemMatrix {
  /** total = zatříděné položky changelogu, releases = vydání (různé verze) za 4 týdny. */
  tools: { tool: ToolKey; name: string; total: number; releases: number }[];
  rows: MatrixRow[];
  /** Největší podíl v tabulce (škála barev). */
  max: number;
}

/** Témata × nástroje z přehledu; řádky podle součtu podílů, „Ostatní“ na konec. Čistá funkce. */
export function buildEcosystemMatrix(o: TopicsOverview): EcosystemMatrix {
  const cc = new Map(o.topics.map((t) => [t.key, t.share]));
  const rel = (tool: string) => o.releases?.[tool] ?? 0;
  // Trendy Claude Code téma „Ostatní“ nepočítají: bez údaje (null), ne 0 %.
  const tools = [
    { tool: CLAUDE_CODE, name: TOOLS[CLAUDE_CODE].name, total: o.total, releases: rel(CLAUDE_CODE), share: (k: string) => (k === "other" ? null : cc.get(k) ?? 0) },
    ...o.tools.map((t) => ({ tool: t.tool, name: t.name, total: t.total, releases: rel(t.tool), share: (k: string): number | null => t.shares?.[k] ?? 0 })),
  ];
  const rows = TOPICS.map((t) => ({
    key: t.key,
    label: t.label,
    shares: tools.map((x) => (x.total > 0 ? x.share(t.key) : null)),
  }))
    .filter((r) => r.shares.some((x) => (x ?? 0) > 0))
    .sort((a, b) => {
      if (a.key === "other" || b.key === "other") return Number(a.key === "other") - Number(b.key === "other");
      const sum = (r: MatrixRow) => r.shares.reduce<number>((s, x) => s + (x ?? 0), 0);
      return sum(b) - sum(a);
    });
  const max = Math.max(1, ...rows.flatMap((r) => r.shares.map((x) => x ?? 0)));
  return { tools: tools.map(({ tool, name, total, releases }) => ({ tool, name, total, releases })), rows, max };
}

/** Co z dat vydání nástroje v daném období není jisté. */
export interface DatesNote {
  /** Verze, jejichž datum je jen horní mez (vydány nejpozději tehdy). */
  upper: string[];
  /** Verze datované dnem, kdy jsme je poprvé uviděli. */
  firstSeen: string[];
  /** Vydané verze (npm, GitHub), které changelog ještě nemá; jen u nejnovějšího období. */
  missing: string[];
}

/** Poznámka k datům verzí v období [from, to); null, když je vše přesné. Čistá funkce. */
export function datesNote(d: ToolDates | null, from: number, to: number, withMissing = false): DatesNote | null {
  if (!d) return null;
  const inside = (at: string) => {
    const t = Date.parse(at);
    return t >= from && t < to;
  };
  const approx = d.approx.filter((a) => inside(a.at));
  const note = {
    upper: approx.filter((a) => a.basis === "upper").map((a) => a.version),
    firstSeen: approx.filter((a) => a.basis === "first-seen").map((a) => a.version),
    missing: withMissing ? d.missing.map((m) => m.version) : [],
  };
  return note.upper.length || note.firstSeen.length || note.missing.length ? note : null;
}

/** Poznámky k datům všech nástrojů (zapisují je synchronizace, zatím jen Muse Code). */
export async function loadToolDates(kv: KVNamespace): Promise<Partial<Record<ToolKey, ToolDates>>> {
  const keys = Object.keys(TOOLS) as ToolKey[];
  const out: Partial<Record<ToolKey, ToolDates>> = {};
  await Promise.all(
    keys.map(async (tool) => {
      try {
        const d = await kv.get<ToolDates>(toolDatesKvKey(tool), "json");
        if (d) out[tool] = d;
      } catch (err) {
        console.error(`[cc-news] ekosystém: čtení dat verzí ${tool} selhalo:`, (err as Error)?.message);
      }
    }),
  );
  return out;
}

/** Týden nástroje na mapě: český souhrn, nebo anglické názvy novinek, dokud souhrn není. */
export interface ToolWeekCard {
  tool: ToolKey;
  name: string;
  week: Week | null;
  points: string[];
  /** true = `points` jsou anglické názvy novinek (souhrn se teprve píše). */
  pending: boolean;
  /** Anglický přehled na vibecoding.cz/en (jen u nástrojů s anglickou řadou). */
  englishUrl: string | null;
}

const prevWeek = (w: Week): Week => isoWeek(new Date(isoWeekBounds(w.year, w.week).start.getTime() - 86_400_000));

/**
 * Poslední týden s novinkami pro každý další nástroj (nejvýš LOOKBACK_WEEKS zpět).
 * Chyba čtení KV u jednoho nástroje nesmí shodit stránku: nástroj pak týden nemá.
 */
export async function loadToolWeekCards(kv: KVNamespace, now: Date): Promise<ToolWeekCard[]> {
  const others = (Object.keys(TOOLS) as ToolKey[]).filter((t) => t !== CLAUDE_CODE);
  return Promise.all(
    others.map(async (tool): Promise<ToolWeekCard> => {
      const card: ToolWeekCard = { tool, name: TOOLS[tool].name, week: null, points: [], pending: false, englishUrl: null };
      try {
        let w = lastClosedWeek(now);
        for (let i = 0; i < LOOKBACK_WEEKS; i++, w = prevWeek(w)) {
          const [cs, built] = await Promise.all([
            kv.get<ToolWeekCs>(toolWeekCsKvKey(tool, w), "json"),
            kv.get<ToolWeek>(toolWeekKvKey(tool, w), "json"),
          ]);
          const titles = built?.features.map((f) => f.title) ?? [];
          if (!cs?.points.length && titles.length === 0) continue;
          card.week = w;
          card.points = cs?.points.length ? cs.points : titles.slice(0, 5);
          card.pending = !cs?.points.length;
          card.englishUrl = TOOLS[tool].englishWeekly && titles.length > 0 ? englishWeeklyUrls({ tool, week: w }).url : null;
          break;
        }
      } catch (err) {
        console.error(`[cc-news] ekosystém: čtení týdne ${tool} selhalo:`, (err as Error)?.message);
      }
      return card;
    }),
  );
}
