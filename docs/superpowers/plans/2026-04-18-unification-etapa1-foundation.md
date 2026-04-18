# Etapa 1: Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Připravit základ pro sjednocení projektů — Tailwind CSS v4 build step, upgrade Better Auth, rozšíření `purchase` schématu o FIO sloupce, Drizzle relations, konfigurační soubory, admin uživatelé a Cloudflare Cron Trigger.

**Architecture:** Po dokončení bude projekt mít připraveny všechny prerekvizity pro Etapu 2 (FIO integrace), Etapu 3 (Admin CRUD) a Etapu 4 (migrace views na Tailwind). Stávající Stripe flow a views zůstanou funkční beze změny. Po migraci bude možné v následujících etapách rovnou psát nové views v Tailwindu.

**Tech Stack:** Cloudflare Workers + Hono + Drizzle ORM + D1 + Better Auth (upgrade) + Tailwind CSS v4 + Cloudflare Cron Triggers

**Spec:** [2026-04-18-unification-design.md](../specs/2026-04-18-unification-design.md)

---

## File Structure

### Soubory, které vytvoříme

| Cesta | Účel |
|---|---|
| `src/styles/input.css` | Tailwind entry point s `@import "tailwindcss"` |
| `public/styles.css` | Build output (generovaný, ignorovaný v `.gitignore`) |
| `src/config/payment.ts` | FIO účet, ceny, splatnosti, VS prefix, rate limit |
| `src/config/freemail-domains.ts` | Blacklist freemailových domén pro B2B |
| `src/config/admin.ts` | ADMIN_EMAILS, EMAIL_FROM |
| `drizzle/migrations/0003_purchase_fio_extension.sql` | Manuální SQL pro rozšíření `purchase` tabulky (SQLite constraint handling) |
| `tailwind.config.ts` | Tailwind v4 konfigurace (content paths) |

### Soubory, které modifikujeme

| Cesta | Změna |
|---|---|
| `package.json` | Upgrade Better Auth, přidat Tailwind v4, uqr, concurrently; nové scripts `build:css` a `dev:css` |
| `wrangler.toml` | Přidat `[assets]` directory, `[triggers]` crons |
| `src/db/schema.ts` | Rozšíření `purchase` tabulky, přidání `relations()` pro všechny tabulky |
| `src/index.tsx` | Export `scheduled` handleru pro cron triggers |
| `src/queue.ts` | Minor — sjednocení typů po drizzle relations (pokud potřeba) |
| `scripts/seed.sql` | Přidat Andreu jako admin, ujistit se že Patrick má `role = 'admin'` |
| `.gitignore` | Přidat `public/styles.css` |

---

## Task 1: Aktualizace `package.json` — deps a scripts

**Files:**
- Modify: `/Users/patrickzandl/GitHub/videokurzy/package.json`

- [ ] **Step 1: Ověřit nejnovější stable verzi Better Auth**

Spustit (v nové shell session):
```bash
cd /Users/patrickzandl/GitHub/videokurzy
npm view better-auth version
```

Zapiš výstupní verzi (např. `1.6.3`) do proměnné pro další krok.

- [ ] **Step 2: Přepsat `package.json`**

```json
{
  "name": "videokurzy",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "npm run build:css && concurrently \"npm run dev:css\" \"wrangler dev\"",
    "dev:css": "tailwindcss -i src/styles/input.css -o public/styles.css --watch",
    "build": "npm run build:css && wrangler deploy --dry-run",
    "build:css": "tailwindcss -i src/styles/input.css -o public/styles.css --minify",
    "deploy": "npm run build:css && wrangler deploy",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "wrangler d1 migrations apply videokurzy-db --local",
    "db:migrate:prod": "wrangler d1 migrations apply videokurzy-db --remote",
    "db:seed": "wrangler d1 execute videokurzy-db --local --file=scripts/seed.sql",
    "db:seed:prod": "wrangler d1 execute videokurzy-db --remote --file=scripts/seed.sql",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "better-auth": "^<LATEST_STABLE>",
    "drizzle-orm": "^0.45.2",
    "hono": "^4.12.10",
    "nanoid": "^5.1.7",
    "stripe": "^22.0.0",
    "uqr": "^0.1.3"
  },
  "devDependencies": {
    "@better-auth/cli": "^<LATEST_STABLE_CLI>",
    "@cloudflare/workers-types": "^4.20260403.1",
    "@tailwindcss/cli": "^4.1.0",
    "concurrently": "^9.1.0",
    "drizzle-kit": "^0.31.10",
    "tailwindcss": "^4.1.0",
    "typescript": "^6.0.2",
    "wrangler": "^4.80.0"
  }
}
```

Nahradit `<LATEST_STABLE>` konkrétní verzí zjištěnou v Step 1 a `<LATEST_STABLE_CLI>` verzí `@better-auth/cli` (zjistit: `npm view @better-auth/cli version`).

- [ ] **Step 3: Instalace**

```bash
cd /Users/patrickzandl/GitHub/videokurzy
npm install
```

Očekávaný výstup: „added/updated N packages, audited 0 vulnerabilities".

- [ ] **Step 4: Ověření, že běží typecheck (smí selhat — Better Auth může mít breaking changes; vyřešíme v Task 4)**

```bash
npm run typecheck
```

Pokud typecheck selže jen na Better Auth importech, je to OK — vyřeší se v Tasku 4. Pokud selže na jiných věcech, prověřit a opravit.

- [ ] **Step 5: Commit**

```bash
cd /Users/patrickzandl/GitHub/videokurzy
git add package.json package-lock.json
git commit -m "chore: upgrade deps, add tailwind v4 and uqr for FIO QR codes"
```

---

## Task 2: Tailwind CSS v4 — scaffolding

**Files:**
- Create: `/Users/patrickzandl/GitHub/videokurzy/src/styles/input.css`
- Create: `/Users/patrickzandl/GitHub/videokurzy/tailwind.config.ts`
- Modify: `/Users/patrickzandl/GitHub/videokurzy/.gitignore`

- [ ] **Step 1: Vytvořit `.gitignore` (nebo přidat záznam)**

Pokud `.gitignore` neexistuje, vytvořit. Jinak přidat řádku na konec:

```
public/styles.css
```

Zkontrolovat:
```bash
cd /Users/patrickzandl/GitHub/videokurzy
cat .gitignore | grep styles.css
```

Očekávaný výstup: `public/styles.css`.

- [ ] **Step 2: Vytvořit `src/styles/input.css`**

```css
@import "tailwindcss";

/* Vlastní custom CSS (pokud potřeba) */
@layer base {
  html {
    font-family: 'Inter', system-ui, -apple-system, sans-serif;
  }
}
```

- [ ] **Step 3: Vytvořit `tailwind.config.ts`**

```typescript
import type { Config } from "tailwindcss";

export default {
  content: [
    "./src/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
} satisfies Config;
```

- [ ] **Step 4: Vytvořit adresář `public/` a ověřit build**

```bash
cd /Users/patrickzandl/GitHub/videokurzy
mkdir -p public
npm run build:css
```

Očekávaný výstup: soubor `public/styles.css` existuje a má > 1000 řádků (generovaný Tailwind).

Ověřit velikost:
```bash
wc -l public/styles.css
```

- [ ] **Step 5: Commit**

```bash
cd /Users/patrickzandl/GitHub/videokurzy
git add .gitignore src/styles/input.css tailwind.config.ts
git commit -m "feat(tailwind): add tailwind v4 scaffolding with build step"
```

---

## Task 3: Wrangler — static assets a cron triggers

**Files:**
- Modify: `/Users/patrickzandl/GitHub/videokurzy/wrangler.toml`

- [ ] **Step 1: Nahradit celý obsah `wrangler.toml`**

```toml
name = "videokurzy"
main = "src/index.tsx"
compatibility_date = "2025-04-01"
compatibility_flags = ["nodejs_compat"]

[assets]
directory = "./public"

[[d1_databases]]
binding = "DB"
database_name = "videokurzy-db"
database_id = "c4e3cf23-d6c8-4c63-94ca-d6c64809ca9f"
migrations_dir = "drizzle/migrations"

[[kv_namespaces]]
binding = "KV"
id = "afc09797ca644747b2c159f705334fb0"
preview_id = "0781f693950c4ed4998f7ba022a473fc"

[[queues.producers]]
queue = "videokurzy-webhooks"
binding = "WEBHOOK_QUEUE"

[[queues.consumers]]
queue = "videokurzy-webhooks"
max_batch_size = 5
max_retries = 3

[triggers]
crons = ["0 3 * * *"]
```

Přidání:
- `[assets]` directory → Cloudflare Workers bude servírovat soubory z `./public/` (např. `/styles.css`)
- `[triggers] crons = ["0 3 * * *"]` → scheduled handler poběží každý den v 03:00 UTC

- [ ] **Step 2: Commit**

```bash
cd /Users/patrickzandl/GitHub/videokurzy
git add wrangler.toml
git commit -m "feat(wrangler): add static assets dir and daily cron trigger"
```

---

## Task 4: Better Auth upgrade — kompatibilita s novou verzí

**Files:**
- Modify: `/Users/patrickzandl/GitHub/videokurzy/src/lib/auth.ts` (pokud existuje)
- Modify: `/Users/patrickzandl/GitHub/videokurzy/src/db/auth-schema.ts`

- [ ] **Step 1: Číst `src/lib/auth.ts` pro pochopení stávající konfigurace**

```bash
cat /Users/patrickzandl/GitHub/videokurzy/src/lib/auth.ts
```

- [ ] **Step 2: Ověřit changelog Better Auth mezi 1.5.6 a novou verzí**

Web fetch (WebFetch tool):
- URL: `https://github.com/better-auth/better-auth/releases`
- Prompt: "List breaking changes between versions 1.5.6 and [latest] relevant to magic link plugin, D1 adapter, and Drizzle integration"

Zaznamenat si relevantní breaking changes.

- [ ] **Step 3: Spustit CLI pro regeneraci auth schématu (pokud je potřeba)**

```bash
cd /Users/patrickzandl/GitHub/videokurzy
npx @better-auth/cli generate --y
```

Pokud CLI nahlásí změny v `auth-schema.ts`, přijmout. Pokud ne, pokračovat.

- [ ] **Step 4: Spustit typecheck a opravit breaking changes**

```bash
cd /Users/patrickzandl/GitHub/videokurzy
npm run typecheck
```

Pokud jsou chyby, opravit je podle changelogu. Typické oblasti:
- Import paths (`better-auth/plugins` vs `better-auth/plugins/magic-link`)
- Config schema (renamed fields)
- Session typy (nové pole `role`, atd.)

- [ ] **Step 5: Test v dev módu (smoke test)**

```bash
cd /Users/patrickzandl/GitHub/videokurzy
npm run dev
```

V prohlížeči otevřít `http://localhost:8787/login`, zadat email, kliknout „Odeslat magic link". Ověřit, že:
- Neřekne 500 error
- Do konzole se loguje Resend call
- V DB se vytvoří záznam ve `verification` tabulce

Stop dev server (`Ctrl+C`).

- [ ] **Step 6: Commit**

```bash
cd /Users/patrickzandl/GitHub/videokurzy
git add src/lib/auth.ts src/db/auth-schema.ts
git commit -m "chore(auth): upgrade better-auth to latest stable"
```

---

## Task 5: Konfigurační soubor — `src/config/payment.ts`

**Files:**
- Create: `/Users/patrickzandl/GitHub/videokurzy/src/config/payment.ts`

- [ ] **Step 1: Vytvořit soubor**

```typescript
// Konfigurace plateb — Stripe a FIO Bank
// Zdroj FIO účtu: Patrick Zandl, FIO podnikatelský účet 2403461724/2010

/** IBAN FIO účtu (podnikatelský) */
export const PAYMENT_IBAN = "CZ9720100000002403461724";

/** Číslo účtu pro zobrazení */
export const PAYMENT_ACCOUNT = "2403461724/2010";

/** BIC / SWIFT kód */
export const PAYMENT_BIC = "FIOBCZPP";

/** Název příjemce (zobrazí se na QR platbě a v SPAYD) */
export const PAYMENT_RECIPIENT = "Patrick Zandl";

/** B2C částka v CZK */
export const PRICE_INDIVIDUAL = 2000;

/** B2B částka v CZK */
export const PRICE_ORGANIZATION = 15000;

/** Doba přístupu v dnech (1 rok) */
export const ACCESS_DURATION_DAYS = 365;

/** VS prefix pro videokurzy objednávky (odlišuje od donations `11` a workshops `22`) */
export const FIO_VS_PREFIX = "33";

/** Výchozí splatnost FIO objednávky ve dnech */
export const FIO_DEFAULT_DUE_DAYS = 7;

/** Prodloužená splatnost FIO objednávky (pro firemní zpracování) ve dnech */
export const FIO_EXTENDED_DUE_DAYS = 21;

/** FIO API rate limit v ms (30s limit + 5s buffer) */
export const FIO_RATE_LIMIT_MS = 35000;

/** Kolik dní zpět hledat transakce ve FIO API (pokrývá prodlouženou splatnost + margin) */
export const FIO_LOOKBACK_DAYS = 28;

/** Renewal reminder offsets ve dnech před expirací (3 týdny, 2 týdny, 1 týden, 1 den) */
export const FIO_RENEWAL_REMINDER_DAYS = [21, 14, 7, 1] as const;
```

- [ ] **Step 2: Typecheck**

```bash
cd /Users/patrickzandl/GitHub/videokurzy
npm run typecheck
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
cd /Users/patrickzandl/GitHub/videokurzy
git add src/config/payment.ts
git commit -m "feat(config): add payment config with FIO account and pricing"
```

---

## Task 6: Konfigurační soubor — `src/config/freemail-domains.ts`

**Files:**
- Create: `/Users/patrickzandl/GitHub/videokurzy/src/config/freemail-domains.ts`

- [ ] **Step 1: Vytvořit soubor**

```typescript
// Blacklist freemailových domén — nejdou použít pro B2B firemní licenci,
// protože by se licence vztahovala na všechny uživatele dané služby.

const FREEMAIL_DOMAINS = new Set<string>([
  // České freemaily
  "seznam.cz",
  "post.cz",
  "email.cz",
  "centrum.cz",
  "atlas.cz",
  "volny.cz",
  "tiscali.cz",
  // Mezinárodní freemaily
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.co.uk",
  "ymail.com",
  "outlook.com",
  "hotmail.com",
  "hotmail.co.uk",
  "live.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "protonmail.com",
  "proton.me",
  "pm.me",
  "tutanota.com",
  "tutanota.de",
  "tuta.io",
  "gmx.com",
  "gmx.de",
  "gmx.cz",
  "mail.com",
  "fastmail.com",
  "fastmail.fm",
  "zoho.com",
  "yandex.com",
  "yandex.ru",
]);

/**
 * Vrací true, pokud je doména ve freemail blacklistu.
 * Vstupní doména se normalizuje na lowercase.
 */
export function isFreemailDomain(domain: string): boolean {
  return FREEMAIL_DOMAINS.has(domain.toLowerCase().trim());
}

/** Lidsky čitelná zpráva pro UI, když uživatel zadá freemail doménu. */
export const FREEMAIL_REJECTION_MESSAGE =
  "Pro firemní licenci potřebujeme vlastní firemní doménu. Freemailové domény (gmail.com, seznam.cz, icloud.com a další) nelze použít, protože licence by se vztahovala na všechny uživatele dané služby.";
```

- [ ] **Step 2: Typecheck**

```bash
cd /Users/patrickzandl/GitHub/videokurzy
npm run typecheck
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
cd /Users/patrickzandl/GitHub/videokurzy
git add src/config/freemail-domains.ts
git commit -m "feat(config): add freemail domains blacklist for B2B validation"
```

---

## Task 7: Konfigurační soubor — `src/config/admin.ts`

**Files:**
- Create: `/Users/patrickzandl/GitHub/videokurzy/src/config/admin.ts`

- [ ] **Step 1: Vytvořit soubor**

```typescript
// Admin konfigurace — emaily pro notifikace a odesílatel transakčních emailů

/** Emaily admin uživatelů, kam chodí notifikace o nových B2B objednávkách, schválených platbách atd. */
export const ADMIN_EMAILS = [
  "patrick@vibecoding.cz",
  "andrea@vibecoding.cz",
] as const;

/** Odesílatel všech transakčních emailů (magic link, purchase confirmation, reminders). */
export const EMAIL_FROM = "Andrea Maloveczká <andrea@vibecoding.cz>";

/** Reply-to adresa (support). */
export const EMAIL_REPLY_TO = "andrea@vibecoding.cz";
```

- [ ] **Step 2: Typecheck**

```bash
cd /Users/patrickzandl/GitHub/videokurzy
npm run typecheck
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
cd /Users/patrickzandl/GitHub/videokurzy
git add src/config/admin.ts
git commit -m "feat(config): add admin emails and default email sender"
```

---

## Task 8: Rozšíření `purchase` schématu + Drizzle relations

**Files:**
- Modify: `/Users/patrickzandl/GitHub/videokurzy/src/db/schema.ts`

- [ ] **Step 1: Přepsat `src/db/schema.ts`**

```typescript
import { sqliteTable, text, integer, primaryKey } from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";
import { user } from "./auth-schema";

export const organization = sqliteTable("organization", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  publicId: text("publicId").notNull().unique(),
  domain: text("domain").notNull().unique(),
  stripeSubscriptionId: text("stripeSubscriptionId"),
  status: text("status", { enum: ["pending", "active", "expired"] })
    .notNull()
    .default("pending"),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
});

export const course = sqliteTable("course", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description").notNull().default(""),
  published: integer("published", { mode: "boolean" }).notNull().default(false),
});

export const module = sqliteTable("module", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  courseId: integer("courseId")
    .notNull()
    .references(() => course.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  slug: text("slug").notNull(),
  sortOrder: integer("sortOrder").notNull().default(0),
});

export const lesson = sqliteTable("lesson", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  moduleId: integer("moduleId")
    .notNull()
    .references(() => module.id, { onDelete: "cascade" }),
  publicId: text("publicId").notNull().unique(),
  title: text("title").notNull(),
  slug: text("slug").notNull(),
  bunnyVideoId: text("bunnyVideoId"),
  durationSeconds: integer("durationSeconds").notNull().default(0),
  isFree: integer("isFree", { mode: "boolean" }).notNull().default(false),
  sortOrder: integer("sortOrder").notNull().default(0),
});

export const progress = sqliteTable(
  "progress",
  {
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    lessonId: integer("lessonId")
      .notNull()
      .references(() => lesson.id, { onDelete: "cascade" }),
    completed: integer("completed", { mode: "boolean" }).notNull().default(false),
    completedAt: integer("completedAt", { mode: "timestamp" }),
  },
  (table) => [primaryKey({ columns: [table.userId, table.lessonId] })]
);

export const purchase = sqliteTable("purchase", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull(),
  userId: text("userId"),
  type: text("type", { enum: ["individual", "organization"] }).notNull(),
  paymentMethod: text("paymentMethod", { enum: ["stripe", "fio"] })
    .notNull()
    .default("stripe"),
  variableSymbol: text("variableSymbol").unique(),
  fioTransactionId: text("fioTransactionId"),
  stripePaymentId: text("stripePaymentId").unique(),
  stripeSubscriptionId: text("stripeSubscriptionId"),
  status: text("status", { enum: ["pending", "active", "expired", "refunded"] })
    .notNull()
    .default("active"),
  expiresAt: integer("expiresAt", { mode: "timestamp" }).notNull(),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
});

// ─── Relations ────────────────────────────────────────────────────

export const courseRelations = relations(course, ({ many }) => ({
  modules: many(module),
}));

export const moduleRelations = relations(module, ({ one, many }) => ({
  course: one(course, { fields: [module.courseId], references: [course.id] }),
  lessons: many(lesson),
}));

export const lessonRelations = relations(lesson, ({ one }) => ({
  module: one(module, { fields: [lesson.moduleId], references: [module.id] }),
}));

export const userRelations = relations(user, ({ many }) => ({
  progress: many(progress),
  purchases: many(purchase),
}));

export const progressRelations = relations(progress, ({ one }) => ({
  user: one(user, { fields: [progress.userId], references: [user.id] }),
  lesson: one(lesson, { fields: [progress.lessonId], references: [lesson.id] }),
}));

export const purchaseRelations = relations(purchase, ({ one }) => ({
  user: one(user, { fields: [purchase.userId], references: [user.id] }),
}));

export { user, session, account, verification } from "./auth-schema";
```

Klíčové změny oproti původnímu schématu:
- `paymentMethod` sloupec (enum `stripe` / `fio`, default `"stripe"`)
- `variableSymbol` sloupec (text, unique, nullable)
- `fioTransactionId` sloupec (text, nullable)
- `stripePaymentId` — **změna z NOT NULL na nullable** (FIO purchase ho nemá)
- `status` enum rozšířen o `"pending"`
- Všechny `relations()` definice na konci

- [ ] **Step 2: Typecheck**

```bash
cd /Users/patrickzandl/GitHub/videokurzy
npm run typecheck
```

Expected: PASS

- [ ] **Step 3: Commit (bez migrace — ta přijde v dalším tasku)**

```bash
cd /Users/patrickzandl/GitHub/videokurzy
git add src/db/schema.ts
git commit -m "feat(schema): extend purchase for FIO payments and add drizzle relations"
```

---

## Task 9: Drizzle migrace — manuální SQL pro rozšíření `purchase`

**Files:**
- Create: `/Users/patrickzandl/GitHub/videokurzy/drizzle/migrations/0003_purchase_fio_extension.sql`
- Modify: `/Users/patrickzandl/GitHub/videokurzy/drizzle/migrations/meta/_journal.json` (auto-updated by drizzle-kit)

- [ ] **Step 1: Zkusit vygenerovat migraci automaticky**

```bash
cd /Users/patrickzandl/GitHub/videokurzy
npm run db:generate
```

Drizzle-kit vygeneruje SQL. Pokud generuje něco použitelného (nutné pro SQLite ALTER TABLE), použít. Pokud ne (SQLite neumí měnit NOT NULL na nullable bez recreate), psát manuálně.

- [ ] **Step 2: Zkontrolovat vygenerovaný SQL**

```bash
ls -la /Users/patrickzandl/GitHub/videokurzy/drizzle/migrations/ | tail -5
cat /Users/patrickzandl/GitHub/videokurzy/drizzle/migrations/0003_*.sql
```

Pokud obsahuje `ALTER TABLE purchase ALTER COLUMN stripePaymentId` → SQLite to nepodporuje; smazat soubor a psát manuálně (Step 3). Pokud generovaný SQL používá `CREATE TABLE __new_purchase` + INSERT + DROP + RENAME, je v pořádku.

- [ ] **Step 3: Pokud bylo potřeba přepsat manuálně, nahradit obsah `drizzle/migrations/0003_purchase_fio_extension.sql`**

```sql
-- Rozšíření purchase tabulky o FIO-specifické sloupce.
-- SQLite neumí měnit NOT NULL → nullable, musíme tabulku znovu vytvořit.

PRAGMA foreign_keys = OFF;

CREATE TABLE `__new_purchase` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `email` text NOT NULL,
  `userId` text,
  `type` text NOT NULL,
  `paymentMethod` text NOT NULL DEFAULT 'stripe',
  `variableSymbol` text,
  `fioTransactionId` text,
  `stripePaymentId` text,
  `stripeSubscriptionId` text,
  `status` text NOT NULL DEFAULT 'active',
  `expiresAt` integer NOT NULL,
  `createdAt` integer NOT NULL
);

INSERT INTO `__new_purchase` (
  `id`, `email`, `userId`, `type`,
  `paymentMethod`, `variableSymbol`, `fioTransactionId`,
  `stripePaymentId`, `stripeSubscriptionId`, `status`, `expiresAt`, `createdAt`
)
SELECT
  `id`, `email`, `userId`, `type`,
  'stripe' AS `paymentMethod`,
  NULL AS `variableSymbol`,
  NULL AS `fioTransactionId`,
  `stripePaymentId`, `stripeSubscriptionId`, `status`, `expiresAt`, `createdAt`
FROM `purchase`;

DROP TABLE `purchase`;

ALTER TABLE `__new_purchase` RENAME TO `purchase`;

CREATE UNIQUE INDEX `purchase_variableSymbol_unique` ON `purchase` (`variableSymbol`);
CREATE UNIQUE INDEX `purchase_stripePaymentId_unique` ON `purchase` (`stripePaymentId`);

PRAGMA foreign_keys = ON;
```

- [ ] **Step 4: Pokud se přepisoval manuálně, aktualizovat `meta/_journal.json`**

Otevřít `drizzle/migrations/meta/_journal.json` a přidat entry pro novou migraci, pokud drizzle-kit generátor ji neaktualizoval (běžně to udělá sám v Step 1).

Pokud struktura neexistuje (protože Step 1 vygeneroval prázdno), můžeme manuálně přidat:

```json
{
  "idx": 3,
  "version": "6",
  "when": <unix_timestamp_ms>,
  "tag": "0003_purchase_fio_extension",
  "breakpoints": true
}
```

Kde `<unix_timestamp_ms>` je aktuální čas v milisekundách (`node -e "console.log(Date.now())"`).

- [ ] **Step 5: Aplikovat migraci lokálně**

```bash
cd /Users/patrickzandl/GitHub/videokurzy
npm run db:migrate
```

Očekávaný výstup: „Migration applied successfully" nebo seznam aplikovaných migrací včetně `0003_purchase_fio_extension`.

- [ ] **Step 6: Ověřit schéma v D1**

```bash
cd /Users/patrickzandl/GitHub/videokurzy
wrangler d1 execute videokurzy-db --local --command="SELECT sql FROM sqlite_master WHERE name='purchase';"
```

Ověřit, že výpis obsahuje `paymentMethod`, `variableSymbol`, `fioTransactionId` a že `stripePaymentId` není `NOT NULL`.

- [ ] **Step 7: Commit**

```bash
cd /Users/patrickzandl/GitHub/videokurzy
git add drizzle/migrations/
git commit -m "feat(db): migration for purchase fio extension"
```

---

## Task 10: Aktualizace `src/lib/access.ts` — pending purchases nesmí dát přístup

**Files:**
- Modify: `/Users/patrickzandl/GitHub/videokurzy/src/lib/access.ts`

Stávající `access.ts` kontroluje `purchase.status = 'active'`. Po přidání `pending` stavu se nic nemění (pending purchase nedostane přístup). Ale musíme být explicitní a dokumentovat.

- [ ] **Step 1: Číst aktuální `access.ts`**

```bash
cat /Users/patrickzandl/GitHub/videokurzy/src/lib/access.ts
```

Funkce `hasAccess` už kontroluje `eq(purchase.status, "active")` — takže `pending` automaticky nemá přístup. OK.

- [ ] **Step 2: Aktualizovat `linkPurchasesToUser` — opravit bug**

Stávající kód:
```typescript
.where(and(eq(purchase.email, email.toLowerCase()), eq(purchase.userId, "")));
```

Porovnává `userId === ""`, ale schéma má `userId` nullable (může být `NULL`, ne `""`). Po přidání Drizzle relations a refresh schématu se musí použít `isNull()`. Nahradit:

```typescript
import { eq, and, gt, or, isNull } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { purchase, organization } from "../db/schema";

/**
 * Check if user has platform-wide access (any active purchase or org domain).
 * One subscription = access to all courses.
 * Pending purchases (FIO před potvrzením platby) NEDOSTÁVAJÍ access.
 */
export async function hasAccess(
  userId: string,
  userEmail: string,
  db: DrizzleD1Database
): Promise<boolean> {
  const email = userEmail.toLowerCase();

  const activePurchase = await db
    .select({ id: purchase.id })
    .from(purchase)
    .where(
      and(
        eq(purchase.status, "active"),
        gt(purchase.expiresAt, new Date()),
        or(eq(purchase.userId, userId), eq(purchase.email, email))
      )
    )
    .limit(1);

  if (activePurchase.length > 0) return true;

  const domain = email.split("@")[1];
  if (domain) {
    const activeOrg = await db
      .select({ id: organization.id })
      .from(organization)
      .where(
        and(
          eq(organization.domain, domain),
          eq(organization.status, "active")
        )
      )
      .limit(1);

    if (activeOrg.length > 0) return true;
  }

  return false;
}

/**
 * Link unlinked purchases to a user after first login.
 * Pending purchases se taky linkují — až se potvrdí platba, uživatel bude mít userId navázaný.
 */
export async function linkPurchasesToUser(
  userId: string,
  email: string,
  db: DrizzleD1Database
): Promise<void> {
  await db
    .update(purchase)
    .set({ userId })
    .where(and(eq(purchase.email, email.toLowerCase()), isNull(purchase.userId)));
}
```

- [ ] **Step 3: Typecheck**

```bash
cd /Users/patrickzandl/GitHub/videokurzy
npm run typecheck
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
cd /Users/patrickzandl/GitHub/videokurzy
git add src/lib/access.ts
git commit -m "fix(access): use isNull for userId in linkPurchasesToUser and document pending status"
```

---

## Task 11: Seed — admin uživatelé Patrick + Andrea

**Files:**
- Modify: `/Users/patrickzandl/GitHub/videokurzy/scripts/seed.sql`

- [ ] **Step 1: Číst stávající seed.sql**

```bash
cat /Users/patrickzandl/GitHub/videokurzy/scripts/seed.sql
```

- [ ] **Step 2: Přidat na konec `scripts/seed.sql` UPSERT pro admin uživatele**

```sql

-- ─── Admin uživatelé ────────────────────────────────────────────────
-- Patrick a Andrea mají role = 'admin'. Pokud uživatelé už existují
-- (z předchozího přihlášení), jen jim nastavíme role.

INSERT INTO user (id, name, email, emailVerified, role, createdAt, updatedAt)
VALUES
  ('admin-patrick-seed', 'Patrick Zandl', 'patrick@vibecoding.cz', 1, 'admin', unixepoch(), unixepoch()),
  ('admin-andrea-seed', 'Andrea Maloveczká', 'andrea@vibecoding.cz', 1, 'admin', unixepoch(), unixepoch())
ON CONFLICT(email) DO UPDATE SET role = 'admin';
```

(Pozn.: `unixepoch()` vrací aktuální čas v sekundách od epochy. Better Auth používá timestamp v sekundách nebo ms — toto je OK pro SQLite, protože Drizzle používá `mode: "timestamp"` který ukládá ms. Pokud by to dělalo problém, nahradit za `strftime('%s', 'now') * 1000`.)

**Pozn. k `id`:** Better Auth normálně generuje vlastní ID při prvním přihlášení. Pokud si Patrick/Andrea přihlásí magic linkem, vytvoří se nové záznamy — ale `ON CONFLICT(email)` zajistí, že role zůstane `admin`. Seed IDs jsou jen placeholder.

- [ ] **Step 3: Aplikovat seed**

```bash
cd /Users/patrickzandl/GitHub/videokurzy
npm run db:seed
```

- [ ] **Step 4: Ověřit admin role**

```bash
cd /Users/patrickzandl/GitHub/videokurzy
wrangler d1 execute videokurzy-db --local --command="SELECT email, role FROM user WHERE role = 'admin';"
```

Očekávaný výstup: řádky pro `patrick@vibecoding.cz` a `andrea@vibecoding.cz`, oba s `role = admin`.

- [ ] **Step 5: Commit**

```bash
cd /Users/patrickzandl/GitHub/videokurzy
git add scripts/seed.sql
git commit -m "feat(seed): add patrick and andrea as admin users"
```

---

## Task 12: Scheduled handler — skeleton pro Cron Trigger

**Files:**
- Create: `/Users/patrickzandl/GitHub/videokurzy/src/scheduled.ts`
- Modify: `/Users/patrickzandl/GitHub/videokurzy/src/index.tsx`

- [ ] **Step 1: Vytvořit `src/scheduled.ts` (skeleton)**

```typescript
import { drizzle } from "drizzle-orm/d1";
import { and, eq, lt } from "drizzle-orm";
import { purchase } from "./db/schema";
import type { Env } from "./types";

/**
 * Scheduled handler spouštěný Cloudflare Cron Triggerem.
 * Cron registrován v wrangler.toml: `[triggers] crons = ["0 3 * * *"]` (denně 03:00 UTC).
 *
 * Úkoly:
 * 1. Expirace FIO pending objednávek, kterým vypršela splatnost.
 * 2. Renewal reminders pro aktivní FIO předplatné (3/2/1 týden / 1 den před expirací).
 *    (Implementace v Etapě 2 — zatím jen TODO.)
 */
export async function handleScheduled(
  event: ScheduledEvent,
  env: Env,
  _ctx: ExecutionContext
): Promise<void> {
  const db = drizzle(env.DB);
  const now = new Date();

  // ─── 1) Expirace pending FIO objednávek ──────────────────────────
  const expiredCount = await expirePendingFioOrders(db, now);
  console.log(`[cron] Expirated ${expiredCount} pending FIO orders`);

  // ─── 2) Renewal reminders (implementace v Etapě 2) ───────────────
  // TODO(etapa-2): sendRenewalReminders(db, env, now);
}

/** Přepne všechny pending FIO objednávky s expiresAt < now na status `expired`. */
async function expirePendingFioOrders(
  db: ReturnType<typeof drizzle>,
  now: Date
): Promise<number> {
  const result = await db
    .update(purchase)
    .set({ status: "expired" })
    .where(
      and(
        eq(purchase.status, "pending"),
        eq(purchase.paymentMethod, "fio"),
        lt(purchase.expiresAt, now)
      )
    )
    .returning({ id: purchase.id });

  return result.length;
}
```

- [ ] **Step 2: Propojit scheduled handler v `src/index.tsx`**

Přečíst stávající `src/index.tsx`:
```bash
cat /Users/patrickzandl/GitHub/videokurzy/src/index.tsx
```

Na konci souboru změnit default export z:
```typescript
export default {
  fetch: app.fetch,
  queue: handleQueue,
};
```

na:
```typescript
export default {
  fetch: app.fetch,
  queue: handleQueue,
  scheduled: handleScheduled,
};
```

A přidat import na začátek:
```typescript
import { handleScheduled } from "./scheduled";
```

- [ ] **Step 3: Typecheck**

```bash
cd /Users/patrickzandl/GitHub/videokurzy
npm run typecheck
```

Expected: PASS

- [ ] **Step 4: Lokální test scheduled handleru**

```bash
cd /Users/patrickzandl/GitHub/videokurzy
npm run dev
```

V dalším terminálu:
```bash
curl "http://localhost:8787/__scheduled?cron=0+3+*+*+*"
```

Očekávaný výstup: HTTP 200, v logu dev serveru zpráva `[cron] Expirated 0 pending FIO orders`.

Stop dev server.

- [ ] **Step 5: Commit**

```bash
cd /Users/patrickzandl/GitHub/videokurzy
git add src/scheduled.ts src/index.tsx
git commit -m "feat(cron): scheduled handler for FIO pending order expiration"
```

---

## Task 13: Static CSS link — ověření v dev

**Files:**
- (Žádné soubory nemodifikujeme, jen verifikace)

- [ ] **Step 1: Spustit dev server**

```bash
cd /Users/patrickzandl/GitHub/videokurzy
npm run dev
```

- [ ] **Step 2: Ověřit, že `/styles.css` je dostupný**

```bash
curl -I http://localhost:8787/styles.css
```

Očekávaný výstup: `HTTP/1.1 200 OK`, `Content-Type: text/css`.

```bash
curl http://localhost:8787/styles.css | head -20
```

Očekávaný výstup: začátek Tailwind generated CSS (`/*! tailwindcss v4... */` nebo reset).

- [ ] **Step 3: Stop dev serveru**

`Ctrl+C` v dev terminálu.

- [ ] **Step 4: Commit — pouze pokud byly nutné změny ve wrangler/config (mělo by být PASS bez změn)**

Pokud assets binding funguje out-of-the-box, není co commitovat. Task je verifikační.

---

## Task 14: Final — regenerace `npm run build` a checklist

**Files:**
- (Žádné soubory)

- [ ] **Step 1: Typecheck**

```bash
cd /Users/patrickzandl/GitHub/videokurzy
npm run typecheck
```

Expected: PASS, žádné errory.

- [ ] **Step 2: Dry-run build**

```bash
cd /Users/patrickzandl/GitHub/videokurzy
npm run build
```

Expected: `Total Upload` info z wrangleru, žádné erroru. `public/styles.css` vygenerován a minified.

- [ ] **Step 3: Manuální smoke test**

```bash
cd /Users/patrickzandl/GitHub/videokurzy
npm run dev
```

V prohlížeči:
1. `http://localhost:8787/` — landing page se načte (bez stylingu — migrace v Etapě 4)
2. `http://localhost:8787/login` — login stránka se načte, dá odeslat email
3. `http://localhost:8787/styles.css` — Tailwind CSS se servíruje
4. `http://localhost:8787/__scheduled?cron=0+3+*+*+*` — cron handler běží, v logu vidíme zprávu

Stop dev server.

- [ ] **Step 4: Final check — git log**

```bash
cd /Users/patrickzandl/GitHub/videokurzy
git log --oneline -20
```

Ověřit, že máme commity za jednotlivé tasky:
- chore: upgrade deps...
- feat(tailwind): add tailwind v4 scaffolding...
- feat(wrangler): add static assets dir...
- chore(auth): upgrade better-auth...
- feat(config): add payment config...
- feat(config): add freemail domains blacklist...
- feat(config): add admin emails...
- feat(schema): extend purchase...
- feat(db): migration for purchase fio extension
- fix(access): use isNull...
- feat(seed): add patrick and andrea as admin users
- feat(cron): scheduled handler...

---

## Hotovo — Etapa 1 complete

Po dokončení této etapy máme:
- ✅ Tailwind CSS v4 build step + `public/styles.css` servírovaný ze Cloudflare assets
- ✅ Better Auth na nejnovější verzi
- ✅ Purchase schéma rozšířené o `paymentMethod`, `variableSymbol`, `fioTransactionId`, `pending` status
- ✅ Drizzle relations na všech tabulkách
- ✅ Konfigurační soubory (`payment.ts`, `freemail-domains.ts`, `admin.ts`)
- ✅ Patrick a Andrea jako admin uživatelé
- ✅ Cloudflare Cron Trigger + scheduled handler s expirací FIO pending objednávek
- ✅ `hasAccess()` automaticky nedovolí přístup pending FIO purchases

**Stávající funkce nezměněné:** Stripe checkout (karta), Stripe webhook → Queue → active purchase, login/dashboard/watch flow, landing page.

**Další etapa:** Etapa 2 — FIO integrace (nové checkout routes, FIO payment page, verify endpoint, renewal reminders).
