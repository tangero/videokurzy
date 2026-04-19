/// <reference path="../node_modules/@cloudflare/vitest-pool-workers/types/cloudflare-test.d.ts" />

declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    KV: KVNamespace;
  }
}
