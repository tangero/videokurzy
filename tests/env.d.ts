/// <reference path="../node_modules/@cloudflare/vitest-pool-workers/types/cloudflare-test.d.ts" />

declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    KV: KVNamespace;
    TEST_MIGRATIONS: import("cloudflare:test").D1Migration[];
    AUTH_INTERNAL_SECRET: string;
    BETTER_AUTH_SECRET: string;
    BETTER_AUTH_URL: string;
    RESEND_API_KEY: string;
  }
}
