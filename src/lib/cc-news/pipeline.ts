// Zřetězení redakční pipeline „Novinky v Claude Code": z detekovaného záznamu
// (cc-news.detected) vyrobí článek a připraví ho ke schválení. Tohle je most,
// který napojuje detekci (W-003) na editor (W-004) a draft+schválení (W-005).
//
// Defaultně se NIC neodesílá ani nepublikuje — jen se uloží koncept a připraví
// dry-run schvalovací e-mail. Reálné odeslání e-mailu vyžaduje obě brány
// (env CC_NEWS_DRY_RUN=0 + admin přepínač cc_news_live_send) — viz settings.ts.
// Publikace článku nastává vždy až po lidském kliknutí na schvalovací link.

import type { drizzle } from "drizzle-orm/d1";
import { parseDigest, renderArticle, type EditorEnv } from "./editor";
import { prepareDraftAndApproval, type PreparedDraft } from "./draft";
import { defaultFetchers, type Fetchers } from "./detect";
import { sendEmail } from "../email";

type Db = ReturnType<typeof drizzle>;

interface PipelineEnv extends EditorEnv {
  KV: KVNamespace;
  AUTH_INTERNAL_SECRET: string;
  BETTER_AUTH_URL?: string;
  CC_NEWS_DRY_RUN?: string;
  RESEND_API_KEY?: string;
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
  // renderArticle dostane už naparsovaný digest, aby se neparsovalo dvakrát.
  const { markdown, usedLlm } = await renderArticle(digestMd, env, { parsed });

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

/**
 * Ruční admin trigger (mimo cron): zpracuje detekovaný záznam STEJNĚ jako
 * `processCcNewsItem`, ale schvalovací e-mail VŽDY reálně odešle na ADMIN_EMAILS
 * — nezávisle na dry-run branách (CC_NEWS_DRY_RUN / cc_news_live_send).
 *
 * Rozdíl proti pipeline z fronty: tu volá admin EXPLICITNĚ z UI a očekává, že
 * mu e-mail reálně přijde teď. Dry-run brány gateují AUTOMATICKÉ rozesílání
 * (cron → newsletter předplatitelům), ne tento vědomý lidský úkon. Draft, nonce
 * i approve link připraví sdílená `prepareDraftAndApproval`; tady jen pošleme
 * její už sestavený `email` napřímo přes Resend. Vrací `sent` z výsledku odeslání.
 */
export async function triggerCcNewsApproval(
  db: Db,
  env: PipelineEnv,
  ref: CcNewsRef,
  now: Date,
  fetchers: Fetchers = defaultFetchers()
): Promise<PreparedDraft & { usedLlm: boolean }> {
  const prepared = await processCcNewsItem(db, env, ref, now, fetchers);

  // prepareDraftAndApproval už e-mail sestavila; v dry-run ho jen nezaslala.
  // Tady odeslání vynutíme (ruční admin akce). Idempotentní vůči opakování:
  // draft/nonce/approve link jsou uložené, znovuodeslání jen duplikuje e-mail.
  const sent = await sendEmail(
    { RESEND_API_KEY: env.RESEND_API_KEY ?? "" },
    { to: prepared.email.to, subject: prepared.email.subject, html: prepared.email.html }
  );

  return { ...prepared, mode: "live", sent };
}
