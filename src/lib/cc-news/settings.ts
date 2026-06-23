// Admin přepínač reálného odesílání e-mailů služby „Novinky v Claude Code".
//
// Mantinel fáze 1: reálné odeslání je defaultně VYPNUTÉ. Aby se zapnulo, musí
// platit OBĚ podmínky:
//   1) env `CC_NEWS_DRY_RUN === "0"`  (provozní přepínač / secret),
//   2) admin nastavení `cc_news_live_send === "true"` v `site_config`.
// Dokud kterákoli chybí, běží dry-run (e-maily se NEodesílají). Dvě nezávislé
// brány = produkce nejde zapnout omylem jedním přepnutím.

import { eq } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";
import { siteConfig } from "../../db/schema";
import { ADMIN_EMAILS } from "../../config/admin";

type Db = ReturnType<typeof drizzle>;

/** Klíč v `site_config` pro admin přepínač reálného odesílání. */
export const CC_NEWS_LIVE_SEND_KEY = "cc_news_live_send";

/** Klíč v `site_config` pro příjemce schvalovacího e-mailu (řádky/čárky). */
export const CC_NEWS_APPROVAL_EMAILS_KEY = "cc_news_approval_emails";

/** Základní sanity check tvaru e-mailu (local@domain.tld). */
const isLikelyEmail = (email: string): boolean =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

/** Rozseká uložený seznam (oddělený čárkami / novými řádky / středníky) na e-maily. */
export function parseApprovalEmails(raw: string | null | undefined): string[] {
  return [...new Set(
    (raw ?? "")
      .split(/[\n,;]+/)
      .map((s) => s.trim().toLowerCase())
      .filter((s) => isLikelyEmail(s)),
  )];
}

/**
 * Příjemci schvalovacího e-mailu „Novinky v Claude Code". Bere se z `site_config`
 * (klíč cc_news_approval_emails, nastavitelné v /admin/settings); když není nebo
 * je prázdný/neplatný, FALLBACK na natvrdo zadané `ADMIN_EMAILS`. Záměrně oddělené
 * od admin OPRÁVNĚNÍ (auth.ts): měnit, kam chodí notifikace, smí admin přes UI,
 * měnit, kdo JE admin, ne — to zůstává v kódu.
 */
export async function getCcNewsApprovalEmails(db: Db): Promise<string[]> {
  const rows = await db
    .select({ value: siteConfig.value })
    .from(siteConfig)
    .where(eq(siteConfig.key, CC_NEWS_APPROVAL_EMAILS_KEY));
  const parsed = parseApprovalEmails(rows[0]?.value);
  return parsed.length > 0 ? parsed : [...ADMIN_EMAILS];
}

/** Přečte admin přepínač (default false, když řádek chybí). */
export async function getCcNewsLiveSend(db: Db): Promise<boolean> {
  const rows = await db
    .select({ value: siteConfig.value })
    .from(siteConfig)
    .where(eq(siteConfig.key, CC_NEWS_LIVE_SEND_KEY));
  return rows[0]?.value === "true";
}

interface LiveSendEnv {
  CC_NEWS_DRY_RUN?: string;
  RESEND_API_KEY?: string;
}

/**
 * Zda se mají e-maily reálně odeslat. Vyžaduje OBĚ brány: env přepínač i admin
 * nastavení, a navíc neprázdný RESEND_API_KEY (bez něj by Resend dostal prázdný
 * Bearer a tiše selhal — radši zůstat v dry-run). Jinak dry-run (mantinel f. 1).
 */
export async function isCcNewsLiveSend(db: Db, env: LiveSendEnv): Promise<boolean> {
  if (env.CC_NEWS_DRY_RUN !== "0") return false;
  if (!env.RESEND_API_KEY) return false;
  return getCcNewsLiveSend(db);
}
