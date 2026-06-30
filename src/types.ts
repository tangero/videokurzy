import type { Auth } from "./lib/auth";

export interface Env {
  DB: D1Database;
  KV: KVNamespace;
  WEBHOOK_QUEUE: Queue;
  AUTH_INTERNAL_SECRET: string;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  RESEND_API_KEY: string;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  BUNNY_API_KEY: string;
  BUNNY_LIBRARY_ID: string;
  BUNNY_TOKEN_KEY: string;
  BUNNY_PULL_ZONE?: string;
  BUNNY_PULL_ZONE_TOKEN?: string;
  FAKTUROID_CLIENT_ID?: string;
  FAKTUROID_CLIENT_SECRET?: string;
  FIO_API_TOKEN: string;
  // FIO proxy (rock8.cloud) — relay obcházející CF Workers chybu 525 (FIO neumí
  // ALPN). Když je FIO_PROXY_URL nastaveno, volá se proxy místo přímého FIO API;
  // FIO token pak žije na proxy a worker se autentizuje FIO_PROXY_SECRET.
  FIO_PROXY_URL?: string;
  FIO_PROXY_SECRET?: string;
  // Creditas Bank API — Bearer klíč + systémový accountId účtu, ke kterému patří.
  CREDITAS_API_TOKEN?: string;
  CREDITAS_IDENTIFIKATOR?: string;
  COOKIE_DOMAIN?: string;
  VIBECODING_PARTNER_KEY?: string;
  // Služba „Novinky v Claude Code" — redakční LLM vrstva přes OpenRouter.
  OPENROUTER_API_KEY?: string;
  CC_NEWS_LLM?: string;        // „1" zapne LLM redakční vrstvu
  CC_NEWS_LLM_MODEL?: string;  // override modelu (default anthropic/claude-sonnet-4.6)
  CC_NEWS_DRY_RUN?: string;    // „0" by povolil live odeslání (ve fázi 1 zakázáno)
  // ─── Konverzní měření (reklamní platformy) — viz KONVERZE-PLAN.md ──
  // Meta Conversions API. PIXEL_ID je veřejné, CAPI_TOKEN je server-only secret.
  // Když chybí, Meta se nereportuje. TEST_EVENT_CODE jen pro testování (v produkci NESMÍ zůstat).
  META_PIXEL_ID?: string;
  META_CAPI_TOKEN?: string;
  META_API_VERSION?: string;   // override verze Graph API (default v conversions.ts)
  META_TEST_EVENT_CODE?: string;
  // Sklik konverzní/retargeting ID (veřejné, jde do HTML). Client-side conversionHit.
  SKLIK_CONVERSION_ID?: string;
  // Google gtag ID (G-... GA4 nebo AW-... Ads). Veřejné, client-side za consentem.
  GTAG_ID?: string;
  // Google Ads Offline / Data Manager — vše server-only. Aktivace až po ověření
  // allowlistu dev tokenu (token řeší uživatel zvlášť). Když chybí, Google se neclaimuje.
  GOOGLE_ADS_CUSTOMER_ID?: string;
  GOOGLE_ADS_DEVELOPER_TOKEN?: string;
  GOOGLE_ADS_LOGIN_CUSTOMER_ID?: string; // MCC bez pomlček
  GOOGLE_ADS_OAUTH_CLIENT_ID?: string;
  GOOGLE_ADS_OAUTH_CLIENT_SECRET?: string;
  GOOGLE_ADS_OAUTH_REFRESH_TOKEN?: string;
  GOOGLE_ADS_CONVERSION_ACTION_ID?: string;
}

export type Variables = {
  auth: Auth;
  user: {
    id: string;
    email: string;
    name: string | null;
    role: string;
  } | null;
};
