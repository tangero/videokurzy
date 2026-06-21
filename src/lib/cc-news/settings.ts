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

type Db = ReturnType<typeof drizzle>;

/** Klíč v `site_config` pro admin přepínač reálného odesílání. */
export const CC_NEWS_LIVE_SEND_KEY = "cc_news_live_send";

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
}

/**
 * Zda se mají e-maily reálně odeslat. Vyžaduje OBĚ brány: env přepínač i admin
 * nastavení. Jinak dry-run (mantinel fáze 1).
 */
export async function isCcNewsLiveSend(db: Db, env: LiveSendEnv): Promise<boolean> {
  if (env.CC_NEWS_DRY_RUN !== "0") return false;
  return getCcNewsLiveSend(db);
}
