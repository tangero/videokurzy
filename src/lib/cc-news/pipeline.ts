// Zřetězení redakční pipeline „Novinky v Claude Code": z detekovaného záznamu
// (cc-news.detected) vyrobí článek a připraví ho ke schválení. Tohle je most,
// který napojuje detekci (W-003) na editor (W-004) a draft+schválení (W-005).
//
// NIC se neodesílá ani nepublikuje — jen se uloží koncept a připraví dry-run
// schvalovací e-mail. Publikace nastává až po lidském kliknutí (mantinel).

import type { drizzle } from "drizzle-orm/d1";
import { parseDigest, renderArticle, type EditorEnv } from "./editor";
import { prepareDraftAndApproval, type PreparedDraft } from "./draft";
import { defaultFetchers, type Fetchers } from "./detect";

type Db = ReturnType<typeof drizzle>;

interface PipelineEnv extends EditorEnv {
  KV: KVNamespace;
  AUTH_INTERNAL_SECRET: string;
  BETTER_AUTH_URL?: string;
  CC_NEWS_DRY_RUN?: string;
}

export interface CcNewsRef {
  itemId: string;
  sourceId: string;
}

/** Slug článku z sourceId `/docs/en/whats-new/2026-w24` → `2026-w24-novinky`. */
export function articleSlug(sourceId: string): string {
  return `${sourceId.replace(/^.*\//, "")}-novinky`;
}

/**
 * Zpracuje detekovaný záznam: stáhne `.md` detail, vyrobí článek editorem
 * (deterministicky + volitelně LLM dle env), uloží draft a připraví schvalovací
 * e-mail (dry-run). `fetchers` je injektovatelný pro testy (bez sítě).
 */
export async function processCcNewsItem(
  db: Db,
  env: PipelineEnv,
  ref: CcNewsRef,
  now: Date,
  fetchers: Fetchers = defaultFetchers()
): Promise<PreparedDraft & { usedLlm: boolean }> {
  const digestMd = await fetchers.fetchDetail(ref.sourceId);
  const parsed = parseDigest(digestMd);
  const { markdown, usedLlm } = await renderArticle(digestMd, env);

  const prepared = await prepareDraftAndApproval(
    db,
    env,
    ref.itemId,
    markdown,
    {
      slug: articleSlug(ref.sourceId),
      weekLabel: parsed.weekLabel || ref.sourceId.replace(/^.*\//, ""),
      versionRange: parsed.versionRange,
    },
    now
  );

  return { ...prepared, usedLlm };
}
