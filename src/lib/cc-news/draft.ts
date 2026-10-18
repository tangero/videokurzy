// Uložení redakčního konceptu + příprava schvalovacího e-mailu (W-005, R3/R4).
//
// Tok: redakční editor (W-004) vyrobí markdown → tady ho uložíme jako draft a
// vygenerujeme JEDNORÁZOVÝ podepsaný schvalovací link (W-005). V dry-run režimu
// (výchozí; mantinel kontraktu) se e-mail NEodesílá — jen sestaví a vrátí, aby
// šel ověřit v testu. Publikace nastává rovnou, když je zapnuté automatické
// vydávání (autoPublishDraft, výchozí), jinak po kliknutí na link (W-006).
//
// „Uložení do repa": skutečný markdown se v běhu ukládá do KV (artefakt), na
// řádce cc_news_item se zapíše `articlePath` (zamýšlená cesta v repu) a
// `approveNonce` (jednorázovost schválení). Reálný commit na GitHub je mimo
// dry-run rozsah (mantinel: jen branch/PR, žádné nasazení).

import { eq, sql } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";
import { nanoid } from "nanoid";
import { ccNewsItem } from "../../db/schema";
import { ccNewsApprovalHtml, ccNewsPublishedHtml, sendEmail } from "../email";
import { isCcNewsLiveSend } from "./settings";
import {
  APPROVAL_TOKEN_TTL_MS,
  signApprovalIntent,
} from "./approval";

type Db = ReturnType<typeof drizzle>;

interface DraftEnv {
  KV: KVNamespace;
  AUTH_INTERNAL_SECRET: string;
  BETTER_AUTH_URL?: string;
  // Live odeslání vyžaduje OBĚ brány: env CC_NEWS_DRY_RUN=0 + admin přepínač
  // cc_news_live_send (viz settings.ts). Jinak dry-run (mantinel fáze 1).
  CC_NEWS_DRY_RUN?: string;
  RESEND_API_KEY?: string;
}

/** KV klíč pro markdown rozpracovaného konceptu (přepisuje se každým re-editem). */
export const draftKvKey = (itemId: string): string => `cc-news:draft:${itemId}`;

/**
 * KV klíč pro PUBLIKOVANÝ markdown (živá verze, kterou čte gated detail).
 * Oddělený od draftu: re-edit digestu přepíše jen draft; publikovaná verze
 * zůstává beze změny, dokud člověk nový draft neschválí (viz approveItem).
 */
export const publishedKvKey = (itemId: string): string => `cc-news:published:${itemId}`;

/** Zamýšlená cesta článku v repu (gated sekce „Novinky v CC"). */
export const articleRepoPath = (slug: string): string =>
  `src/content/novinky-cc/${slug}.md`;

export interface PreparedDraft {
  itemId: string;
  articlePath: string;
  approveUrl: string;
  email: { to: string[]; subject: string; html: string };
  mode: "dry-run" | "live";
  sent: boolean;
  /** Vydáno automaticky (bez schválení); volající zařadí anglický přehled. */
  autopublished?: boolean;
}

const baseUrl = (env: DraftEnv): string =>
  (env.BETTER_AUTH_URL ?? "https://kurzy.vibecoding.cz").replace(/\/+$/, "");

/**
 * Uloží koncept a připraví schvalovací e-mail. Defaultně dry-run: e-mail se
 * NEodesílá. `now` je injektovatelné pro testy (expirace tokenu).
 *
 * Idempotence nonce: při každém volání se vygeneruje nový nonce a uloží na
 * řádku — starší link tím přestane platit (poslední příprava vyhrává). Schválení
 * (W-006) porovná nonce z tokenu s DB; po publikaci se nonce smaže.
 */
export async function prepareDraftAndApproval(
  db: Db,
  env: DraftEnv,
  itemId: string,
  markdown: string,
  meta: { slug: string; weekLabel: string; versionRange: string | null },
  now: Date
): Promise<PreparedDraft> {
  // 1) Markdown konceptu do KV.
  await env.KV.put(draftKvKey(itemId), markdown);

  // 2) Nonce + articlePath na řádku. Publikované vydání zůstává publikované:
  // nový koncept leží v draft KV a živou verzi nahradí až schválení.
  const nonce = nanoid();
  const articlePath = articleRepoPath(meta.slug);
  await db
    .update(ccNewsItem)
    .set({ articlePath, approveNonce: nonce, status: sql`CASE WHEN ${ccNewsItem.status} = 'published' THEN 'published' ELSE 'draft' END` })
    .where(eq(ccNewsItem.id, itemId));

  // 3) Jednorázový podepsaný schvalovací link.
  const token = await signApprovalIntent(env, {
    itemId,
    nonce,
    expiresAt: now.getTime() + APPROVAL_TOKEN_TTL_MS,
  });
  const approveUrl = `${baseUrl(env)}/internal/cc-news/approve?token=${encodeURIComponent(token)}`;
  const editUrl = `${baseUrl(env)}/internal/cc-news/draft/${encodeURIComponent(itemId)}`;

  const html = ccNewsApprovalHtml({
    weekLabel: meta.weekLabel,
    versionRange: meta.versionRange,
    approveUrl,
    editUrl,
  });
  // Příjemci se berou z /admin/settings (cc_news_approval_emails), s fallbackem
  // na ADMIN_EMAILS uvnitř getCcNewsApprovalEmails.
  const { getCcNewsApprovalEmails } = await import("./settings");
  const email = {
    to: await getCcNewsApprovalEmails(db),
    subject: `Ke schválení: Novinky v Claude Code — ${meta.weekLabel}`,
    html,
  };

  // 4) Dry-run vs. live. Live vyžaduje OBĚ brány (env + admin přepínač).
  const isLive = await isCcNewsLiveSend(db, env);
  if (!isLive) {
    console.log(
      `[cc-news] DRY-RUN schvalovací e-mail pro ${meta.weekLabel} (item ${itemId}) — NEODESLÁNO. ` +
        `příjemci=${email.to.length}, approve link připraven.`
    );
    return { itemId, articlePath, approveUrl, email, mode: "dry-run", sent: false };
  }

  // Live: reálné odeslání přes Resend (sdílený sendEmail). Koncept i approve
  // link jsou už uložené (kroky 1–3), takže retry je bezpečný — nonce se jen
  // přepíše (poslední link platí). Selhání odeslání EskaLUJEME výjimkou, ať
  // queue zprávu retryuje; jinak by schvalovací e-mail tiše zmizel a novinka
  // by uvízla nepublikovaná. (Duplicitní admin e-mail při retry je přijatelný,
  // ztráta ne.)
  const sent = await sendEmail(
    { RESEND_API_KEY: env.RESEND_API_KEY ?? "" },
    { to: email.to, subject: email.subject, html: email.html },
  );
  if (!sent) {
    console.error(
      `[cc-news] LIVE schvalovací e-mail pro ${meta.weekLabel} (item ${itemId}) SELHAL — ` +
        `eskaluji (queue retry). příjemci=${email.to.length}.`
    );
    throw new Error(`cc-news: odeslání schvalovacího e-mailu selhalo pro item ${itemId}`);
  }
  console.log(
    `[cc-news] LIVE schvalovací e-mail pro ${meta.weekLabel} (item ${itemId}) odeslán. ` +
      `příjemci=${email.to.length}.`
  );
  return { itemId, articlePath, approveUrl, email, mode: "live", sent };
}

/** Nálezy revize článku jako řádky pro oznámení (prázdné = bez nálezů). */
export function reviewFindings(review: {
  versionIssues: string[]; strippedLinks: string[]; editorNotes: string[];
  skipped: { id: string; reason: string }[]; dropped: { title: string; problem: string }[];
}): string[] {
  return [
    ...(review.versionIssues.length ? [`Verze mimo citované položky: ${review.versionIssues.join(", ")}`] : []),
    ...review.dropped.map((d) => `Vyřazeno kontrolou faktů: ${d.title} (${d.problem})`),
    ...review.skipped.map((k) => `Nezařazená zásadní změna: ${k.id} (${k.reason})`),
    ...review.editorNotes.map((n) => `Poznámka modelu: ${n}`),
    ...(review.strippedLinks.length ? [`Odstraněné odkazy: ${review.strippedLinks.join(", ")}`] : []),
  ];
}

/**
 * Automatické vydání (přepínač cc_news_autopublish): koncept se rovnou stane živou
 * verzí, bez schvalovacího odkazu. Místo e-mailu „Ke schválení“ přijde oznámení
 * s odkazy na článek a jeho úpravu a s nálezy kontrol. Selhání oznámení se jen
 * zaloguje: článek už vyšel a retry fronty by ho stavěl znovu.
 * Volá se jen pro dosud nevydané vydání (publikované se znovu nepublikuje).
 */
export async function autoPublishDraft(
  db: Db,
  env: DraftEnv,
  itemId: string,
  markdown: string,
  meta: { slug: string; weekLabel: string; versionRange: string | null; findings: string[]; english?: { url: string; editUrl: string } },
  now: Date
): Promise<PreparedDraft> {
  await env.KV.put(draftKvKey(itemId), markdown);
  await env.KV.put(publishedKvKey(itemId), markdown);
  const articlePath = articleRepoPath(meta.slug);
  await db
    .update(ccNewsItem)
    .set({ articlePath, status: "published", publishedAt: now, approveNonce: null })
    .where(eq(ccNewsItem.id, itemId));

  const base = baseUrl(env);
  const html = ccNewsPublishedHtml({
    intro: `Článek Novinky v Claude Code — ${meta.weekLabel}${meta.versionRange ? ` (${meta.versionRange})` : ""} vyšel automaticky.`,
    links: [
      { label: "Článek na kurzy.vibecoding.cz", url: `${base}/novinky-cc/${meta.slug}` },
      { label: "Upravit český text (admin → Newsletter)", url: `${base}/admin/newsletter` },
      ...(meta.english
        ? [
          { label: "Anglická verze (vyjde během ~15 minut)", url: meta.english.url },
          { label: "Upravit anglickou verzi (Keystatic)", url: meta.english.editUrl },
        ]
        : []),
    ],
    findings: meta.findings,
  });
  const { getCcNewsApprovalEmails } = await import("./settings");
  const email = {
    to: await getCcNewsApprovalEmails(db),
    subject: `Vydáno: Novinky v Claude Code — ${meta.weekLabel}${meta.findings.length ? " ⚠️ s nálezy" : ""}`,
    html,
  };
  const isLive = await isCcNewsLiveSend(db, env);
  let sent = false;
  if (isLive) {
    sent = await sendEmail({ RESEND_API_KEY: env.RESEND_API_KEY ?? "" }, { to: email.to, subject: email.subject, html: email.html })
      .catch(() => false);
    if (!sent) console.error(`[cc-news] oznámení o vydání ${meta.weekLabel} (item ${itemId}) se neodeslalo; článek je vydaný`);
  }
  console.log(`[cc-news] ${meta.weekLabel} (item ${itemId}) vydáno automaticky, oznámení ${isLive ? (sent ? "odesláno" : "SELHALO") : "dry-run"}`);
  return { itemId, articlePath, approveUrl: "", email, mode: isLive ? "live" : "dry-run", sent, autopublished: true };
}

export type ApproveResult =
  | { ok: true; itemId: string; status: "published" }
  | { ok: false; reason: "invalid-token" | "unknown-item" | "nonce-mismatch" | "already-published" };

/**
 * Zpracuje klik na schvalovací link (W-005/W-006, R4). Ověří podpis tokenu
 * (přes verifyApprovalIntent), pak JEDNORÁZOVOST: nonce z tokenu musí sedět s
 * `approveNonce` na řádce. Při shodě PROMOTUJE rozpracovaný draft na živou
 * publikovanou verzi (zkopíruje draft KV blob → published KV), nastaví
 * `status=published`, `publishedAt`, srovná `contentHash` (z pending) a nonce
 * SMAŽE (druhý klik už neprojde → already-published). Druhá cesta k publikaci
 * je automatické vydání (autoPublishDraft), lidské schválení se nevyžaduje.
 */
export async function approveItem(
  db: Db,
  env: Pick<DraftEnv, "AUTH_INTERNAL_SECRET" | "KV">,
  token: string,
  now: Date
): Promise<ApproveResult> {
  const { verifyApprovalIntent } = await import("./approval");
  const intent = await verifyApprovalIntent(env, token, now.getTime());
  if (!intent) return { ok: false, reason: "invalid-token" };

  const rows = await db.select().from(ccNewsItem).where(eq(ccNewsItem.id, intent.itemId));
  if (rows.length === 0) return { ok: false, reason: "unknown-item" };
  const row = rows[0];

  // Nonce už smazaný (po dřívější publikaci) nebo nesedí → odmítnout.
  if (!row.approveNonce) return { ok: false, reason: "already-published" };
  if (row.approveNonce !== intent.nonce) return { ok: false, reason: "nonce-mismatch" };

  // Promote: rozpracovaný draft se stává živou publikovanou verzí.
  const draftMd = await env.KV.get(draftKvKey(intent.itemId));
  if (draftMd !== null) {
    await env.KV.put(publishedKvKey(intent.itemId), draftMd);
  }

  await db
    .update(ccNewsItem)
    .set({
      status: "published",
      publishedAt: now,
      approveNonce: null,
      // pending verze schválena → srovnat hash živé verze a vynulovat pending.
      ...(row.pendingContentHash ? { contentHash: row.pendingContentHash } : {}),
      pendingContentHash: null,
    })
    .where(eq(ccNewsItem.id, intent.itemId));

  return { ok: true, itemId: intent.itemId, status: "published" };
}
