// Mapa ekosystému na /novinky-cc/ekosystem: co se za poslední týden a čtyři týdny
// dělo u všech sledovaných nástrojů. Claude Code nese český článek, ostatní
// nástroje krátký český souhrn týdne (tools/week-cs.ts); témata a tempo bere
// z přehledu témat (topics-overview.ts), dohánění z catchup.ts.

import { isoWeek, isoWeekBounds, lastClosedWeek } from "./changelog-source";
import { englishWeeklyUrls } from "./english";
import { TOPICS } from "./taxonomy";
import type { TopicsOverview } from "./topics-overview";
import { CLAUDE_CODE, TOOLS, type ToolKey } from "../tools/registry";
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
  tools: { tool: ToolKey; name: string; total: number }[];
  rows: MatrixRow[];
  /** Největší podíl v tabulce (škála barev). */
  max: number;
}

/** Témata × nástroje z přehledu; řádky podle součtu podílů, „Ostatní“ na konec. Čistá funkce. */
export function buildEcosystemMatrix(o: TopicsOverview): EcosystemMatrix {
  const cc = new Map(o.topics.map((t) => [t.key, t.share]));
  const tools = [
    { tool: CLAUDE_CODE, name: TOOLS[CLAUDE_CODE].name, total: o.total, share: (k: string) => cc.get(k) ?? 0 },
    ...o.tools.map((t) => ({ tool: t.tool, name: t.name, total: t.total, share: (k: string) => t.shares?.[k] ?? 0 })),
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
  return { tools: tools.map(({ tool, name, total }) => ({ tool, name, total })), rows, max };
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
