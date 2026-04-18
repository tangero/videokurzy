import type { Auth } from "./lib/auth";

export interface Env {
  DB: D1Database;
  KV: KVNamespace;
  WEBHOOK_QUEUE: Queue;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  RESEND_API_KEY: string;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  BUNNY_API_KEY: string;
  BUNNY_LIBRARY_ID: string;
  BUNNY_TOKEN_KEY: string;
  FIO_API_TOKEN: string;
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
