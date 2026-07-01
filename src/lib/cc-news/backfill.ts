// Hromadné doplnění posledních N týdnů „Novinky v Claude Code" rovnou na web
// (gated sekce /novinky-cc) — BEZ schvalovacího e-mailu a BEZ newsletteru.
//
// Běžný tok (cron → fronta → schvalovací e-mail → lidské schválení) řeší JEDEN
// nejnovější týden. Tady doplníme více týdnů najednou: detekce posledních N
// digestů → redakční zpracování (vč. LLM překladu dle CC_NEWS_LLM) → přímá
// publikace do KV. Žádný e-mail neodejde; newsletterSentAt zůstává prázdné, takže
// pozdější rozeslání (kdyby ho někdo chtěl) tím není dotčené.
//
// Publikační krok je záměrně shodný s POST /admin/api/cc-news/publish: promote
// draft KV blob → published KV + status=published + publishedAt. Idempotence:
// už publikovaný týden (bez čekající re-editované verze) se přeskočí, ledaže
// volající vynutí `force`.

import { eq } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";
import { ccNewsItem } from "../../db/schema";
import { detectRecent, defaultFetchers, type Fetchers } from "./detect";
import { processCcNewsItem, type PipelineEnv } from "./pipeline";
import { draftKvKey, publishedKvKey } from "./draft";

type Db = ReturnType<typeof drizzle>;

/** Stav zpracování jednoho týdne v rámci backfillu. */
export type BackfillEntry = {
  sourceId: string;
  itemId: string;
  weekLabel: string | null;
  /** published = nově publikováno teď; skipped = už bylo publikované; error = selhalo */
  result: "published" | "skipped" | "error";
  /** Důvod přeskočení / text chyby (pro log a UI). */
  note?: string;
  usedLlm?: boolean;
};

export interface BackfillResult {
  weeks: number;
  published: number;
  skipped: number;
  errors: number;
  entries: BackfillEntry[];
}

/**
 * Doplní posledních `weeks` týdnů na web. Pro každý týden:
 *  1) detekce (idempotentní upsert řádky),
 *  2) zpracování konceptu (`processCcNewsItem` — stáhne `.md` + případně LLM),
 *  3) publikace (promote draft → published v KV, status=published).
 *
 * `force` přepublikuje i už publikované týdny (přegeneruje koncept z aktuálního
 * digestu a promotuje ho). Bez `force` se publikovaný týden přeskočí.
 *
 * `excludeNewest` ponechá NEJNOVĚJŠÍ týden ve feedu beze změny (nepublikuje ho).
 * Použití: zacelení starších mezer (např. chybějící Week 25), když nejnovější
 * týden je záměrně koncept čekající na schvalovací tok — ten se publikovat nesmí.
 *
 * Selhání JEDNOHO týdne nezhatí ostatní — zaznamená se jako `error` a pokračuje
 * se dál (chceme doplnit co nejvíc, ne spadnout na prvním problému).
 */
export async function backfillRecentWeeks(
  db: Db,
  env: PipelineEnv,
  now: Date,
  opts: { weeks?: number; force?: boolean; excludeNewest?: boolean } = {},
  fetchers: Fetchers = defaultFetchers()
): Promise<BackfillResult> {
  const weeks = Math.max(1, Math.min(opts.weeks ?? 4, 12));
  const force = opts.force ?? false;
  const excludeNewest = opts.excludeNewest ?? false;

  const outcomes = await detectRecent(db, fetchers, now, weeks);
  const entries: BackfillEntry[] = [];

  for (let i = 0; i < outcomes.length; i++) {
    const outcome = outcomes[i];
    if (outcome.kind === "empty") continue;
    const { itemId, sourceId } = outcome;

    // Nejnovější týden (první v pořadí, nejnovější první) ponecháme beze změny —
    // typicky je to koncept ve schvalovacím toku, který se nesmí předčasně
    // publikovat. Zacelujeme jen starší mezery.
    if (excludeNewest && i === 0) {
      entries.push({
        sourceId,
        itemId,
        weekLabel: null,
        result: "skipped",
        note: "nejnovější týden — ponecháno beze změny",
      });
      continue;
    }

    try {
      const [row] = await db
        .select()
        .from(ccNewsItem)
        .where(eq(ccNewsItem.id, itemId))
        .limit(1);
      if (!row) {
        entries.push({ sourceId, itemId, weekLabel: null, result: "error", note: "řádka zmizela" });
        continue;
      }

      // Idempotence: publikovaný týden bez čekající re-editované verze se bez
      // `force` přeskočí (nemá smysl volat LLM znovu). S pendingContentHash je
      // tu nová verze ke zveřejnění — tu necháme projít i bez force.
      if (row.status === "published" && !row.pendingContentHash && !force) {
        entries.push({
          sourceId,
          itemId,
          weekLabel: row.weekLabel,
          result: "skipped",
          note: "už publikováno",
        });
        continue;
      }

      // Zpracování konceptu: stáhne `.md`, vyrobí článek (LLM dle env), uloží
      // draft do KV a připraví (dry-run) schvalovací e-mail — ten se ale NEodesílá
      // (mantinel: backfill nikdy needeskaluje na live odeslání).
      const prepared = await processCcNewsItem(db, env, { itemId, sourceId }, now, fetchers);

      // Publikace: promote draft → published (shodné s /admin/api/cc-news/publish).
      const draftMd = await env.KV.get(draftKvKey(itemId));
      if (draftMd !== null) {
        await env.KV.put(publishedKvKey(itemId), draftMd);
      } else if ((await env.KV.get(publishedKvKey(itemId))) === null) {
        entries.push({
          sourceId,
          itemId,
          weekLabel: row.weekLabel,
          result: "error",
          note: "není co publikovat (chybí obsah v KV)",
        });
        continue;
      }

      await db
        .update(ccNewsItem)
        .set({
          status: "published",
          publishedAt: now,
          approveNonce: null,
          // Pending verze tímto zveřejněna → srovnat hash a vynulovat pending.
          ...(row.pendingContentHash ? { contentHash: row.pendingContentHash } : {}),
          pendingContentHash: null,
        })
        .where(eq(ccNewsItem.id, itemId));

      entries.push({
        sourceId,
        itemId,
        weekLabel: row.weekLabel,
        result: "published",
        usedLlm: prepared.usedLlm,
      });
    } catch (err) {
      const msg = (err as Error)?.message ?? String(err);
      console.error(`[cc-news] backfill týdne ${sourceId} selhal:`, msg);
      entries.push({ sourceId, itemId, weekLabel: null, result: "error", note: msg });
    }
  }

  const published = entries.filter((e) => e.result === "published").length;
  const skipped = entries.filter((e) => e.result === "skipped").length;
  const errors = entries.filter((e) => e.result === "error").length;
  return { weeks, published, skipped, errors, entries };
}
