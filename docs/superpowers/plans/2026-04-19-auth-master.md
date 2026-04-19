# Auth master — implementační plán (Plan A)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rozšířit Better Auth ve videokurzy o multi-email identity, interní API pro konzumenty (vibecoding-site přes Cloudflare Service Binding), audit logování, cross-subdoménové session cookies a OIDC Provider plugin pro budoucí cross-domain konzumenty.

**Architecture:** Videokurzy Worker na `kurz.vibecoding.cz` zůstává Better Auth master s D1 `videokurzy-db`. Přidá dvě nová rozhraní: (1) **internal API** `/internal/auth/*` chráněné shared secretem pro service-binding volání z CF Workerů ve stejném ekosystému, (2) **OIDC Provider** endpointy pro budoucí externí konzumenty (marigold.cz). Cookies získají `Domain=.vibecoding.cz` pro sdílení přes subdomény. Multi-email model umožňuje uživateli přidávat verified sekundární e-maily, které slouží jako záložní kanál pro magic link.

**Tech Stack:** Hono 4.x, Better Auth 1.6.5 + magic-link + (nově) oidc-provider plugin, Drizzle ORM 0.45.2, Cloudflare D1, KV (rate-limit), Resend (email), Vitest + @cloudflare/vitest-pool-workers (nově pro testing).

**Spec:** `/Users/patrickzandl/GitHub/vibecoding-site/docs/superpowers/specs/2026-04-19-user-profile-design.md` (v vibecoding-site repu; tento plán implementuje sekce 2–5, 9, 10 specu).

---

## Pracovní předpoklady

- Pracujeme na `main` branchi, pushujeme přímo (není otevřen release flow). Pokud existuje stagingové prostředí, nasazení na staging proběhne před produkcí (manuálně, mimo scope tohoto plánu).
- Všechny migrace aplikujeme **lokálně** (`db:migrate`) nejdřív a testujeme lokálně. Na produkci (`db:migrate:prod`) až po zelených testech.
- `BETTER_AUTH_URL` v produkci je `https://kurz.vibecoding.cz`. V dev `http://localhost:8787`.
- `AUTH_INTERNAL_SECRET` je nový env var (secret) sdílený s vibecoding-site. Musí být vygenerován před Task 4.
- Pro testování používáme `@cloudflare/vitest-pool-workers`, který běží v reálném CF runtime s miniflare.

## Pořadí tasků

0. Testing foundation (vitest + workers pool)
1. Schema + migrace (user_emails, user_identity_audit, oidc_client, user.recovery_banner_dismissed_until, user.role už existuje)
2. User emails core library
3. Audit logging library
4. Internal auth middleware (shared secret)
5. Callback URL allowlist helper
6. Internal endpoint: POST `/internal/auth/magic-link`
7. Internal endpoint: POST `/internal/auth/verify-token`
8. Internal endpoint: GET `/internal/auth/me`
9. Internal endpoint: POST `/internal/auth/revoke`
10. Profile emails API (add/list/promote/remove)
11. Recovery banner dismiss endpoint
12. Cookie domain = `.vibecoding.cz` v produkci
13. OIDC Provider plugin (minimální nasazení)
14. Dokumentace `docs/auth-master.md` + aktualizace `CLAUDE.md`

Každá úloha končí zeleným typecheckem (`npm run typecheck`) a commitem.

---

## Task 0: Testing foundation

**Cíl:** Založit Vitest s Cloudflare Workers poolem, aby šlo testovat kód s reálným D1 / KV bindingem.

**Files:**
- Create: `vitest.config.ts`
- Modify: `package.json` (devDeps + scripts)
- Modify: `wrangler.toml` (test env)
- Create: `tests/smoke.test.ts`
- Create: `tsconfig.test.json`

- [ ] **Step 1: Nainstalovat vitest a workers pool**

```bash
cd /Users/patrickzandl/GitHub/videokurzy
npm install -D vitest @cloudflare/vitest-pool-workers
```

Expected: successful install, `package-lock.json` updated.

- [ ] **Step 2: Přidat test skripty do `package.json`**

Edit `package.json`, sekce `scripts`, přidat za `typecheck`:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: Vytvořit `vitest.config.ts`**

```typescript
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.toml" },
        miniflare: {
          compatibilityFlags: ["nodejs_compat"],
        },
      },
    },
  },
});
```

- [ ] **Step 4: Rozšířit `wrangler.toml` o test env (izolovaná D1)**

Přidat na konec `wrangler.toml`:

```toml
[env.test]
[[env.test.d1_databases]]
binding = "DB"
database_name = "videokurzy-db-test"
database_id = "00000000-0000-0000-0000-000000000000"
migrations_dir = "drizzle/migrations"

[[env.test.kv_namespaces]]
binding = "KV"
id = "test-kv"
```

Poznámka: `database_id` u test env není použit (miniflare spouští SQLite in-memory), ale pole je povinné.

- [ ] **Step 5: Vytvořit `tsconfig.test.json`**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "types": ["@cloudflare/workers-types", "@cloudflare/vitest-pool-workers"]
  },
  "include": ["tests/**/*.ts", "src/**/*.ts"]
}
```

- [ ] **Step 6: Smoke test, aby CI mělo co běžet**

Create `tests/smoke.test.ts`:

```typescript
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("smoke", () => {
  it("has D1 binding", () => {
    expect(env.DB).toBeDefined();
  });

  it("has KV binding", () => {
    expect(env.KV).toBeDefined();
  });
});
```

- [ ] **Step 7: Spustit testy, ověřit že projdou**

Run: `npm test`
Expected: 2 passed.

- [ ] **Step 8: Commit**

```bash
git add vitest.config.ts package.json package-lock.json wrangler.toml tsconfig.test.json tests/smoke.test.ts
git commit -m "test: add vitest + cloudflare workers pool"
```

---

## Task 1: Schema + migrace (multi-email, audit, oidc_client)

**Cíl:** Přidat nové tabulky (`user_emails`, `user_identity_audit`, `oidc_client`), sloupec `user.recovery_banner_dismissed_until`, a seedovat existující users do `user_emails` jako primary.

**Files:**
- Modify: `src/db/auth-schema.ts` (přidat sloupec do user)
- Create: `src/db/identity-schema.ts` (nové tabulky)
- Modify: `drizzle.config.ts` (přidat nový schema file)
- Create: `drizzle/migrations/000X_identity_extension.sql` (vygenerovaná)

- [ ] **Step 1: Přidat `recovery_banner_dismissed_until` do user schema**

Edit `src/db/auth-schema.ts`, přidat do `user` tabulky za řádek s `role`:

```typescript
recoveryBannerDismissedUntil: integer("recoveryBannerDismissedUntil", { mode: "timestamp" }),
```

- [ ] **Step 2: Vytvořit `src/db/identity-schema.ts`**

```typescript
import { integer, sqliteTable, text, index } from "drizzle-orm/sqlite-core";
import { user } from "./auth-schema";

export const userEmails = sqliteTable(
  "user_emails",
  {
    id: text("id").primaryKey(),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    email: text("email").notNull().unique(),
    verifiedAt: integer("verifiedAt", { mode: "timestamp" }).notNull(),
    isPrimary: integer("isPrimary", { mode: "boolean" }).notNull().default(false),
    addedAt: integer("addedAt", { mode: "timestamp" }).notNull(),
    addedVia: text("addedVia", {
      enum: ["signup", "self-add", "recovery", "admin"],
    }).notNull(),
  },
  (t) => [index("idx_user_emails_user").on(t.userId)],
);

export const userIdentityAudit = sqliteTable(
  "user_identity_audit",
  {
    id: text("id").primaryKey(),
    userId: text("userId").notNull(),
    action: text("action", {
      enum: [
        "email_added",
        "email_removed",
        "email_promoted_primary",
        "email_verified",
        "recovery_approved",
        "recovery_banner_dismissed",
      ],
    }).notNull(),
    actor: text("actor").notNull(), // 'self' | 'admin:<email>' | 'system'
    details: text("details"), // JSON
    createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  },
  (t) => [index("idx_audit_user").on(t.userId, t.createdAt)],
);

export const oidcClient = sqliteTable("oidc_client", {
  id: text("id").primaryKey(),
  secretHash: text("secretHash").notNull(),
  name: text("name").notNull(),
  redirectUris: text("redirectUris").notNull(), // JSON array
  allowedScopes: text("allowedScopes").notNull().default("openid profile email"),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
});
```

- [ ] **Step 3: Zaregistrovat nové schéma v `drizzle.config.ts`**

Edit `drizzle.config.ts`, pole `schema`:

```typescript
schema: ["src/db/auth-schema.ts", "src/db/schema.ts", "src/db/identity-schema.ts"],
```

- [ ] **Step 4: Vygenerovat migraci**

```bash
npm run db:generate
```

Expected: vytvoří `drizzle/migrations/0004_*.sql` s `ALTER TABLE user`, `CREATE TABLE user_emails`, `CREATE TABLE user_identity_audit`, `CREATE TABLE oidc_client`.

- [ ] **Step 5: Ověřit, že migrace obsahuje očekávané statements**

Run: `cat drizzle/migrations/0004_*.sql`
Expected (kontroluj ručně): ALTER user + CREATE user_emails + CREATE user_identity_audit + CREATE oidc_client + CREATE INDEX.

Pokud Drizzle negeneruje `DEFAULT` pro `addedVia` správně, ručně upravit soubor (není povinné).

- [ ] **Step 6: Přidat backfill do migrace**

Do konce souboru `drizzle/migrations/0004_*.sql` přidat ručně:

```sql
-- Backfill: seed primary email records from existing user table
INSERT INTO user_emails (id, userId, email, verifiedAt, isPrimary, addedAt, addedVia)
SELECT
  lower(hex(randomblob(16))) AS id,
  u.id AS userId,
  u.email AS email,
  u.createdAt AS verifiedAt,
  1 AS isPrimary,
  u.createdAt AS addedAt,
  'signup' AS addedVia
FROM user u
WHERE NOT EXISTS (SELECT 1 FROM user_emails ue WHERE ue.userId = u.id);
```

- [ ] **Step 7: Aplikovat migraci lokálně**

```bash
npm run db:migrate
```

Expected: "🌀 Mapping SQL input into chunks", 1 migration applied.

- [ ] **Step 8: Typecheck**

```bash
npm run typecheck
```

Expected: žádné chyby.

- [ ] **Step 9: Commit**

```bash
git add src/db/auth-schema.ts src/db/identity-schema.ts drizzle.config.ts drizzle/migrations/0004_*
git commit -m "feat(db): add user_emails, user_identity_audit, oidc_client + user.recoveryBannerDismissedUntil"
```

---

## Task 2: User emails core library

**Cíl:** Čisté funkce pro add/list/remove/promote/findByEmail, s invariantem „max jeden primary per user", case-insensitive email lookup.

**Files:**
- Create: `src/lib/user-emails.ts`
- Create: `tests/lib/user-emails.test.ts`

- [ ] **Step 1: Napsat testy**

Create `tests/lib/user-emails.test.ts`:

```typescript
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/d1";
import { nanoid } from "nanoid";
import * as authSchema from "../../src/db/auth-schema";
import * as identitySchema from "../../src/db/identity-schema";
import {
  addUserEmail,
  listUserEmails,
  promotePrimary,
  removeUserEmail,
  findUserIdByEmail,
  normalizeEmail,
} from "../../src/lib/user-emails";

async function seedUser(db: ReturnType<typeof drizzle>, email: string) {
  const userId = nanoid();
  await db.insert(authSchema.user).values({
    id: userId,
    email: email.toLowerCase(),
    emailVerified: true,
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  await db.insert(identitySchema.userEmails).values({
    id: nanoid(),
    userId,
    email: email.toLowerCase(),
    verifiedAt: new Date(),
    isPrimary: true,
    addedAt: new Date(),
    addedVia: "signup",
  });
  return userId;
}

describe("user-emails lib", () => {
  let db: ReturnType<typeof drizzle>;

  beforeEach(async () => {
    db = drizzle(env.DB, { schema: { ...authSchema, ...identitySchema } });
  });

  it("normalizeEmail lowercases and trims", () => {
    expect(normalizeEmail("  FOO@Bar.CZ ")).toBe("foo@bar.cz");
  });

  it("adds a secondary email and lists both", async () => {
    const userId = await seedUser(db, "primary@test.cz");
    await addUserEmail(db, { userId, email: "Secondary@test.cz", via: "self-add" });

    const emails = await listUserEmails(db, userId);
    expect(emails.map((e) => e.email).sort()).toEqual([
      "primary@test.cz",
      "secondary@test.cz",
    ]);
    expect(emails.find((e) => e.email === "primary@test.cz")!.isPrimary).toBe(true);
  });

  it("rejects duplicate email", async () => {
    const userId = await seedUser(db, "dup@test.cz");
    await expect(
      addUserEmail(db, { userId, email: "dup@test.cz", via: "self-add" }),
    ).rejects.toThrow(/already/i);
  });

  it("promotes secondary to primary, demotes old", async () => {
    const userId = await seedUser(db, "old@test.cz");
    await addUserEmail(db, { userId, email: "new@test.cz", via: "self-add" });

    await promotePrimary(db, { userId, email: "new@test.cz" });

    const emails = await listUserEmails(db, userId);
    expect(emails.find((e) => e.email === "new@test.cz")!.isPrimary).toBe(true);
    expect(emails.find((e) => e.email === "old@test.cz")!.isPrimary).toBe(false);
  });

  it("refuses to remove the only remaining email", async () => {
    const userId = await seedUser(db, "only@test.cz");
    await expect(
      removeUserEmail(db, { userId, email: "only@test.cz" }),
    ).rejects.toThrow(/only email/i);
  });

  it("refuses to remove primary while secondary exists", async () => {
    const userId = await seedUser(db, "primary@test.cz");
    await addUserEmail(db, { userId, email: "sec@test.cz", via: "self-add" });
    await expect(
      removeUserEmail(db, { userId, email: "primary@test.cz" }),
    ).rejects.toThrow(/primary/i);
  });

  it("findUserIdByEmail matches case-insensitive", async () => {
    const userId = await seedUser(db, "case@test.cz");
    const found = await findUserIdByEmail(db, "CASE@Test.CZ");
    expect(found).toBe(userId);
  });
});
```

- [ ] **Step 2: Spustit, ověřit, že FAIL („Cannot find module")**

Run: `npm test -- tests/lib/user-emails.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implementovat `src/lib/user-emails.ts`**

```typescript
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { nanoid } from "nanoid";
import { userEmails } from "../db/identity-schema";

type Db = ReturnType<typeof drizzle>;
type AddVia = "signup" | "self-add" | "recovery" | "admin";

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export async function addUserEmail(
  db: Db,
  opts: { userId: string; email: string; via: AddVia; verified?: boolean },
): Promise<void> {
  const email = normalizeEmail(opts.email);
  const existing = await db
    .select()
    .from(userEmails)
    .where(eq(userEmails.email, email))
    .get();
  if (existing) {
    throw new Error(`Email already registered: ${email}`);
  }
  const now = new Date();
  await db.insert(userEmails).values({
    id: nanoid(),
    userId: opts.userId,
    email,
    verifiedAt: opts.verified === false ? new Date(0) : now,
    isPrimary: false,
    addedAt: now,
    addedVia: opts.via,
  });
}

export async function listUserEmails(db: Db, userId: string) {
  return db
    .select()
    .from(userEmails)
    .where(eq(userEmails.userId, userId))
    .all();
}

export async function findUserIdByEmail(
  db: Db,
  email: string,
): Promise<string | null> {
  const row = await db
    .select()
    .from(userEmails)
    .where(eq(userEmails.email, normalizeEmail(email)))
    .get();
  return row?.userId ?? null;
}

export async function promotePrimary(
  db: Db,
  opts: { userId: string; email: string },
): Promise<void> {
  const email = normalizeEmail(opts.email);
  const target = await db
    .select()
    .from(userEmails)
    .where(and(eq(userEmails.userId, opts.userId), eq(userEmails.email, email)))
    .get();
  if (!target) throw new Error(`Email not found for user: ${email}`);
  if (target.verifiedAt.getTime() === 0) {
    throw new Error(`Cannot promote unverified email: ${email}`);
  }

  await db.batch([
    db
      .update(userEmails)
      .set({ isPrimary: false })
      .where(eq(userEmails.userId, opts.userId)),
    db
      .update(userEmails)
      .set({ isPrimary: true })
      .where(
        and(eq(userEmails.userId, opts.userId), eq(userEmails.email, email)),
      ),
  ]);
}

export async function removeUserEmail(
  db: Db,
  opts: { userId: string; email: string },
): Promise<void> {
  const email = normalizeEmail(opts.email);
  const rows = await listUserEmails(db, opts.userId);
  if (rows.length <= 1) {
    throw new Error("Cannot remove the only email on the account");
  }
  const target = rows.find((r) => r.email === email);
  if (!target) throw new Error(`Email not found: ${email}`);
  if (target.isPrimary) {
    throw new Error(
      "Cannot remove primary email; promote another email first",
    );
  }
  await db
    .delete(userEmails)
    .where(
      and(eq(userEmails.userId, opts.userId), eq(userEmails.email, email)),
    );
}
```

- [ ] **Step 4: Spustit testy, ověřit PASS**

Run: `npm test -- tests/lib/user-emails.test.ts`
Expected: 6 passed.

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck
git add src/lib/user-emails.ts tests/lib/user-emails.test.ts
git commit -m "feat(lib): user-emails CRUD with primary invariant"
```

---

## Task 3: Audit logging library

**Cíl:** Tenká obálka pro zápis do `user_identity_audit` s JSON serializací `details`.

**Files:**
- Create: `src/lib/audit.ts`
- Create: `tests/lib/audit.test.ts`

- [ ] **Step 1: Test**

Create `tests/lib/audit.test.ts`:

```typescript
import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";
import { userIdentityAudit } from "../../src/db/identity-schema";
import { logIdentityEvent } from "../../src/lib/audit";

describe("audit lib", () => {
  it("writes an audit record with serialized details", async () => {
    const db = drizzle(env.DB);
    await logIdentityEvent(db, {
      userId: "u1",
      action: "email_added",
      actor: "self",
      details: { email: "x@y.cz" },
    });
    const rows = await db
      .select()
      .from(userIdentityAudit)
      .where(eq(userIdentityAudit.userId, "u1"))
      .all();
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe("email_added");
    expect(JSON.parse(rows[0].details!)).toEqual({ email: "x@y.cz" });
  });
});
```

- [ ] **Step 2: Spustit, ověřit FAIL**

Run: `npm test -- tests/lib/audit.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implementace `src/lib/audit.ts`**

```typescript
import { drizzle } from "drizzle-orm/d1";
import { nanoid } from "nanoid";
import { userIdentityAudit } from "../db/identity-schema";

type Db = ReturnType<typeof drizzle>;

export type IdentityAction =
  | "email_added"
  | "email_removed"
  | "email_promoted_primary"
  | "email_verified"
  | "recovery_approved"
  | "recovery_banner_dismissed";

export async function logIdentityEvent(
  db: Db,
  event: {
    userId: string;
    action: IdentityAction;
    actor: string; // 'self' | `admin:${email}` | 'system'
    details?: Record<string, unknown>;
  },
): Promise<void> {
  await db.insert(userIdentityAudit).values({
    id: nanoid(),
    userId: event.userId,
    action: event.action,
    actor: event.actor,
    details: event.details ? JSON.stringify(event.details) : null,
    createdAt: new Date(),
  });
}
```

- [ ] **Step 4: PASS + commit**

```bash
npm test -- tests/lib/audit.test.ts
npm run typecheck
git add src/lib/audit.ts tests/lib/audit.test.ts
git commit -m "feat(lib): identity audit logger"
```

---

## Task 4: Internal auth middleware (shared secret)

**Cíl:** Middleware, který odmítne volání do `/internal/auth/*` bez hlavičky `X-Internal-Secret: <AUTH_INTERNAL_SECRET>`. Timing-safe porovnání.

**Files:**
- Create: `src/middleware/internal-auth.ts`
- Create: `tests/middleware/internal-auth.test.ts`
- Modify: `src/types.ts` (přidat `AUTH_INTERNAL_SECRET` do Env)

- [ ] **Step 1: Přidat env var do typů**

Edit `src/types.ts`, do interface `Env`:

```typescript
AUTH_INTERNAL_SECRET: string;
```

- [ ] **Step 2: Test**

Create `tests/middleware/internal-auth.test.ts`:

```typescript
import { env } from "cloudflare:test";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { Env } from "../../src/types";
import { requireInternalSecret } from "../../src/middleware/internal-auth";

function buildApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.use("/internal/*", requireInternalSecret);
  app.get("/internal/ping", (c) => c.json({ ok: true }));
  return app;
}

describe("requireInternalSecret", () => {
  it("403 without header", async () => {
    const res = await buildApp().request("/internal/ping", {}, env);
    expect(res.status).toBe(403);
  });

  it("403 with wrong secret", async () => {
    const res = await buildApp().request(
      "/internal/ping",
      { headers: { "X-Internal-Secret": "wrong" } },
      { ...env, AUTH_INTERNAL_SECRET: "correct" },
    );
    expect(res.status).toBe(403);
  });

  it("200 with correct secret", async () => {
    const res = await buildApp().request(
      "/internal/ping",
      { headers: { "X-Internal-Secret": "correct" } },
      { ...env, AUTH_INTERNAL_SECRET: "correct" },
    );
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 3: Ověřit FAIL**

Run: `npm test -- tests/middleware/internal-auth.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implementace `src/middleware/internal-auth.ts`**

```typescript
import { createMiddleware } from "hono/factory";
import type { Env } from "../types";

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export const requireInternalSecret = createMiddleware<{ Bindings: Env }>(
  async (c, next) => {
    const provided = c.req.header("X-Internal-Secret") ?? "";
    const expected = c.env.AUTH_INTERNAL_SECRET ?? "";
    if (!expected || !timingSafeEqual(provided, expected)) {
      return c.json({ error: "forbidden" }, 403);
    }
    await next();
  },
);
```

- [ ] **Step 5: PASS + commit**

```bash
npm test -- tests/middleware/internal-auth.test.ts
npm run typecheck
git add src/middleware/internal-auth.ts tests/middleware/internal-auth.test.ts src/types.ts
git commit -m "feat(middleware): internal shared-secret guard"
```

---

## Task 5: Callback URL allowlist

**Cíl:** Validátor `isAllowedCallback(url)`, který povolí jen `https://*.vibecoding.cz/...` a `http://localhost:*`.

**Files:**
- Create: `src/lib/callback-allowlist.ts`
- Create: `tests/lib/callback-allowlist.test.ts`

- [ ] **Step 1: Test**

```typescript
// tests/lib/callback-allowlist.test.ts
import { describe, expect, it } from "vitest";
import { isAllowedCallback } from "../../src/lib/callback-allowlist";

describe("isAllowedCallback", () => {
  it.each([
    ["https://vibecoding.cz/auth/verify", true],
    ["https://kurz.vibecoding.cz/auth/verify", true],
    ["https://any.sub.vibecoding.cz/x", true],
    ["http://localhost:4321/auth/verify", true],
    ["http://localhost/foo", true],
    ["https://evil.com/auth", false],
    ["https://vibecoding.cz.evil.com/x", false],
    ["javascript:alert(1)", false],
    ["not-a-url", false],
    ["", false],
  ])("%s -> %s", (input, expected) => {
    expect(isAllowedCallback(input)).toBe(expected);
  });
});
```

- [ ] **Step 2: FAIL check**

Run: `npm test -- tests/lib/callback-allowlist.test.ts`
Expected: module not found.

- [ ] **Step 3: Implementace `src/lib/callback-allowlist.ts`**

```typescript
export function isAllowedCallback(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol === "http:" && url.hostname === "localhost") return true;
  if (url.protocol !== "https:") return false;
  // vibecoding.cz nebo libovolná subdoména
  return url.hostname === "vibecoding.cz" || url.hostname.endsWith(".vibecoding.cz");
}
```

- [ ] **Step 4: PASS + commit**

```bash
npm test -- tests/lib/callback-allowlist.test.ts
git add src/lib/callback-allowlist.ts tests/lib/callback-allowlist.test.ts
git commit -m "feat(lib): callback URL allowlist"
```

---

## Task 6: POST /internal/auth/magic-link

**Cíl:** Interní endpoint, který vezme `{ email, callbackUrl }`, ověří allowlist, zavolá Better Auth `signIn.magicLink` s overrided callback URL. Pokud email neodpovídá žádnému user.id, magic link odešle na zadaný email (signup flow).

**Files:**
- Create: `src/routes/internal.tsx`
- Modify: `src/index.tsx` (registrovat router)
- Create: `tests/routes/internal-magic-link.test.ts`

- [ ] **Step 1: Vytvořit kostru routeru**

Create `src/routes/internal.tsx`:

```typescript
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { createAuth } from "../lib/auth";
import { isAllowedCallback } from "../lib/callback-allowlist";
import { requireInternalSecret } from "../middleware/internal-auth";
import type { Env } from "../types";

const internal = new Hono<{ Bindings: Env }>();

internal.use("/internal/*", requireInternalSecret);

internal.post("/internal/auth/magic-link", async (c) => {
  const body = await c.req.json<{ email?: string; callbackUrl?: string }>().catch(() => ({}));
  const email = body.email?.trim().toLowerCase();
  const callbackUrl = body.callbackUrl;
  if (!email || !callbackUrl) {
    return c.json({ error: "email and callbackUrl required" }, 400);
  }
  if (!isAllowedCallback(callbackUrl)) {
    return c.json({ error: "callbackUrl not allowed" }, 400);
  }

  const auth = createAuth(c.env, c.executionCtx);
  try {
    await auth.api.signInMagicLink({
      body: { email, callbackURL: callbackUrl },
    });
  } catch (err) {
    console.warn("[internal/magic-link] send failed", err);
    return c.json({ error: "send_failed" }, 502);
  }
  return c.json({ ok: true });
});

export default internal;
```

- [ ] **Step 2: Zaregistrovat v `src/index.tsx`**

Edit `src/index.tsx`, přidat `import internalRoutes from "./routes/internal";` a `app.route("/", internalRoutes);` za `app.route("/", leadRoutes);`.

- [ ] **Step 3: Test**

```typescript
// tests/routes/internal-magic-link.test.ts
import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("POST /internal/auth/magic-link", () => {
  it("403 without secret", async () => {
    const res = await SELF.fetch("https://test/internal/auth/magic-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "a@b.cz", callbackUrl: "https://vibecoding.cz/auth/verify" }),
    });
    expect(res.status).toBe(403);
  });

  it("400 when callback not allowed", async () => {
    const res = await SELF.fetch("https://test/internal/auth/magic-link", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Secret": env.AUTH_INTERNAL_SECRET,
      },
      body: JSON.stringify({ email: "a@b.cz", callbackUrl: "https://evil.com/x" }),
    });
    expect(res.status).toBe(400);
  });

  it("400 when email missing", async () => {
    const res = await SELF.fetch("https://test/internal/auth/magic-link", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Secret": env.AUTH_INTERNAL_SECRET,
      },
      body: JSON.stringify({ callbackUrl: "https://vibecoding.cz/auth/verify" }),
    });
    expect(res.status).toBe(400);
  });
});
```

Přidat do `wrangler.toml` test env secret:

```toml
[env.test.vars]
AUTH_INTERNAL_SECRET = "test-secret"
BETTER_AUTH_SECRET = "test-better-auth-secret"
BETTER_AUTH_URL = "http://localhost:8787"
RESEND_API_KEY = "test-resend-key"
STRIPE_SECRET_KEY = "test-stripe"
STRIPE_WEBHOOK_SECRET = "test-webhook"
BUNNY_API_KEY = "test-bunny"
BUNNY_LIBRARY_ID = "test-library"
BUNNY_TOKEN_KEY = "test-token-key"
FIO_API_TOKEN = "dev"
```

- [ ] **Step 4: PASS**

Run: `npm test -- tests/routes/internal-magic-link.test.ts`
Expected: 3 passed.

Pozn.: happy-path test (úspěšné odeslání) vynechán, protože by zavolal reálný Resend. Integrační test toho typu doplníme ručně v Task 14 QA.

- [ ] **Step 5: Commit**

```bash
npm run typecheck
git add src/routes/internal.tsx src/index.tsx tests/routes/internal-magic-link.test.ts wrangler.toml
git commit -m "feat(internal): POST /internal/auth/magic-link"
```

---

## Task 7: POST /internal/auth/verify-token

**Cíl:** Konzument předá `{ token }` z query stringu magic linku. Endpoint ověří token Better Authem, vrátí `{ user, sessionToken, expiresAt }` a nastaví `Set-Cookie` s doménou z env var.

**Files:**
- Modify: `src/routes/internal.tsx`
- Modify: `src/lib/user-emails.ts` (přidat `ensureUserEmailRecord` pro auto-seed při signup)
- Modify: `src/lib/auth.ts` (hook `onSignUp` → vytvoří user_emails primary row)
- Create: `tests/routes/internal-verify-token.test.ts`

- [ ] **Step 1: Doplnit `ensureUserEmailRecord` do `src/lib/user-emails.ts`**

Přidat na konec:

```typescript
export async function ensureUserEmailRecord(
  db: Db,
  opts: { userId: string; email: string },
): Promise<void> {
  const email = normalizeEmail(opts.email);
  const existing = await db
    .select()
    .from(userEmails)
    .where(eq(userEmails.email, email))
    .get();
  if (existing) return;
  const now = new Date();
  await db.insert(userEmails).values({
    id: nanoid(),
    userId: opts.userId,
    email,
    verifiedAt: now,
    isPrimary: true,
    addedAt: now,
    addedVia: "signup",
  });
}
```

- [ ] **Step 2: Hook v Better Auth konfiguraci**

Edit `src/lib/auth.ts`, v `betterAuth({...})` přidat:

```typescript
databaseHooks: {
  user: {
    create: {
      after: async (createdUser) => {
        const db = drizzle(env.DB);
        await ensureUserEmailRecord(db, {
          userId: createdUser.id,
          email: createdUser.email,
        });
      },
    },
  },
},
```

a nahoře přidat `import { ensureUserEmailRecord } from "./user-emails";`.

- [ ] **Step 3: Endpoint verify-token**

Edit `src/routes/internal.tsx`, přidat za magic-link:

```typescript
internal.post("/internal/auth/verify-token", async (c) => {
  const body = await c.req.json<{ token?: string }>().catch(() => ({}));
  if (!body.token) return c.json({ error: "token required" }, 400);

  const auth = createAuth(c.env, c.executionCtx);
  try {
    const result = await auth.api.magicLinkVerify({
      query: { token: body.token },
      asResponse: true,
    });
    // Better Auth returns a Response with Set-Cookie and redirect.
    // We need to extract the cookie and user for the consumer.
    const setCookie = result.headers.get("set-cookie");
    const session = await auth.api.getSession({ headers: result.headers });
    if (!session?.user) {
      return c.json({ error: "invalid_token" }, 401);
    }
    return c.json({
      user: {
        id: session.user.id,
        email: session.user.email,
        name: session.user.name ?? null,
        role: (session.user as { role?: string }).role ?? "user",
      },
      sessionToken: session.session.token,
      expiresAt: session.session.expiresAt,
      setCookie,
    });
  } catch (err) {
    console.warn("[internal/verify-token]", err);
    return c.json({ error: "invalid_token" }, 401);
  }
});
```

- [ ] **Step 4: Test**

```typescript
// tests/routes/internal-verify-token.test.ts
import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("POST /internal/auth/verify-token", () => {
  it("400 without token", async () => {
    const res = await SELF.fetch("https://test/internal/auth/verify-token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Secret": env.AUTH_INTERNAL_SECRET,
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("401 with invalid token", async () => {
    const res = await SELF.fetch("https://test/internal/auth/verify-token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Secret": env.AUTH_INTERNAL_SECRET,
      },
      body: JSON.stringify({ token: "invalid-token-xyz" }),
    });
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 5: PASS + commit**

```bash
npm test -- tests/routes/internal-verify-token.test.ts
npm run typecheck
git add src/routes/internal.tsx src/lib/user-emails.ts src/lib/auth.ts tests/routes/internal-verify-token.test.ts
git commit -m "feat(internal): POST /internal/auth/verify-token + user_emails seed on signup"
```

---

## Task 8: GET /internal/auth/me

**Cíl:** Konzument předá session cookie (přes header `Cookie`), endpoint vrátí aktuálního usera nebo 401.

**Files:**
- Modify: `src/routes/internal.tsx`
- Create: `tests/routes/internal-me.test.ts`

- [ ] **Step 1: Endpoint**

Edit `src/routes/internal.tsx`, přidat:

```typescript
internal.get("/internal/auth/me", async (c) => {
  const auth = createAuth(c.env, c.executionCtx);
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session?.user) return c.json({ error: "unauthenticated" }, 401);
  return c.json({
    user: {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name ?? null,
      role: (session.user as { role?: string }).role ?? "user",
    },
    expiresAt: session.session.expiresAt,
  });
});
```

- [ ] **Step 2: Test**

```typescript
// tests/routes/internal-me.test.ts
import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("GET /internal/auth/me", () => {
  it("403 bez secret", async () => {
    const res = await SELF.fetch("https://test/internal/auth/me");
    expect(res.status).toBe(403);
  });

  it("401 s secret ale bez cookie", async () => {
    const res = await SELF.fetch("https://test/internal/auth/me", {
      headers: { "X-Internal-Secret": env.AUTH_INTERNAL_SECRET },
    });
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 3: PASS + commit**

```bash
npm test -- tests/routes/internal-me.test.ts
npm run typecheck
git add src/routes/internal.tsx tests/routes/internal-me.test.ts
git commit -m "feat(internal): GET /internal/auth/me"
```

---

## Task 9: POST /internal/auth/revoke

**Cíl:** Konzument předá session cookie, endpoint revokes session v DB a vrátí `Set-Cookie` s expirovaným cookie (pro consumer k přeposlání do prohlížeče).

**Files:**
- Modify: `src/routes/internal.tsx`
- Create: `tests/routes/internal-revoke.test.ts`

- [ ] **Step 1: Endpoint**

```typescript
internal.post("/internal/auth/revoke", async (c) => {
  const auth = createAuth(c.env, c.executionCtx);
  try {
    const res = await auth.api.signOut({
      headers: c.req.raw.headers,
      asResponse: true,
    });
    const setCookie = res.headers.get("set-cookie");
    return c.json({ ok: true, setCookie });
  } catch {
    return c.json({ ok: true, setCookie: null }); // idempotent
  }
});
```

- [ ] **Step 2: Test**

```typescript
// tests/routes/internal-revoke.test.ts
import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("POST /internal/auth/revoke", () => {
  it("403 bez secret", async () => {
    const res = await SELF.fetch("https://test/internal/auth/revoke", { method: "POST" });
    expect(res.status).toBe(403);
  });

  it("200 idempotent bez cookie", async () => {
    const res = await SELF.fetch("https://test/internal/auth/revoke", {
      method: "POST",
      headers: { "X-Internal-Secret": env.AUTH_INTERNAL_SECRET },
    });
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 3: PASS + commit**

```bash
npm test -- tests/routes/internal-revoke.test.ts
npm run typecheck
git add src/routes/internal.tsx tests/routes/internal-revoke.test.ts
git commit -m "feat(internal): POST /internal/auth/revoke"
```

---

## Task 10: Profile emails API (add / list / promote / remove)

**Cíl:** Endpointy `/api/profile/emails` chráněné Better Auth session cookie (voláno z konzumera přes Service Binding s prošlou cookie). Každá mutace loguje do auditu. Přidání sekundárního emailu posílá magic link s `addCallbackUrl` k potvrzení — při kliknutí se stav povýší na `verifiedAt=now`.

**Rozhodnutí pro MVP zjednodušení:** v první verzi přidáme email **bez verifikace magic linkem na druhou adresu** — přidat ho lze jen přes Better Auth „Add email" funkcionalitu, kterou Better Auth 1.6 nemá out-of-box. Proto implementujeme vlastní flow: uživatel zadá nový email → pošleme magic link na něj s `intent=add-email&userId=X` → při kliknutí endpoint verify-add-email ho připojí k existujícímu userovi.

**Files:**
- Modify: `src/routes/internal.tsx` (nové interní endpointy) **NEBO** nová veřejná cesta
- Create: `src/routes/profile.tsx`
- Modify: `src/index.tsx`
- Create: `tests/routes/profile-emails.test.ts`

- [ ] **Step 1: Vytvořit router**

Create `src/routes/profile.tsx`:

```typescript
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { authMiddleware, requireAuth } from "../middleware/auth";
import {
  addUserEmail,
  listUserEmails,
  promotePrimary,
  removeUserEmail,
  normalizeEmail,
} from "../lib/user-emails";
import { logIdentityEvent } from "../lib/audit";
import { createAuth } from "../lib/auth";
import { isAllowedCallback } from "../lib/callback-allowlist";
import type { Env, Variables } from "../types";

const profile = new Hono<{ Bindings: Env; Variables: Variables }>();
profile.use("/api/profile/*", authMiddleware, requireAuth);

profile.get("/api/profile/emails", async (c) => {
  const user = c.get("user")!;
  const db = drizzle(c.env.DB);
  const emails = await listUserEmails(db, user.id);
  return c.json({ emails });
});

profile.post("/api/profile/emails", async (c) => {
  const user = c.get("user")!;
  const body = await c.req.json<{ email?: string; callbackUrl?: string }>().catch(() => ({}));
  const email = body.email ? normalizeEmail(body.email) : "";
  const callbackUrl = body.callbackUrl;
  if (!email) return c.json({ error: "email required" }, 400);
  if (!callbackUrl || !isAllowedCallback(callbackUrl)) {
    return c.json({ error: "callbackUrl not allowed" }, 400);
  }

  const auth = createAuth(c.env, c.executionCtx);
  const verifyCallback = new URL(callbackUrl);
  verifyCallback.searchParams.set("intent", "add-email");
  verifyCallback.searchParams.set("userId", user.id);

  try {
    await auth.api.signInMagicLink({
      body: { email, callbackURL: verifyCallback.toString() },
    });
  } catch (err) {
    console.warn("[profile/emails POST]", err);
    return c.json({ error: "send_failed" }, 502);
  }
  return c.json({ ok: true, pending: true });
});

profile.patch("/api/profile/emails", async (c) => {
  const user = c.get("user")!;
  const body = await c.req.json<{ email?: string; promote?: boolean }>().catch(() => ({}));
  if (!body.email || !body.promote) {
    return c.json({ error: "email and promote:true required" }, 400);
  }
  const db = drizzle(c.env.DB);
  try {
    await promotePrimary(db, { userId: user.id, email: body.email });
    await logIdentityEvent(db, {
      userId: user.id,
      action: "email_promoted_primary",
      actor: "self",
      details: { email: normalizeEmail(body.email) },
    });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
  return c.json({ ok: true });
});

profile.delete("/api/profile/emails", async (c) => {
  const user = c.get("user")!;
  const body = await c.req.json<{ email?: string }>().catch(() => ({}));
  if (!body.email) return c.json({ error: "email required" }, 400);
  const db = drizzle(c.env.DB);
  try {
    await removeUserEmail(db, { userId: user.id, email: body.email });
    await logIdentityEvent(db, {
      userId: user.id,
      action: "email_removed",
      actor: "self",
      details: { email: normalizeEmail(body.email) },
    });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
  return c.json({ ok: true });
});

export default profile;
```

- [ ] **Step 2: Verify-add-email handler**

Přidat do `src/routes/internal.tsx`:

```typescript
internal.post("/internal/auth/verify-add-email", async (c) => {
  const body = await c.req.json<{ token?: string; userId?: string }>().catch(() => ({}));
  if (!body.token || !body.userId) return c.json({ error: "token and userId required" }, 400);

  const auth = createAuth(c.env, c.executionCtx);
  try {
    const result = await auth.api.magicLinkVerify({
      query: { token: body.token },
      asResponse: true,
    });
    const session = await auth.api.getSession({ headers: result.headers });
    if (!session?.user) return c.json({ error: "invalid_token" }, 401);

    // Token byl validní a session patří tomu emailu, co byl ověřen.
    // Přidáme email k originálnímu userId (body.userId), ne k nově vytvořenému.
    const { drizzle } = await import("drizzle-orm/d1");
    const { addUserEmail } = await import("../lib/user-emails");
    const { logIdentityEvent } = await import("../lib/audit");
    const db = drizzle(c.env.DB);

    await addUserEmail(db, {
      userId: body.userId,
      email: session.user.email,
      via: "self-add",
      verified: true,
    });
    await logIdentityEvent(db, {
      userId: body.userId,
      action: "email_added",
      actor: "self",
      details: { email: session.user.email },
    });

    // Revoke the ad-hoc session created by the add-email verify (consumer už má session pro primary usera).
    await auth.api.signOut({ headers: result.headers }).catch(() => {});

    return c.json({ ok: true, email: session.user.email });
  } catch (err) {
    console.warn("[internal/verify-add-email]", err);
    return c.json({ error: "verify_failed" }, 401);
  }
});
```

- [ ] **Step 3: Registrace v `src/index.tsx`**

```typescript
import profileRoutes from "./routes/profile";
// ...
app.route("/", profileRoutes);
```

- [ ] **Step 4: Test**

```typescript
// tests/routes/profile-emails.test.ts
import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("GET /api/profile/emails", () => {
  it("redirect na /login bez session (requireAuth)", async () => {
    const res = await SELF.fetch("https://test/api/profile/emails", {
      redirect: "manual",
    });
    expect([302, 401]).toContain(res.status);
  });
});

describe("POST /api/profile/emails", () => {
  it("vyžaduje auth", async () => {
    const res = await SELF.fetch("https://test/api/profile/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "x@y.cz", callbackUrl: "https://vibecoding.cz/verify" }),
      redirect: "manual",
    });
    expect([302, 401]).toContain(res.status);
  });
});
```

Pozn.: Plné end-to-end testy s validní session vyžadují pomocné seedování Better Auth session tokenu — odložíme na manuální QA v Task 14.

- [ ] **Step 5: PASS + commit**

```bash
npm test -- tests/routes/profile-emails.test.ts
npm run typecheck
git add src/routes/profile.tsx src/routes/internal.tsx src/index.tsx tests/routes/profile-emails.test.ts
git commit -m "feat(profile): emails add/list/promote/remove + verify-add-email"
```

---

## Task 11: Recovery banner dismiss endpoint

**Cíl:** `POST /api/profile/recovery-banner/dismiss` — nastaví `user.recoveryBannerDismissedUntil = now + 30 days`, zaloguje audit.

**Files:**
- Modify: `src/routes/profile.tsx`
- Create: `tests/routes/profile-banner.test.ts`

- [ ] **Step 1: Endpoint**

V `src/routes/profile.tsx` přidat:

```typescript
import { eq } from "drizzle-orm";
import { user as userTable } from "../db/auth-schema";

profile.post("/api/profile/recovery-banner/dismiss", async (c) => {
  const u = c.get("user")!;
  const db = drizzle(c.env.DB);
  const until = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await db
    .update(userTable)
    .set({ recoveryBannerDismissedUntil: until })
    .where(eq(userTable.id, u.id));
  await logIdentityEvent(db, {
    userId: u.id,
    action: "recovery_banner_dismissed",
    actor: "self",
    details: { until: until.toISOString() },
  });
  return c.json({ ok: true, until });
});
```

- [ ] **Step 2: Test (auth guard jen)**

```typescript
// tests/routes/profile-banner.test.ts
import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("POST /api/profile/recovery-banner/dismiss", () => {
  it("vyžaduje auth", async () => {
    const res = await SELF.fetch(
      "https://test/api/profile/recovery-banner/dismiss",
      { method: "POST", redirect: "manual" },
    );
    expect([302, 401]).toContain(res.status);
  });
});
```

- [ ] **Step 3: PASS + commit**

```bash
npm test -- tests/routes/profile-banner.test.ts
npm run typecheck
git add src/routes/profile.tsx tests/routes/profile-banner.test.ts
git commit -m "feat(profile): recovery banner dismiss endpoint (30d cooldown)"
```

---

## Task 12: Cookie domain `.vibecoding.cz` v produkci

**Cíl:** Session cookie musí být viditelná pro subdomény. Lokálně zůstává default (host-only).

**Files:**
- Modify: `src/lib/auth.ts`
- Modify: `src/types.ts` (volitelně `COOKIE_DOMAIN`)

- [ ] **Step 1: Přidat `COOKIE_DOMAIN` env var (optional)**

Edit `src/types.ts`:

```typescript
COOKIE_DOMAIN?: string;
```

- [ ] **Step 2: Konfigurace v Better Auth**

V `src/lib/auth.ts` přidat do `betterAuth({...})`:

```typescript
advanced: {
  // ... stávající backgroundTasks ...
  defaultCookieAttributes: {
    secure: true,
    sameSite: "lax",
    httpOnly: true,
    domain: env.COOKIE_DOMAIN,
  },
},
```

(Poznámka: sloučit s existující `advanced` sekcí, ne duplikovat klíč.)

- [ ] **Step 3: Nastavit env var**

V `wrangler.toml` přidat `[vars]` sekci (pokud neexistuje):

```toml
[vars]
# prod defaults
```

Pro prod nastavit přes `wrangler secret put` nebo `[env.production.vars]`:

```toml
[env.production.vars]
COOKIE_DOMAIN = ".vibecoding.cz"
```

- [ ] **Step 4: Typecheck + ruční ověření**

```bash
npm run typecheck
npm run dev
```

Lokální test: přihlásit se přes magic link, zkontrolovat v DevTools, že cookie nemá `Domain` (host-only). V prod po deployi: cookie musí mít `Domain=.vibecoding.cz`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth.ts src/types.ts wrangler.toml
git commit -m "feat(auth): cookie Domain=.vibecoding.cz in production"
```

---

## Task 13: OIDC Provider plugin (minimální nasazení)

**Cíl:** Nainstalovat OIDC plugin, připojit k Better Auth, endpointy `/api/auth/oauth2/*` budou živé (Better Auth prefix). Žádný registrovaný klient zatím.

**Fallback plán:** pokud plugin není v 1.6.5 stabilní nebo `@better-auth/oidc-provider` není kompatibilní, plán přerušíme a OIDC odložíme do Plan C (cross-domain, když bude potřeba). Task 13 je **izolovaný** — jeho selhání neblokuje Task 0–12.

**Files:**
- Modify: `src/lib/auth.ts`
- Modify: `package.json`
- Create: `tests/routes/oidc-discovery.test.ts`

- [ ] **Step 1: Ověřit dostupnost pluginu**

```bash
npm info better-auth dist-tags
npm info @better-auth/oidc-provider 2>&1 | head -20
```

Pokud `@better-auth/oidc-provider` balíček neexistuje, Better Auth má OIDC plugin vestavěný v `better-auth/plugins`. Hledej dokumentaci pro verzi 1.6.5.

- [ ] **Step 2: Instalace (podle bodu 1)**

Varianta A (samostatný balíček):

```bash
npm install @better-auth/oidc-provider
```

Varianta B (vestavěný v better-auth): přeskočit install.

- [ ] **Step 3: Přidat plugin do `createAuth`**

Edit `src/lib/auth.ts`, do pole `plugins`:

```typescript
import { oidcProvider } from "better-auth/plugins"; // nebo "@better-auth/oidc-provider"

// ...

plugins: [
  magicLink({ /* ... */ }),
  oidcProvider({
    loginPage: "/login",
    // metadata issuer = BETTER_AUTH_URL
  }),
],
```

Pokud import selže, vyzkoušet alternativní cesty (`better-auth/plugins/oidc-provider`, atd.) na základě error zpráv z typescriptu.

- [ ] **Step 4: Discovery endpoint test**

```typescript
// tests/routes/oidc-discovery.test.ts
import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("OIDC discovery", () => {
  it("vrací metadata", async () => {
    const res = await SELF.fetch(
      "https://test/api/auth/.well-known/openid-configuration",
    );
    expect(res.status).toBe(200);
    const body = await res.json<{ issuer: string }>();
    expect(body.issuer).toBeTruthy();
  });
});
```

- [ ] **Step 5: PASS (nebo SKIP při selhání)**

Run: `npm test -- tests/routes/oidc-discovery.test.ts`

- Pokud PASS: pokračuj.
- Pokud plugin nefunguje: soubor testu označit `.skip()` s komentářem „OIDC plugin není kompatibilní s BA 1.6.5 — viz Plan A Task 13 fallback", v `src/lib/auth.ts` vrátit změny zpět, commit „chore(oidc): defer OIDC plugin to cross-domain milestone".

- [ ] **Step 6: Commit (úspěch nebo odložení)**

```bash
npm run typecheck
git add src/lib/auth.ts package.json package-lock.json tests/routes/oidc-discovery.test.ts
git commit -m "feat(oidc): enable OIDC Provider plugin (no clients registered)"
```

---

## Task 14: Dokumentace + CLAUDE.md

**Cíl:** Nový soubor `docs/auth-master.md` s popisem interního API, příklady volání, env vars, rate limits, deployment guide. Aktualizace `CLAUDE.md` (pokud existuje) s odkazem.

**Files:**
- Create: `docs/auth-master.md`
- Modify: `CLAUDE.md` (pokud existuje)

- [ ] **Step 1: Napsat dokumentaci**

Create `docs/auth-master.md`:

```markdown
# Auth master — interní API

Videokurzy Worker slouží jako Better Auth master pro celý ekosystém
`*.vibecoding.cz`. Externí konzumenti (jiné domény) mohou v budoucnu použít
OIDC endpointy.

## Env vars

- `BETTER_AUTH_SECRET` — podpisový klíč Better Auth sessions
- `BETTER_AUTH_URL` — veřejná URL Workeru (`https://kurz.vibecoding.cz` v prod)
- `AUTH_INTERNAL_SECRET` — shared secret mezi Workery (rotovatelný, 32+ znaků)
- `RESEND_API_KEY` — pro odesílání magic linků
- `COOKIE_DOMAIN` — `.vibecoding.cz` v prod, unset v dev

## Interní API (Service Binding)

Všechny endpointy vyžadují hlavičku `X-Internal-Secret: <AUTH_INTERNAL_SECRET>`.
Chybějící nebo chybný secret → 403.

### `POST /internal/auth/magic-link`

Odešle magic link na zadaný email s callback URL směřujícím zpět do konzumera.

Body:
```json
{
  "email": "user@example.cz",
  "callbackUrl": "https://vibecoding.cz/auth/verify"
}
```

Odpovědi: `200 {ok:true}`, `400 {error:"..."}`, `502 {error:"send_failed"}`.

### `POST /internal/auth/verify-token`

Ověří token z magic linku, vrátí user + session token.

Body: `{ "token": "<z query stringu odkazu>" }`.

Odpověď:
```json
{
  "user": { "id": "...", "email": "...", "name": "...", "role": "user" },
  "sessionToken": "...",
  "expiresAt": "...",
  "setCookie": "better-auth.session_token=...; HttpOnly; ..."
}
```

Konzument předá `setCookie` do prohlížeče přes `Set-Cookie` header.

### `GET /internal/auth/me`

Vrátí aktuálního usera pro předanou session cookie (header `Cookie`).

Odpověď: `200 {user, expiresAt}` nebo `401`.

### `POST /internal/auth/revoke`

Odhlásí session. Idempotentní.

Odpověď: `200 {ok, setCookie}` (setCookie obsahuje expirační Max-Age=0).

### `POST /internal/auth/verify-add-email`

Dokončí flow přidání sekundárního emailu — token z linku + userId k připojení.

Body: `{ "token": "...", "userId": "..." }`.

## Veřejné API (session-protected)

### `GET /api/profile/emails`

Seznam všech emailů aktuálního usera.

### `POST /api/profile/emails`

Začne flow přidání sekundárního emailu.
Body: `{ email, callbackUrl }`. Uživatel dostane magic link na novou adresu.

### `PATCH /api/profile/emails`

Povýšení na primary. Body: `{ email, promote: true }`.

### `DELETE /api/profile/emails`

Odstranění sekundárního emailu. Body: `{ email }`.

### `POST /api/profile/recovery-banner/dismiss`

Zavře recovery banner na 30 dní.

## Rate limits

- Magic link: 10/min/email, 10/min/IP (sdílený KV namespace `KV`).
- Better Auth default pro další endpointy.

## OIDC Provider (pro externí konzumenty)

Discovery: `https://kurz.vibecoding.cz/api/auth/.well-known/openid-configuration`.
Registrace klienta: manuálně v D1 (tabulka `oidc_client`) — admin UI odloženo.

## Deploy

1. Test lokálně: `npm run dev` + `npm test`
2. Migrace produkce: `npm run db:migrate:prod`
3. Deploy: `npm run deploy`
```

- [ ] **Step 2: Aktualizace `CLAUDE.md`**

Najít `/Users/patrickzandl/GitHub/videokurzy/CLAUDE.md`, pokud existuje. Přidat na konec sekce „Dokumentace":

```markdown
- [docs/auth-master.md](docs/auth-master.md) — interní auth API pro konzumenty v ekosystému vibecoding.cz
```

Pokud `CLAUDE.md` neexistuje, vytvořit neuděláme — je to projekt-specific decision.

- [ ] **Step 3: Commit**

```bash
git add docs/auth-master.md CLAUDE.md
git commit -m "docs: auth-master internal API reference"
```

---

## Task 15: Manuální QA + deploy checklist

**Cíl:** Ověřit runtime chování v dev prostředí + příprava produkčního deployu.

**Files:** žádné (jen checklist k odškrtnutí).

- [ ] **Step 1: Čistý build**

```bash
npm run build
```

Expected: build proběhne bez chyb.

- [ ] **Step 2: Kompletní test run**

```bash
npm test
```

Expected: všechny testy passed.

- [ ] **Step 3: Lokální dev smoke test**

```bash
npm run dev
```

V separátním terminálu nebo prohlížeči:

```bash
# 1. Požadavek na magic link (nevalidní secret)
curl -i -X POST http://localhost:8787/internal/auth/magic-link \
  -H "Content-Type: application/json" \
  -d '{"email":"test@vibecoding.cz","callbackUrl":"http://localhost:4321/auth/verify"}'
# očekáváno: 403

# 2. S validním secretem (nastavit AUTH_INTERNAL_SECRET v .dev.vars)
curl -i -X POST http://localhost:8787/internal/auth/magic-link \
  -H "Content-Type: application/json" \
  -H "X-Internal-Secret: <hodnota z .dev.vars>" \
  -d '{"email":"test@vibecoding.cz","callbackUrl":"http://localhost:4321/auth/verify"}'
# očekáváno: 200 {ok:true} + do Resendu odejde email

# 3. Discovery (OIDC) pokud Task 13 passed:
curl -i http://localhost:8787/api/auth/.well-known/openid-configuration
# očekáváno: 200 JSON s issuer, endpoints
```

- [ ] **Step 4: Vytvořit `AUTH_INTERNAL_SECRET` pro produkci**

```bash
openssl rand -hex 32
# zkopíruj výstup
wrangler secret put AUTH_INTERNAL_SECRET
# vlož hodnotu
```

- [ ] **Step 5: Produkční migrace**

```bash
npm run db:migrate:prod
```

Expected: migrace `0004_*` aplikována na produkci.

- [ ] **Step 6: Produkční deploy**

```bash
npm run deploy
```

- [ ] **Step 7: Post-deploy verify**

```bash
# Production discovery
curl -i https://kurz.vibecoding.cz/api/auth/.well-known/openid-configuration

# Production internal (403 bez secret)
curl -i -X POST https://kurz.vibecoding.cz/internal/auth/magic-link \
  -H "Content-Type: application/json" \
  -d '{}'
# očekáváno: 403
```

- [ ] **Step 8: Předat `AUTH_INTERNAL_SECRET` do vibecoding-site**

Při implementaci Plan B se stejná hodnota tajného klíče nastaví do vibecoding-site Workeru přes `wrangler secret put AUTH_INTERNAL_SECRET` v tom projektu.

---

## Security checklist (před mergem)

- [ ] `AUTH_INTERNAL_SECRET` není v repu, jen v `.dev.vars` (gitignore) + `wrangler secret` pro prod.
- [ ] `timingSafeEqual` použit v `requireInternalSecret`.
- [ ] Callback URL allowlist testován proti `evil.com` + `vibecoding.cz.evil.com` bypass.
- [ ] Cookie `Secure`, `HttpOnly`, `SameSite=Lax`, `Domain=.vibecoding.cz` v prod.
- [ ] Magic link expirace 5 min (Better Auth default v `auth.ts`).
- [ ] Každá mutace `user_emails` zapisuje do `user_identity_audit`.
- [ ] `ensureUserEmailRecord` je idempotentní.
- [ ] Email normalizace (`normalizeEmail`) aplikována v každém lookup + insert.
- [ ] Promote vyžaduje `verifiedAt > 0`.
- [ ] Remove zakázáno u jediného/primary emailu.

## Kam dál

Po dokončení Plan A napíšu Plan B (`/Users/patrickzandl/GitHub/vibecoding-site/docs/superpowers/plans/...`) pro consumer a profil dashboard.
