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
