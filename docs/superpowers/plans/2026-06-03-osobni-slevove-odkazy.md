# Osobní slevové odkazy (invite tokeny) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Umožnit rozeslání osobních jednorázových odkazů, které příjemci aktivují 50% slevu na nákup kurzu (B2C i B2B) bez psaní promo kódu.

**Architecture:** Nová tabulka `discount_invite` drží per-osobu tokeny. Checkout pozná `?invite=TOKEN` v URL, ověří token a aplikuje slevu (s předností před globální slevou). Token se spotřebuje až při aktivaci zaplaceného nákupu (Stripe queue / FIO verify). Generátor z CSV vyrobí tokeny + odkazy a SQL dávku pro `wrangler d1 execute --remote`; rozeslání přes Resend.

**Tech Stack:** Hono + JSX (Cloudflare Workers), Drizzle ORM nad D1, Stripe, nanoid, Vitest s `@cloudflare/vitest-pool-workers` (reálná D1 v testech), ruční SQL migrace.

---

## Důležité konvence projektu (z CLAUDE.md)

- **Před commitem vždy:** `npm run typecheck && npm test`. Necommituj bez zelených testů.
- **Migrace piš ručně** jako `drizzle/migrations/NNNN_nazev.sql` (drizzle-kit generate je rozbité). Zároveň uprav `src/db/schema.ts`.
- **Po nasazení migrace** (na výslovný pokyn uživatele k deployi) spusť `npm run db:migrate:prod`.
- **Ověřuj obsah, ne jen exit kód** — po editaci grepni, že kód je v souboru.
- Commit/push/deploy jen na výslovný pokyn uživatele.

## Soubory (mapa odpovědností)

- **Create** `drizzle/migrations/0021_discount_invite.sql` — tabulka `discount_invite`.
- **Modify** `src/db/schema.ts` — drizzle definice `discountInvite`.
- **Modify** `src/lib/discount.ts` — `resolveInviteDiscount`, `consumeInviteToken`, rozšíření `resolveCheckoutDiscount`, `AppliedDiscount.source`.
- **Modify** `src/routes/checkout.tsx` — čtení `invite` v GET/POST, Stripe metadata, FIO spotřeba tokenu.
- **Modify** `src/views/checkout.tsx` — hidden pole `inviteToken`, zobrazení invite slevy, skrytí promo inputu při invite.
- **Modify** `src/queue.ts` — spotřeba tokenu po Stripe aktivaci.
- **Create** `src/lib/invite-generate.ts` — čistá funkce `buildInviteRows` (testovatelná).
- **Create** `scripts/discount-invites/generate.mjs` — CLI obálka (čte CSV, píše SQL + CSV výstup).
- **Create** `tests/lib/invite-discount.test.ts` — testy DB funkcí.
- **Create** `tests/lib/invite-generate.test.ts` — testy generátoru.
- **Create** `tests/routes/checkout-invite.test.ts` — integrační test checkoutu s `?invite=`.

---

## Task 1: Migrace a schema pro `discount_invite`

**Files:**
- Create: `drizzle/migrations/0021_discount_invite.sql`
- Modify: `src/db/schema.ts` (po bloku `purchase`, před `// ─── Relations`)

- [ ] **Step 1: Napiš migraci**

Create `drizzle/migrations/0021_discount_invite.sql`:

```sql
CREATE TABLE `discount_invite` (
	`token` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`percent` integer NOT NULL,
	`label` text,
	`expiresAt` integer,
	`createdAt` integer NOT NULL,
	`batch` text,
	`usedAt` integer,
	`usedByPurchaseId` integer
);
--> statement-breakpoint
CREATE INDEX `discount_invite_batch_idx` ON `discount_invite` (`batch`);
```

- [ ] **Step 2: Přidej drizzle definici do `src/db/schema.ts`**

Vlož za uzavírací `]);` tabulky `purchase` (řádek ~126), před `// ─── Relations`:

```typescript
export const discountInvite = sqliteTable("discount_invite", {
  // Náhodný nanoid() token, nese se v URL jako ?invite=TOKEN.
  token: text("token").primaryKey(),
  // Komu byl vystaven — jen evidence, shoda e-mailu se při nákupu nevynucuje.
  email: text("email").notNull(),
  percent: integer("percent").notNull(),
  // Popisek do checkoutu, např. "Osobní sleva pro absolventy".
  label: text("label"),
  // NULL = bez expirace; jinak token platí jen do tohoto data.
  expiresAt: integer("expiresAt", { mode: "timestamp" }),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  // Označení dávky (např. "vibecoding-2026-06") pro reporting.
  batch: text("batch"),
  // NULL = nevyužitý; vyplní se při aktivaci zaplaceného nákupu.
  usedAt: integer("usedAt", { mode: "timestamp" }),
  // Který purchase token spotřeboval (FK na purchase.id, bez DB constraintu).
  usedByPurchaseId: integer("usedByPurchaseId"),
});
```

- [ ] **Step 3: Aplikuj migraci lokálně a ověř typecheck**

Run: `npm run db:migrate && npm run typecheck`
Expected: migrace projde, typecheck bez chyb.

- [ ] **Step 4: Ověř obsah**

Run: `grep -c "discount_invite" drizzle/migrations/0021_discount_invite.sql src/db/schema.ts`
Expected: nenulové počty v obou souborech.

- [ ] **Step 5: Commit**

```bash
git add drizzle/migrations/0021_discount_invite.sql src/db/schema.ts
git commit -m "feat(discount): tabulka discount_invite pro osobní slevové odkazy"
```

---

## Task 2: `resolveInviteDiscount` a `consumeInviteToken`

**Files:**
- Modify: `src/lib/discount.ts`
- Test: `tests/lib/invite-discount.test.ts`

- [ ] **Step 1: Napiš padající testy**

Create `tests/lib/invite-discount.test.ts`:

```typescript
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { discountInvite } from "../../src/db/schema";
import {
  resolveInviteDiscount,
  consumeInviteToken,
} from "../../src/lib/discount";

const NOW = new Date("2026-06-03T10:00:00.000Z");

describe("resolveInviteDiscount", () => {
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM discount_invite");
  });

  async function seed(overrides: Partial<typeof discountInvite.$inferInsert> = {}) {
    const db = drizzle(env.DB);
    await db.insert(discountInvite).values({
      token: "tok-valid",
      email: "absolvent@example.cz",
      percent: 50,
      label: "Osobní sleva",
      expiresAt: new Date("2026-12-31T00:00:00.000Z"),
      createdAt: NOW,
      batch: "vibecoding-2026-06",
      usedAt: null,
      usedByPurchaseId: null,
      ...overrides,
    });
    return db;
  }

  it("returns discount for a valid token", async () => {
    const db = await seed();
    const r = await resolveInviteDiscount(db, "tok-valid", NOW);
    expect(r).toEqual({ percent: 50, token: "tok-valid", label: "Osobní sleva" });
  });

  it("returns null for unknown token", async () => {
    const db = await seed();
    expect(await resolveInviteDiscount(db, "nope", NOW)).toBeNull();
  });

  it("returns null for expired token", async () => {
    const db = await seed({ token: "tok-exp", expiresAt: new Date("2026-01-01T00:00:00.000Z") });
    expect(await resolveInviteDiscount(db, "tok-exp", NOW)).toBeNull();
  });

  it("returns null for already used token", async () => {
    const db = await seed({ token: "tok-used", usedAt: NOW });
    expect(await resolveInviteDiscount(db, "tok-used", NOW)).toBeNull();
  });

  it("treats NULL expiresAt as no expiry", async () => {
    const db = await seed({ token: "tok-forever", expiresAt: null });
    const r = await resolveInviteDiscount(db, "tok-forever", NOW);
    expect(r?.percent).toBe(50);
  });

  it("trims and ignores empty token", async () => {
    const db = await seed();
    expect(await resolveInviteDiscount(db, "   ", NOW)).toBeNull();
    expect(await resolveInviteDiscount(db, null, NOW)).toBeNull();
  });
});

describe("consumeInviteToken", () => {
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM discount_invite");
  });

  it("marks token used once and is idempotent", async () => {
    const db = drizzle(env.DB);
    await db.insert(discountInvite).values({
      token: "tok-c",
      email: "a@b.cz",
      percent: 50,
      createdAt: NOW,
    });

    const first = await consumeInviteToken(db, "tok-c", 555, NOW);
    const second = await consumeInviteToken(db, "tok-c", 999, NOW);

    expect(first).toBe(true);
    expect(second).toBe(false);

    const [row] = await db
      .select()
      .from(discountInvite)
      .where(eq(discountInvite.token, "tok-c"));
    expect(row.usedByPurchaseId).toBe(555);
    expect(row.usedAt).not.toBeNull();
  });
});
```

- [ ] **Step 2: Spusť testy a ověř, že padají**

Run: `npx vitest run tests/lib/invite-discount.test.ts`
Expected: FAIL — `resolveInviteDiscount`/`consumeInviteToken` neexistují (import error).

- [ ] **Step 3: Implementuj funkce v `src/lib/discount.ts`**

Uprav import na řádku 14 (přidej `isNull`, `or`):

```typescript
import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
```

Uprav import na řádku 15 (přidej `discountInvite`):

```typescript
import { purchase, discountInvite } from "../db/schema";
```

Přidej typ `InviteDiscount` za `AppliedDiscount` (řádek ~50):

```typescript
export type InviteDiscount = {
  percent: number;
  token: string;
  label: string | null;
};
```

Přidej na konec souboru (za `isCodeActive`):

```typescript
/**
 * Načte invite slevu pro daný token, pokud je platná.
 * Platný = existuje, není využitý (usedAt IS NULL) a buď nemá expiraci,
 * nebo expirace ještě neuplynula.
 */
export async function resolveInviteDiscount(
  db: Db,
  token: string | null,
  now = new Date(),
): Promise<InviteDiscount | null> {
  const normalized = token?.trim() || null;
  if (!normalized) return null;

  const row = await db
    .select({
      token: discountInvite.token,
      percent: discountInvite.percent,
      label: discountInvite.label,
      expiresAt: discountInvite.expiresAt,
      usedAt: discountInvite.usedAt,
    })
    .from(discountInvite)
    .where(eq(discountInvite.token, normalized))
    .get();

  if (!row) return null;
  if (row.usedAt) return null;
  if (row.percent <= 0) return null;
  if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) return null;

  return { percent: row.percent, token: row.token, label: row.label };
}

/**
 * Spotřebuje invite token — atomicky a idempotentně. Označí usedAt + purchaseId
 * jen pokud token ještě nebyl využit. Vrací true, když ho zrovna spotřeboval.
 */
export async function consumeInviteToken(
  db: Db,
  token: string,
  purchaseId: number,
  now = new Date(),
): Promise<boolean> {
  const updated = await db
    .update(discountInvite)
    .set({ usedAt: now, usedByPurchaseId: purchaseId })
    .where(and(eq(discountInvite.token, token), isNull(discountInvite.usedAt)))
    .returning({ token: discountInvite.token });
  return updated.length > 0;
}
```

> Pozn.: `or` je v importu připraven pro Task 3 (nebude hlásit unused — použije se tam). Pokud by typecheck v této tasku hlásil nepoužitý import, přidej `or` až v Tasku 3.

- [ ] **Step 4: Spusť testy a ověř, že prochází**

Run: `npx vitest run tests/lib/invite-discount.test.ts`
Expected: PASS (všech 8 testů).

- [ ] **Step 5: Commit**

```bash
git add src/lib/discount.ts tests/lib/invite-discount.test.ts
git commit -m "feat(discount): resolveInviteDiscount + consumeInviteToken"
```

---

## Task 3: Invite má přednost v `resolveCheckoutDiscount`

**Files:**
- Modify: `src/lib/discount.ts`
- Test: `tests/lib/invite-discount.test.ts` (přidat describe blok)

- [ ] **Step 1: Přidej padající testy**

Přidej na konec `tests/lib/invite-discount.test.ts` nový describe blok:

```typescript
import { resolveCheckoutDiscount, type DiscountSettings } from "../../src/lib/discount";

describe("resolveCheckoutDiscount with invite", () => {
  const NOW2 = new Date("2026-06-03T10:00:00.000Z");
  const offSettings: DiscountSettings = {
    active: false,
    percent: 0,
    limit: 0,
    code: "",
    codeExpiresAt: null,
    label: "",
  };

  beforeEach(async () => {
    await env.DB.exec("DELETE FROM discount_invite");
    await env.DB.exec("DELETE FROM purchase");
  });

  it("applies invite discount even when global discount is off", async () => {
    const db = drizzle(env.DB);
    await db.insert(discountInvite).values({
      token: "inv-1",
      email: "x@y.cz",
      percent: 50,
      label: "Osobní sleva",
      createdAt: NOW2,
    });

    const r = await resolveCheckoutDiscount(db, offSettings, null, "inv-1", NOW2);
    expect(r).toEqual({ percent: 50, code: "invite:inv-1", source: "invite" });
  });

  it("invite takes precedence over an active global auto discount", async () => {
    const db = drizzle(env.DB);
    await db.insert(discountInvite).values({
      token: "inv-2",
      email: "x@y.cz",
      percent: 50,
      createdAt: NOW2,
    });
    const autoSettings: DiscountSettings = {
      active: true,
      percent: 30,
      limit: 100,
      code: "",
      codeExpiresAt: null,
      label: "Zaváděcí",
    };

    const r = await resolveCheckoutDiscount(db, autoSettings, null, "inv-2", NOW2);
    expect(r?.source).toBe("invite");
    expect(r?.percent).toBe(50);
  });

  it("falls back to global logic when invite token is invalid", async () => {
    const db = drizzle(env.DB);
    const r = await resolveCheckoutDiscount(db, offSettings, null, "nonexistent", NOW2);
    expect(r).toBeNull();
  });
});
```

- [ ] **Step 2: Spusť testy a ověř, že padají**

Run: `npx vitest run tests/lib/invite-discount.test.ts -t "with invite"`
Expected: FAIL — `resolveCheckoutDiscount` zatím nezná parametr `inviteToken`, invite testy selžou.

- [ ] **Step 3: Rozšiř `AppliedDiscount` a `resolveCheckoutDiscount`**

V `src/lib/discount.ts` uprav typ `AppliedDiscount` (řádek ~46):

```typescript
export type AppliedDiscount = {
  percent: number;
  code: string | null;
  source: "auto" | "code" | "invite";
};
```

Nahraď celou funkci `resolveCheckoutDiscount` (řádky ~98-124) touto verzí (přidán parametr `inviteToken`):

```typescript
export async function resolveCheckoutDiscount(
  db: Db,
  settings: DiscountSettings,
  providedCode: string | null,
  inviteToken: string | null = null,
  now = new Date(),
): Promise<AppliedDiscount | null> {
  // Invite token má vždy přednost a funguje i když je globální sleva vypnutá.
  const invite = await resolveInviteDiscount(db, inviteToken, now);
  if (invite) {
    return {
      percent: invite.percent,
      code: `invite:${invite.token}`,
      source: "invite",
    };
  }

  const stage = await getDiscountState(db, settings, now);
  const normalizedCode = providedCode?.trim() || null;
  const codeMatches = !!(
    normalizedCode &&
    settings.code &&
    normalizedCode.toLowerCase() === settings.code.trim().toLowerCase() &&
    isCodeActive(settings, now)
  );

  if (stage.kind === "auto") {
    return {
      percent: stage.percent,
      code: codeMatches ? settings.code : null,
      source: codeMatches ? "code" : "auto",
    };
  }
  if (stage.kind === "code-only" && codeMatches) {
    return { percent: stage.percent, code: settings.code, source: "code" };
  }
  return null;
}
```

> `resolveInviteDiscount` musí být v souboru definováno před `resolveCheckoutDiscount`, nebo (protože jde o `function` deklarace) hoisting zajistí dostupnost — obě jsou `export async function`, takže pořadí nevadí.

- [ ] **Step 4: Spusť celý discount test soubor**

Run: `npx vitest run tests/lib/invite-discount.test.ts tests/lib/discount.test.ts`
Expected: PASS.

- [ ] **Step 5: Ověř, že stávající volání nejsou rozbitá (3. param defaultní)**

Run: `npm run typecheck`
Expected: bez chyb. Stávající `resolveCheckoutDiscount(db, settings, promoCode || null)` v `checkout.tsx` zůstává platné (nový parametr má default).

- [ ] **Step 6: Commit**

```bash
git add src/lib/discount.ts tests/lib/invite-discount.test.ts
git commit -m "feat(discount): invite token má přednost v resolveCheckoutDiscount"
```

---

## Task 4: Checkout route — čtení `invite`, Stripe metadata, FIO spotřeba

**Files:**
- Modify: `src/routes/checkout.tsx`
- Test: `tests/routes/checkout-invite.test.ts`

- [ ] **Step 1: Napiš padající integrační test (GET zobrazí sníženou cenu)**

Create `tests/routes/checkout-invite.test.ts`:

```typescript
import { env, SELF } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import { discountInvite } from "../../src/db/schema";

describe("checkout with ?invite=", () => {
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM discount_invite");
  });

  async function seedInvite(token: string) {
    const db = drizzle(env.DB);
    await db.insert(discountInvite).values({
      token,
      email: "absolvent@example.cz",
      percent: 50,
      label: "Osobní sleva",
      expiresAt: new Date("2026-12-31T00:00:00.000Z"),
      createdAt: new Date("2026-06-03T10:00:00.000Z"),
    });
  }

  it("shows discounted B2C price and a hidden inviteToken field", async () => {
    await seedInvite("inv-b2c");
    const res = await SELF.fetch(
      "https://test.local/checkout/individual?invite=inv-b2c",
    );
    const html = await res.text();
    expect(res.status).toBe(200);
    // 2000 → 1000 Kč
    expect(html).toContain("1 000 Kč");
    expect(html).toContain('name="inviteToken"');
    expect(html).toContain('value="inv-b2c"');
    expect(html).toContain("Osobní sleva");
  });

  it("shows discounted B2B price for organization checkout", async () => {
    await seedInvite("inv-b2b");
    const res = await SELF.fetch(
      "https://test.local/checkout/organization?invite=inv-b2b",
    );
    const html = await res.text();
    // 15000 → 7500 Kč
    expect(html).toContain("7 500 Kč");
    expect(html).toContain('value="inv-b2b"');
  });

  it("ignores an invalid invite token (full price, no hidden field)", async () => {
    const res = await SELF.fetch(
      "https://test.local/checkout/individual?invite=does-not-exist",
    );
    const html = await res.text();
    expect(html).not.toContain('name="inviteToken"');
    expect(html).toContain("2 000 Kč");
  });
});
```

- [ ] **Step 2: Spusť test a ověř, že padá**

Run: `npx vitest run tests/routes/checkout-invite.test.ts`
Expected: FAIL — chybí `name="inviteToken"`, cena je plná 2000.

- [ ] **Step 3: Rozšiř `checkoutSelectView` o invite token**

V `src/routes/checkout.tsx` nahraď signaturu a tělo `checkoutSelectView` (řádky ~276-322). Přidej do `opts` pole `inviteToken?: string` a `inviteLabel?: string` a předej je do view. Konkrétně:

V `opts` objektu (po `prefillBilling?: boolean;`) přidej:

```typescript
    inviteToken?: string;
    inviteLabel?: string | null;
    invitePercent?: number;
```

A v těle funkce nahraď výpočet ceny a `return` blok:

```typescript
  const prices = await getPrices(db);
  const settings = await getDiscountSettings(db);
  const stage = await getDiscountState(db, settings);
  const priceOriginal = type === "organization" ? prices.organization : prices.individual;

  // Invite token (pokud platný) má přednost a určí cenu i popisek rovnou.
  const hasInvite = !!opts.inviteToken && (opts.invitePercent ?? 0) > 0;
  const effectivePercent = hasInvite
    ? (opts.invitePercent ?? 0)
    : stage.kind === "auto"
      ? stage.percent
      : 0;
  const priceFinal = effectivePercent > 0
    ? applyDiscount(priceOriginal, effectivePercent)
    : priceOriginal;
  const effectiveLabel = hasInvite
    ? (opts.inviteLabel || "Osobní sleva")
    : stage.kind === "auto"
      ? stage.label
      : undefined;
  // Promo input ukazujeme jen mimo invite režim.
  const showCodeInput = !hasInvite && ((stage.kind === "auto" && stage.codeActive) || stage.kind === "code-only");

  return (
    <CheckoutSelect
      type={type}
      error={opts.error}
      prefillEmail={opts.prefillEmail}
      prefillDomain={opts.prefillDomain}
      prefillCode={opts.prefillCode}
      prefillCompany={opts.prefillCompany}
      prefillBilling={opts.prefillBilling}
      priceOriginal={priceOriginal}
      priceFinal={priceFinal}
      discountPercent={effectivePercent}
      discountLabel={effectiveLabel}
      showCodeInput={showCodeInput}
      inviteToken={opts.inviteToken}
    />
  );
```

- [ ] **Step 4: Načti invite v GET routách**

Nahraď GET `/checkout/individual` (řádky ~175-179):

```typescript
checkoutRoutes.get("/checkout/individual", async (c) => {
  const db = drizzle(c.env.DB);
  const inviteToken = c.req.query("invite") ?? undefined;
  const invite = await resolveInviteDiscount(db, inviteToken ?? null);
  const view = await checkoutSelectView(db, "individual", {
    inviteToken: invite ? invite.token : undefined,
    inviteLabel: invite?.label,
    invitePercent: invite?.percent,
  });
  return c.html(<Layout title="Roční přístup — kurzy.vibecoding.cz">{view}</Layout>);
});
```

Nahraď GET `/checkout/organization` (řádky ~217-221):

```typescript
checkoutRoutes.get("/checkout/organization", async (c) => {
  const db = drizzle(c.env.DB);
  const inviteToken = c.req.query("invite") ?? undefined;
  const invite = await resolveInviteDiscount(db, inviteToken ?? null);
  const view = await checkoutSelectView(db, "organization", {
    inviteToken: invite ? invite.token : undefined,
    inviteLabel: invite?.label,
    invitePercent: invite?.percent,
  });
  return c.html(<Layout title="Firemní licence — kurzy.vibecoding.cz">{view}</Layout>);
});
```

Přidej `resolveInviteDiscount` do importu z `../lib/discount` (řádky ~33-39):

```typescript
import {
  applyDiscount,
  getDiscountState,
  resolveCheckoutDiscount,
  resolveInviteDiscount,
  consumeInviteToken,
  type DiscountSettings,
  type AppliedDiscount,
} from "../lib/discount";
```

- [ ] **Step 5: Předej invite token v POST routách**

V POST `/checkout/individual` (řádky ~181-213): za řádek čtení `promoCode` (~186) přidej:

```typescript
  const inviteToken = String(form.get("inviteToken") ?? "").trim() || null;
```

a uprav volání `resolveCheckoutDiscount` (řádek ~204):

```typescript
  const discount = await resolveCheckoutDiscount(db, settings, promoCode || null, inviteToken);
```

V chybové větvi (neplatný email, ~191-198) přidej do `checkoutSelectView` opts znovu zobrazení invite (aby se po chybě sleva neztratila): za `prefillBilling: !!billing,` doplň:

```typescript
      inviteToken: inviteToken ?? undefined,
      invitePercent: inviteToken ? (await resolveInviteDiscount(db, inviteToken))?.percent : undefined,
      inviteLabel: inviteToken ? (await resolveInviteDiscount(db, inviteToken))?.label : undefined,
```

V POST `/checkout/organization` (řádky ~223-260): za řádek čtení `promoCode` (~229) přidej:

```typescript
  const inviteToken = String(form.get("inviteToken") ?? "").trim() || null;
```

uprav volání `resolveCheckoutDiscount` (~251):

```typescript
  const discount = await resolveCheckoutDiscount(db, settings, promoCode || null, inviteToken);
```

a v `renderError` helperu (~233-243) přidej do opts za `prefillBilling: !!billing,`:

```typescript
      inviteToken: inviteToken ?? undefined,
      invitePercent: inviteToken ? (await resolveInviteDiscount(db, inviteToken))?.percent : undefined,
      inviteLabel: inviteToken ? (await resolveInviteDiscount(db, inviteToken))?.label : undefined,
```

- [ ] **Step 6: Předej invite token do Stripe metadata**

V `startStripeCheckout` (řádky ~326-379) uprav `metadata` objekt — invite token se uloží do metadata, aby ho queue handler po zaplacení spotřeboval. `discount.code` u invite obsahuje `invite:<token>`, proto stačí přidat čistý token:

V `metadata` (řádky ~369-375) přidej řádek za `...(discount?.code ? { discountCode: discount.code } : {}),`:

```typescript
      ...(discount?.source === "invite" && discount.code
        ? { inviteToken: discount.code.replace(/^invite:/, "") }
        : {}),
```

- [ ] **Step 7: Spotřebuj token po FIO platbě**

V `/api/fio/verify/:vs` (řádky ~612-695), za úspěšným `activateFioPurchaseIfPending` (po bloku `if (!activated) {...}`, před `c.executionCtx.waitUntil(sendEmail...`) přidej:

```typescript
  // Invite token (uložený v discountCode jako "invite:<token>") se spotřebuje
  // až teď, po napárování platby a aktivaci nákupu.
  if (p.discountCode?.startsWith("invite:")) {
    const token = p.discountCode.slice("invite:".length);
    await consumeInviteToken(db, token, p.id);
  }
```

- [ ] **Step 8: Spusť testy a ověř, že prochází**

Run: `npx vitest run tests/routes/checkout-invite.test.ts`
Expected: PASS (3 testy).

> Pozn.: tento test ověří GET render. Spotřebu tokenu při Stripe pokrývá Task 6, FIO spotřebu lze ověřit ručně / doplnit v Tasku 6. View změny (hidden pole) jsou v Tasku 5 — pokud test v tomto kroku ještě hlásí chybějící `name="inviteToken"`, dokonči nejdřív Task 5 a vrať se sem (úkoly jdou v páru 4↔5).

- [ ] **Step 9: Typecheck + ověř obsah**

Run: `npm run typecheck && grep -c "inviteToken" src/routes/checkout.tsx`
Expected: typecheck OK, grep nenulový.

- [ ] **Step 10: Commit**

```bash
git add src/routes/checkout.tsx tests/routes/checkout-invite.test.ts
git commit -m "feat(checkout): čtení ?invite=, Stripe metadata a FIO spotřeba tokenu"
```

---

## Task 5: View — hidden pole `inviteToken`

**Files:**
- Modify: `src/views/checkout.tsx`

- [ ] **Step 1: Přidej prop `inviteToken` do `CheckoutSelect`**

V `src/views/checkout.tsx` přidej do typu props (po `showCodeInput?: boolean;`, řádek ~28):

```typescript
  inviteToken?: string;
```

a do destructuringu (po `showCodeInput = false,`, řádek ~41):

```typescript
  inviteToken,
```

- [ ] **Step 2: Vlož hidden input do formuláře**

Hned za otevírací `<form method="post" hx-boost="false" class="space-y-5">` (řádek ~81) vlož:

```tsx
          {inviteToken && (
            <input type="hidden" name="inviteToken" value={inviteToken} />
          )}
```

- [ ] **Step 3: Spusť checkout-invite test a ověř, že prochází**

Run: `npx vitest run tests/routes/checkout-invite.test.ts`
Expected: PASS (3 testy) — nyní se hidden pole renderuje.

- [ ] **Step 4: Ověř obsah**

Run: `grep -c "inviteToken" src/views/checkout.tsx`
Expected: 3 (typ, destructuring, hidden input).

- [ ] **Step 5: Commit**

```bash
git add src/views/checkout.tsx
git commit -m "feat(checkout): hidden pole inviteToken ve výběru platby"
```

---

## Task 6: Spotřeba tokenu po Stripe aktivaci

**Files:**
- Modify: `src/queue.ts`
- Test: `tests/queue.test.ts` (přidat test)

- [ ] **Step 1: Přidej padající test**

Prohlédni `tests/queue.test.ts` a najdi, jak se volá handler (pravděpodobně `handleQueue` s mock batch nebo přímo helper). Přidej test, který po zpracování `checkout.session.completed` s `metadata.inviteToken` ověří, že token je spotřebovaný. Vzor (přizpůsob existujícímu stylu volání v souboru):

```typescript
import { discountInvite, purchase } from "../src/db/schema";
import { eq } from "drizzle-orm";

it("consumes invite token after Stripe activation", async () => {
  const db = drizzle(env.DB);
  await env.DB.exec("DELETE FROM discount_invite");
  await env.DB.exec("DELETE FROM purchase");
  await db.insert(discountInvite).values({
    token: "q-inv",
    email: "buyer@example.cz",
    percent: 50,
    createdAt: new Date("2026-06-03T10:00:00.000Z"),
  });

  await handleQueue(
    {
      messages: [
        {
          body: {
            type: "checkout.session.completed",
            data: {
              id: "cs_test_invite_1",
              customer_email: "buyer@example.cz",
              amount_total: 100000, // 1000 Kč v haléřích
              metadata: {
                type: "individual",
                discountPercent: "50",
                discountCode: "invite:q-inv",
                inviteToken: "q-inv",
              },
            },
          },
          ack() {},
          retry() {},
        },
      ],
    } as never,
    env as never,
  );

  const [row] = await db
    .select()
    .from(discountInvite)
    .where(eq(discountInvite.token, "q-inv"));
  expect(row.usedAt).not.toBeNull();
  const [p] = await db
    .select()
    .from(purchase)
    .where(eq(purchase.stripePaymentId, "cs_test_invite_1"));
  expect(row.usedByPurchaseId).toBe(p.id);
});
```

> Pokud `tests/queue.test.ts` volá handler jinak (např. interní `handleCheckoutCompleted`), použij stejný způsob jako okolní testy. Cílem je: po zpracování zprávy je `discount_invite.usedAt` vyplněné.

- [ ] **Step 2: Spusť test a ověř, že padá**

Run: `npx vitest run tests/queue.test.ts -t "consumes invite token"`
Expected: FAIL — `usedAt` je null (spotřeba zatím není implementovaná).

- [ ] **Step 3: Implementuj spotřebu v `src/queue.ts`**

Přidej `consumeInviteToken` import (uprav řádek 5 / přidej nový import za řádek 6):

```typescript
import { consumeInviteToken } from "./lib/discount";
```

Přidej `discountInvite` není potřeba — pracujeme přes `consumeInviteToken`. Pro získání `purchase.id` po idempotentním insertu přidej helper a volání.

V `handleCheckoutCompleted`, na úplný konec funkce (po obou větvích individual/organization, před uzavírací `}`), přidej:

```typescript
  // Invite token spotřebujeme až po aktivaci nákupu. purchase.id dohledáme podle
  // stripePaymentId (insert je onConflictDoNothing bez returning). Idempotentní —
  // duplicitní webhook token znovu nespálí.
  const inviteToken = metadata.inviteToken;
  if (inviteToken) {
    const [createdPurchase] = await db
      .select({ id: purchase.id })
      .from(purchase)
      .where(eq(purchase.stripePaymentId, sessionId))
      .limit(1);
    if (createdPurchase) {
      await consumeInviteToken(db, inviteToken, createdPurchase.id);
    }
  }
```

> `purchase`, `eq` a `db` jsou v `queue.ts` už importované/dostupné (řádky 2, 4, 23).

- [ ] **Step 4: Spusť test a ověř, že prochází**

Run: `npx vitest run tests/queue.test.ts`
Expected: PASS.

- [ ] **Step 5: Ověř obsah + typecheck**

Run: `npm run typecheck && grep -c "consumeInviteToken" src/queue.ts`
Expected: typecheck OK, grep ≥ 1.

- [ ] **Step 6: Commit**

```bash
git add src/queue.ts tests/queue.test.ts
git commit -m "feat(queue): spotřeba invite tokenu po Stripe aktivaci"
```

---

## Task 7: Generátor tokenů z CSV

**Files:**
- Create: `src/lib/invite-generate.ts`
- Create: `tests/lib/invite-generate.test.ts`
- Create: `scripts/discount-invites/generate.mjs`

- [ ] **Step 1: Napiš padající test čisté funkce**

Create `tests/lib/invite-generate.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { buildInviteRows } from "../../src/lib/invite-generate";

describe("buildInviteRows", () => {
  // Deterministický generátor tokenů pro test.
  let n = 0;
  const fakeToken = () => `tok${++n}`;

  it("builds one row per unique email with token, url and SQL", () => {
    n = 0;
    const out = buildInviteRows(["a@x.cz", "b@y.cz"], {
      percent: 50,
      batch: "vibecoding-2026-06",
      label: "Osobní sleva",
      expiresAt: new Date("2026-12-31T00:00:00.000Z"),
      baseUrl: "https://kurzy.vibecoding.cz",
      now: new Date("2026-06-03T10:00:00.000Z"),
      genToken: fakeToken,
    });

    expect(out.rows).toHaveLength(2);
    expect(out.rows[0]).toMatchObject({
      email: "a@x.cz",
      token: "tok1",
      url: "https://kurzy.vibecoding.cz/checkout/individual?invite=tok1",
    });
    expect(out.sql).toContain("INSERT INTO discount_invite");
    expect(out.sql).toContain("'tok1'");
    expect(out.sql).toContain("'a@x.cz'");
    // expiresAt jako unix epoch v sekundách (timestamp mode)
    expect(out.sql).toContain(String(Math.floor(new Date("2026-12-31T00:00:00.000Z").getTime() / 1000)));
  });

  it("normalizes and dedupes emails, skips blanks", () => {
    n = 0;
    const out = buildInviteRows(["A@X.cz", " a@x.cz ", "", "b@y.cz"], {
      percent: 50,
      batch: "b",
      label: null,
      expiresAt: null,
      baseUrl: "https://kurzy.vibecoding.cz",
      now: new Date("2026-06-03T10:00:00.000Z"),
      genToken: fakeToken,
    });
    expect(out.rows.map((r) => r.email)).toEqual(["a@x.cz", "b@y.cz"]);
  });

  it("escapes single quotes in email to prevent broken SQL", () => {
    n = 0;
    const out = buildInviteRows(["o'brien@x.cz"], {
      percent: 50, batch: "b", label: null, expiresAt: null,
      baseUrl: "https://kurzy.vibecoding.cz",
      now: new Date("2026-06-03T10:00:00.000Z"),
      genToken: fakeToken,
    });
    expect(out.sql).toContain("'o''brien@x.cz'");
  });
});
```

- [ ] **Step 2: Spusť test a ověř, že padá**

Run: `npx vitest run tests/lib/invite-generate.test.ts`
Expected: FAIL — modul neexistuje.

- [ ] **Step 3: Implementuj `src/lib/invite-generate.ts`**

```typescript
// Čistá logika generátoru invite tokenů — bez I/O, aby šla testovat.
// CLI obálka (scripts/discount-invites/generate.mjs) řeší čtení CSV a zápis souborů.

export interface BuildInviteOptions {
  percent: number;
  batch: string;
  label: string | null;
  expiresAt: Date | null;
  baseUrl: string;
  now: Date;
  genToken: () => string;
}

export interface InviteRow {
  email: string;
  token: string;
  url: string;
}

export interface BuildInviteResult {
  rows: InviteRow[];
  sql: string;
}

function sqlString(v: string): string {
  return `'${v.replace(/'/g, "''")}'`;
}

function sqlTimestamp(d: Date | null): string {
  // Drizzle timestamp mode ukládá unix epoch v SEKUNDÁCH.
  return d ? String(Math.floor(d.getTime() / 1000)) : "NULL";
}

export function buildInviteRows(
  emails: string[],
  opts: BuildInviteOptions,
): BuildInviteResult {
  const seen = new Set<string>();
  const rows: InviteRow[] = [];

  for (const raw of emails) {
    const email = raw.trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    const token = opts.genToken();
    rows.push({
      email,
      token,
      url: `${opts.baseUrl}/checkout/individual?invite=${token}`,
    });
  }

  const createdAt = sqlTimestamp(opts.now);
  const expiresAt = sqlTimestamp(opts.expiresAt);
  const label = opts.label === null ? "NULL" : sqlString(opts.label);
  const batch = sqlString(opts.batch);

  const values = rows
    .map(
      (r) =>
        `  (${sqlString(r.token)}, ${sqlString(r.email)}, ${opts.percent}, ${label}, ${expiresAt}, ${createdAt}, ${batch}, NULL, NULL)`,
    )
    .join(",\n");

  const sql =
    rows.length === 0
      ? "-- žádné e-maily\n"
      : `INSERT INTO discount_invite (token, email, percent, label, expiresAt, createdAt, batch, usedAt, usedByPurchaseId) VALUES\n${values};\n`;

  return { rows, sql };
}
```

- [ ] **Step 4: Spusť test a ověř, že prochází**

Run: `npx vitest run tests/lib/invite-generate.test.ts`
Expected: PASS (3 testy).

- [ ] **Step 5: Napiš CLI obálku**

Create `scripts/discount-invites/generate.mjs`:

```javascript
#!/usr/bin/env node
// Generátor osobních slevových odkazů.
//
// Použití:
//   node scripts/discount-invites/generate.mjs \
//     --csv emails.csv --percent 50 --batch vibecoding-2026-06 \
//     --label "Osobní sleva pro absolventy" --expires 2026-12-31 \
//     --base https://kurzy.vibecoding.cz
//
// Vstup CSV: jeden e-mail na řádek (volitelně sloupec "email" s hlavičkou).
// Výstupy do scripts/discount-invites/out/:
//   - invites.sql  → aplikuj: wrangler d1 execute videokurzy-db --remote --file=...
//   - invites.csv  → email,token,url  (zdroj pro rozesílku přes Resend)

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { nanoid } from "nanoid";
import { buildInviteRows } from "../../src/lib/invite-generate.ts";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const csvPath = arg("csv");
if (!csvPath) {
  console.error("Chybí --csv <soubor>");
  process.exit(1);
}

const percent = parseInt(arg("percent", "50"), 10);
const batch = arg("batch", "default");
const label = arg("label", null);
const expiresRaw = arg("expires", null);
const baseUrl = arg("base", "https://kurzy.vibecoding.cz");

const expiresAt = expiresRaw ? new Date(`${expiresRaw}T23:59:59.000Z`) : null;

const raw = readFileSync(csvPath, "utf8");
const emails = raw
  .split(/\r?\n/)
  .map((line) => line.split(",")[0].trim())
  .filter((e) => e && e.includes("@") && e.toLowerCase() !== "email");

const { rows, sql } = buildInviteRows(emails, {
  percent,
  batch,
  label,
  expiresAt,
  baseUrl,
  now: new Date(),
  genToken: () => nanoid(),
});

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "out");
mkdirSync(outDir, { recursive: true });

writeFileSync(join(outDir, "invites.sql"), sql);
const csvOut =
  "email,token,url\n" +
  rows.map((r) => `${r.email},${r.token},${r.url}`).join("\n") +
  "\n";
writeFileSync(join(outDir, "invites.csv"), csvOut);

console.log(`Vygenerováno ${rows.length} tokenů.`);
console.log(`SQL:  scripts/discount-invites/out/invites.sql`);
console.log(`CSV:  scripts/discount-invites/out/invites.csv`);
console.log(`\nAplikuj na produkci:\n  npx wrangler d1 execute videokurzy-db --remote --file=scripts/discount-invites/out/invites.sql`);
```

- [ ] **Step 6: Smoke test generátoru na vzorovém CSV**

Run:
```bash
printf "email\ntest1@example.cz\ntest2@example.cz\n" > /tmp/inv.csv
node scripts/discount-invites/generate.mjs --csv /tmp/inv.csv --percent 50 --batch test --label "Test" --expires 2026-12-31
cat scripts/discount-invites/out/invites.csv
```
Expected: vypíše „Vygenerováno 2 tokenů." a `invites.csv` má 2 řádky s `?invite=`.

> Pozn.: pokud `node` neumí importovat `.ts` přímo, spusť přes `npx tsx scripts/discount-invites/generate.mjs ...` (tsx je k dispozici přes dev závislosti); v takovém případě doplň poznámku do hlavičky skriptu.

- [ ] **Step 7: Přidej `out/` do .gitignore (osobní data)**

Run: `echo "scripts/discount-invites/out/" >> .gitignore`

- [ ] **Step 8: Commit**

```bash
git add src/lib/invite-generate.ts tests/lib/invite-generate.test.ts scripts/discount-invites/generate.mjs .gitignore
git commit -m "feat(invites): generátor tokenů a odkazů z CSV"
```

---

## Task 8: E-mailová šablona a rozeslání přes Resend

**Files:**
- Create: `scripts/discount-invites/send.mjs`
- Create: `scripts/discount-invites/README.md`

- [ ] **Step 1: Prohlédni existující Resend skripty kvůli stylu**

Run: `ls scripts/resend && sed -n '1,40p' scripts/resend/*.mjs 2>/dev/null | head -60`
Expected: uvidíš, jak se volá Resend API / jaký formát klíče (`RESEND_API_KEY=re_...`). Drž se stejného vzoru (přímé volání `https://api.resend.com/emails` s Bearer tokenem).

- [ ] **Step 2: Napiš rozesílací skript**

Create `scripts/discount-invites/send.mjs`:

```javascript
#!/usr/bin/env node
// Rozešle osobní slevové odkazy přes Resend.
//
// Použití:
//   RESEND_API_KEY=re_xxx node scripts/discount-invites/send.mjs \
//     --csv scripts/discount-invites/out/invites.csv \
//     --from "Patrick Zandl <patrick@zandl.cz>" \
//     --subject "Sleva 50 % na videokurz Claude Code" \
//     [--dry-run] [--limit 5]
//
// CSV musí mít hlavičku: email,token,url

import { readFileSync } from "node:fs";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && (process.argv[i + 1] === undefined || process.argv[i + 1].startsWith("--"))) return true; // flag
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const csvPath = arg("csv", "scripts/discount-invites/out/invites.csv");
const from = arg("from");
const subject = arg("subject", "Sleva 50 % na videokurz Claude Code");
const dryRun = process.argv.includes("--dry-run");
const limitRaw = arg("limit", null);
const limit = limitRaw && limitRaw !== true ? parseInt(limitRaw, 10) : Infinity;

const apiKey = process.env.RESEND_API_KEY;
if (!dryRun && !apiKey) {
  console.error("Chybí RESEND_API_KEY (spusť: RESEND_API_KEY=re_... node ...).");
  process.exit(1);
}
if (!from) {
  console.error("Chybí --from \"Jméno <adresa>\"");
  process.exit(1);
}

const lines = readFileSync(csvPath, "utf8").split(/\r?\n/).filter(Boolean);
const header = lines.shift();
if (!header || !header.startsWith("email,token,url")) {
  console.error("CSV musí mít hlavičku: email,token,url");
  process.exit(1);
}

function htmlBody(url) {
  return `<!doctype html><html lang="cs"><body style="font-family:system-ui,sans-serif;line-height:1.6;color:#1f2937">
  <p>Ahoj,</p>
  <p>jako absolventovi placeného kurzu na vibecoding.cz pro tebe mám <strong>osobní slevu 50 %</strong>
  na videokurz Claude Code na <a href="https://kurzy.vibecoding.cz">kurzy.vibecoding.cz</a>.</p>
  <p>Sleva se aktivuje automaticky přes tvůj osobní odkaz — nic nemusíš opisovat:</p>
  <p><a href="${url}" style="display:inline-block;background:#4f46e5;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none">Získat kurz se slevou 50 %</a></p>
  <p style="font-size:13px;color:#6b7280">Odkaz je osobní a jednorázový. Nabídka platí jen do uvedeného data.</p>
  <p>Patrick Zandl</p>
  </body></html>`;
}

let sent = 0;
for (const line of lines) {
  if (sent >= limit) break;
  const [email, , url] = line.split(",");
  if (!email || !url) continue;

  if (dryRun) {
    console.log(`[dry-run] ${email} → ${url}`);
    sent++;
    continue;
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to: email, subject, html: htmlBody(url) }),
  });
  if (!res.ok) {
    console.error(`CHYBA ${email}: ${res.status} ${await res.text()}`);
  } else {
    console.log(`OK ${email}`);
    sent++;
  }
  // Šetrné tempo k rate limitu Resendu.
  await new Promise((r) => setTimeout(r, 600));
}

console.log(`\nHotovo. ${dryRun ? "Dry-run" : "Odesláno"}: ${sent}.`);
```

- [ ] **Step 3: Napiš README s postupem**

Create `scripts/discount-invites/README.md`:

```markdown
# Osobní slevové odkazy

Postup pro rozeslání 50% slevy lidem z jiného systému (vibecoding.cz).

## 1. Připrav CSV e-mailů

Jeden e-mail na řádek (volitelně hlavička `email`):

```
email
clovek1@example.cz
clovek2@example.cz
```

## 2. Vygeneruj tokeny a odkazy

```bash
node scripts/discount-invites/generate.mjs \
  --csv emaily.csv --percent 50 --batch vibecoding-2026-06 \
  --label "Osobní sleva pro absolventy" --expires 2026-12-31 \
  --base https://kurzy.vibecoding.cz
```

Vytvoří `out/invites.sql` a `out/invites.csv` (negitované).

## 3. Nahraj tokeny do produkční DB

```bash
npx wrangler d1 execute videokurzy-db --remote --file=scripts/discount-invites/out/invites.sql
```

## 4. Rozešli e-maily (z nasazeného prostředí / s ostrým klíčem)

Nejdřív dry-run a malý limit:

```bash
node scripts/discount-invites/send.mjs --csv scripts/discount-invites/out/invites.csv \
  --from "Patrick Zandl <patrick@zandl.cz>" --dry-run --limit 3
```

Pak ostře:

```bash
RESEND_API_KEY=re_xxx node scripts/discount-invites/send.mjs \
  --csv scripts/discount-invites/out/invites.csv \
  --from "Patrick Zandl <patrick@zandl.cz>" \
  --subject "Sleva 50 % na videokurz Claude Code"
```

## 5. Reporting — kolik tokenů využito

```bash
npx wrangler d1 execute videokurzy-db --remote \
  --command "SELECT batch, COUNT(*) total, SUM(usedAt IS NOT NULL) used FROM discount_invite GROUP BY batch"
```
```

- [ ] **Step 4: Dry-run smoke test**

Run:
```bash
node scripts/discount-invites/send.mjs --csv scripts/discount-invites/out/invites.csv --from "Test <t@t.cz>" --dry-run
```
Expected: vypíše `[dry-run] ...` řádky a `Hotovo. Dry-run: N.`

- [ ] **Step 5: Commit**

```bash
git add scripts/discount-invites/send.mjs scripts/discount-invites/README.md
git commit -m "feat(invites): rozesílací skript přes Resend + README postup"
```

---

## Task 9: Závěrečná verifikace

- [ ] **Step 1: Plná sada kontrol**

Run: `npm run typecheck && npm test`
Expected: vše zelené.

- [ ] **Step 2: Ověř pokrytí specu greppem**

Run:
```bash
grep -rl "discountInvite\|discount_invite\|inviteToken\|resolveInviteDiscount\|consumeInviteToken" src tests scripts
```
Expected: schema.ts, discount.ts, checkout.tsx (route + view), queue.ts, invite-generate.ts, testy, scripty.

- [ ] **Step 3: Manuální E2E checklist (lokálně `npm run dev`)**

  1. Vlož testovací invite do lokální D1:
     `npx wrangler d1 execute videokurzy-db --local --command "INSERT INTO discount_invite (token,email,percent,label,createdAt) VALUES ('demo','me@example.cz',50,'Osobní sleva',unixepoch())"`
  2. Otevři `http://localhost:8787/checkout/individual?invite=demo` → cena **1000 Kč**, hidden pole, popisek „Osobní sleva".
  3. Otevři `?invite=demo` na `/checkout/organization` → **7500 Kč**.
  4. Otevři bez parametru → plná cena, žádné hidden pole.
  5. (Volitelně Stripe test mode / FIO) ověř, že po aktivaci je `usedAt` vyplněné.

- [ ] **Step 4: Deploy a produkční migrace (JEN na výslovný pokyn uživatele)**

```bash
npm run deploy
npm run db:migrate:prod   # nasadí 0021_discount_invite.sql na produkční D1
```

> Bez `db:migrate:prod` bude tabulka `discount_invite` na produkci chybět a runtime spadne.

---

## Self-review (autor plánu)

- **Pokrytí specu:** tabulka (T1), resolve/consume (T2), přednost invite (T3), checkout GET/POST + Stripe metadata + FIO spotřeba (T4), view hidden pole (T5), Stripe spotřeba (T6), generátor (T7), rozeslání + README (T8), verifikace (T9). B2C i B2B pokryto v T4 (obě routes). Časová expirace v T2. Spotřeba až při zaplacení v T4/T6. Shoda e-mailu se nevynucuje (token je jediná autorita v `resolveInviteDiscount`).
- **Typová konzistence:** `AppliedDiscount.source: "auto"|"code"|"invite"`, `InviteDiscount {percent,token,label}`, `consumeInviteToken(db,token,purchaseId,now): boolean`, `resolveInviteDiscount(db,token,now): InviteDiscount|null`, `resolveCheckoutDiscount(db,settings,providedCode,inviteToken=null,now)` — používá se konzistentně napříč T2–T6. `buildInviteRows(emails, opts): {rows, sql}` konzistentní mezi T7 lib a CLI.
- **Bez placeholderů:** každý krok s kódem má kód; SQL i testy konkrétní.
- **Závislost T4↔T5:** poznámka v T4 Step 8 upozorňuje, že hidden pole renderuje T5 — při subagent exekuci dělej T4 a T5 jako dvojici (test v T4 plně projde až po T5).
