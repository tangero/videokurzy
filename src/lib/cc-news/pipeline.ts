// Zřetězení redakční pipeline „Novinky v Claude Code": z detekovaného záznamu
// (cc-news.detected) vyrobí článek a připraví ho ke schválení. Tohle je most,
// který napojuje detekci (W-003) na editor (W-004) a draft+schválení (W-005).
//
// Defaultně se NIC neodesílá ani nepublikuje — jen se uloží koncept a připraví
// dry-run schvalovací e-mail. Reálné odeslání e-mailu vyžaduje obě brány
// (env CC_NEWS_DRY_RUN=0 + admin přepínač cc_news_live_send) — viz settings.ts.
// Publikace článku nastává vždy až po lidském kliknutí na schvalovací link.

import { eq } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";
import { ccNewsItem } from "../../db/schema";
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

/** Výsledek ručního triggeru. `skipped` = e-mail už byl odeslán dřív (idempotence). */
export type TriggerResult =
  | (PreparedDraft & { usedLlm: boolean; skipped?: false })
  | { skipped: true; approvalEmailSentAt: Date };

/**
 * Ruční admin trigger (mimo cron): zpracuje detekovaný záznam STEJNĚ jako
 * `processCcNewsItem` a ZARUČÍ, že schvalovací e-mail reálně odejde na příjemce
 * — i bez zapnutých dry-run bran (CC_NEWS_DRY_RUN / cc_news_live_send).
 *
 * IDEMPOTENCE: pokud už schvalovací e-mail pro toto vydání odešel
 * (`approvalEmailSentAt` je nastaveno) a volající nevynutí `force`, NEposíláme
 * znovu ani nepřegenerujeme draft — vrátíme `skipped`. Brání to opakovanému
 * odeslání téhož e-mailu při dvojkliku / refreshe. Re-edit digestu (detekce
 * `changed`) `approvalEmailSentAt` vynuluje, takže e-mail k NOVÉ verzi projde.
 *
 * Rozdíl proti pipeline z fronty: tu volá admin EXPLICITNĚ z UI a očekává, že
 * mu e-mail reálně přijde teď. Dry-run brány gateují AUTOMATICKÉ rozesílání
 * (cron → newsletter předplatitelům), ne tento vědomý lidský úkon. Draft, nonce
 * i approve link připraví sdílená `prepareDraftAndApproval`. Když už ta e-mail
 * odeslala (live brány zapnuté), NEposíláme znovu — jinak ho doplníme napřímo.
 */
export async function triggerCcNewsApproval(
  db: Db,
  env: PipelineEnv,
  ref: CcNewsRef,
  now: Date,
  fetchers: Fetchers = defaultFetchers(),
  opts: { force?: boolean } = {}
): Promise<TriggerResult> {
  // Idempotence se MUSÍ vyhodnotit PŘED processCcNewsItem: v live režimu by
  // prepareDraftAndApproval e-mail odeslala uvnitř, než bychom stihli zabránit.
  if (!opts.force) {
    const [existing] = await db
      .select({ sentAt: ccNewsItem.approvalEmailSentAt })
      .from(ccNewsItem)
      .where(eq(ccNewsItem.id, ref.itemId))
      .limit(1);
    if (existing?.sentAt) {
      return { skipped: true, approvalEmailSentAt: existing.sentAt };
    }
  }

  const prepared = await processCcNewsItem(db, env, ref, now, fetchers);

  // Pokud byly splněny obě live brány, prepareDraftAndApproval e-mail UŽ odeslala
  // (prepared.sent === true) — druhé odeslání by ho jen zduplikovalo. Tady
  // odeslání DOplníme jen v případě, že první průchod skončil dry-run (sent=false);
  // to je smysl ručního triggeru: vynutit e-mail i bez zapnutých bran.
  const sent =
    prepared.sent ||
    (await sendEmail(
      { RESEND_API_KEY: env.RESEND_API_KEY ?? "" },
      { to: prepared.email.to, subject: prepared.email.subject, html: prepared.email.html }
    ));

  // Zaznamenej úspěšné odeslání pro idempotenci a zobrazení v adminu. Stamp se
  // dělá AŽ po odeslání (před ním ještě nevíme, zda e-mail prošel), takže je tu
  // okno: e-mail odešel, ale stamp selže. KRITICKÉ: tuhle chybu NEpropagujeme —
  // kdyby konzument fronty zprávu retryoval, triggerCcNewsApproval by (s prázdným
  // sentAt nebo force) poslal DRUHÝ e-mail. Ztráta evidence o odeslání je menší
  // zlo než duplicitní e-mail; nekonzistenci pozná admin (e-mail přišel, sloupec
  // prázdný) a může dořešit ručně. Chybu hlasitě zalogujeme.
  if (sent) {
    try {
      await db
        .update(ccNewsItem)
        .set({ approvalEmailSentAt: now })
        .where(eq(ccNewsItem.id, ref.itemId));
    } catch (err) {
      console.error(
        `[cc-news] e-mail ODESLÁN, ale zápis approvalEmailSentAt selhal pro ${ref.itemId} ` +
          `— NEretryuji (bráním duplicitě):`,
        (err as Error)?.message,
      );
    }
  }

  return { ...prepared, mode: sent ? "live" : prepared.mode, sent };
}
