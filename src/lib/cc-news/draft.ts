// Uložení redakčního konceptu + příprava schvalovacího e-mailu (W-005, R3/R4).
//
// Tok: redakční editor (W-004) vyrobí markdown → tady ho uložíme jako draft a
// vygenerujeme JEDNORÁZOVÝ podepsaný schvalovací link (W-005). V dry-run režimu
// (výchozí; mantinel kontraktu) se e-mail NEodesílá — jen sestaví a vrátí, aby
// šel ověřit v testu. Publikace nastává až po lidském kliknutí na link (W-006).
//
// „Uložení do repa": skutečný markdown se v běhu ukládá do KV (artefakt), na
// řádce cc_news_item se zapíše `articlePath` (zamýšlená cesta v repu) a
// `approveNonce` (jednorázovost schválení). Reálný commit na GitHub je mimo
// dry-run rozsah (mantinel: jen branch/PR, žádné nasazení).

import { eq } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";
import { nanoid } from "nanoid";
import { ccNewsItem } from "../../db/schema";
import { ccNewsApprovalHtml, sendEmail } from "../email";
import { ADMIN_EMAILS } from "../../config/admin";
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

  // 2) Nonce + articlePath na řádku; status zůstává draft.
  const nonce = nanoid();
  const articlePath = articleRepoPath(meta.slug);
  await db
    .update(ccNewsItem)
    .set({ articlePath, approveNonce: nonce, status: "draft" })
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
  const email = {
    to: ADMIN_EMAILS.slice(),
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

  // Live: reálné odeslání přes Resend (sdílený sendEmail). Adminům jen jeden
  // e-mail (Resend přijme pole adres). Selhání odeslání NEbrání tomu, aby byl
  // koncept a approve link připraven — schvalovat lze i z logu / přímého odkazu.
  const sent = await sendEmail(
    { RESEND_API_KEY: env.RESEND_API_KEY ?? "" },
    { to: email.to, subject: email.subject, html: email.html },
  );
  console.log(
    `[cc-news] LIVE schvalovací e-mail pro ${meta.weekLabel} (item ${itemId}) — ` +
      `odeslání=${sent ? "ok" : "selhalo"}, příjemci=${email.to.length}.`
  );
  return { itemId, articlePath, approveUrl, email, mode: "live", sent };
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
 * SMAŽE (druhý klik už neprojde → already-published). Lidské schválení je
 * jediná cesta k publikaci (mantinel).
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
