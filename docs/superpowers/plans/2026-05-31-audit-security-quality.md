# Audit Security and Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Uzavrit P0 a nejdulezitejsi P1 nalezy z `docs/audit-2026-05.md` bez zmeny verejneho UX mimo nezbytne bezpecnostni kontroly.

**Architecture:** Zasahy jsou rozdelene po tokach: interni auth endpointy, FIO platby, Stripe/Fakturoid queue, Partner API a login/leads throttling. Kazdy tok dostane nejdrive regresni test pro konkretni nalez, potom minimalni opravu a nakonec cilene i celkove overeni.

**Tech Stack:** Hono, Cloudflare Workers, D1/Drizzle, KV, Vitest with `@cloudflare/vitest-pool-workers`, Better Auth, Stripe, Fakturoid.

---

## Vyhodnoceni auditu

Auditni priorita je spravna v tom, ze P0 kombinuje autorizaci identity a integritu plateb. Doplnuji tri upravy poradi a rozsahu:

1. `verify-add-email` nejde bezpecne opravit jen porovnanim magic-link session useru s `body.userId`, protoze magic link overuje pridavany e-mail a vytvari ad-hoc session k tomuto e-mailu. Bez vazby na puvodni prihlasenou session by takova kontrola rozbila legitimni self-add flow. Nutna oprava je pridat serverove overitelny add-email intent: token musi nest `targetUserId` a `email`, endpoint musi pouzit `targetUserId` z tokenu a `body.userId` brat pouze jako kompatibilitni kontrolu.
2. FIO `amountPaid` je uz ve schematu i cron ceste. Chybi jen ručni verify cesta a proforma/pay stranky porad pocitaji z aktualniho ceniku. Historickou cenu je pragmaticke ulozit do existujiciho `amountPaid` uz pri vytvoreni pending FIO objednavky jako ocekavanou castku, a pri matchi ji prepsat skutecnou castkou z banky. Pokud chceme semanticky cistejsi model, nasledny plan ma pridat `expectedAmountCzk`, ale P0/P1 lze uzavrit bez migrace.
3. CSRF pro cely admin je vetsi projekt. V prvni implementacni davce ma smysl omezit se na FIO verify Origin/HX kontrolu a cooldowny u financnich admin operaci; plosny admin CSRF nechat jako samostatny plan, protoze se dotkne 25+ formularu.

## Implementacni balicky

### Task 1: Interni add-email intent a log hygiene

**Files:**
- Modify: `src/routes/internal.tsx`
- Modify: `src/routes/profile.tsx`
- Create: `tests/routes/internal-verify-add-email.test.ts`

- [x] **Step 1: Napsat regresni test pro zamitnuti mismatche**

Create `tests/routes/internal-verify-add-email.test.ts` with focused route guard tests. Minimalni test bez realne magic-link verifikace vlozi expired/invalid token a overi existujici guards; pro novy intent helper pridat unit-level test, pokud bude helper exportovan z `internal.tsx` jako `verifyAddEmailIntentForTest`.

Run:

```bash
npm test -- tests/routes/internal-verify-add-email.test.ts
```

Expected before implementation: fail on missing helper / missing mismatch behavior.

- [x] **Step 2: Zavest podepsany add-email intent**

In `src/routes/internal.tsx` add helpers for a server-signed add-email intent. The intent must:

- carry `userId`, normalized `email`, and `expiresAt`;
- use URL-safe base64 for transport in callback URLs;
- verify the HMAC over the original encoded payload, not over a re-serialized object;
- compare signatures in constant time;
- return `null` on malformed JSON, invalid signature, missing fields, email mismatch, or expiry.

Suggested shape:

```ts
interface AddEmailIntentPayload {
  userId: string;
  email: string;
  expiresAt: number;
}

async function signAddEmailIntent(env: Env, payload: AddEmailIntentPayload): Promise<string> {
  const body = base64UrlEncode(JSON.stringify(payload));
  const sig = await hmacSha256Base64Url(env.AUTH_INTERNAL_SECRET, body);
  return `${body}.${sig}`;
}

async function verifyAddEmailIntent(env: Env, token: string): Promise<AddEmailIntentPayload | null> {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expectedSig = await hmacSha256Base64Url(env.AUTH_INTERNAL_SECRET, body);
  if (!constantTimeEqual(sig, expectedSig)) return null;
  const payload = JSON.parse(base64UrlDecode(body)) as AddEmailIntentPayload;
  if (!payload.userId || !payload.email || payload.expiresAt < Date.now()) return null;
  return payload;
}
```

- [x] **Step 3: Upravit self-add flow**

In `src/routes/profile.tsx`, where add-email magic link callback is generated, include signed intent instead of trusting raw `userId`. Callback should pass `{ token, intent }` to `/internal/auth/verify-add-email`.

In `src/routes/internal.tsx`, change body parsing to:

```ts
json<{ token?: string; userId?: string; intent?: string }>()
```

After magic-link verification, verify intent and require:

```ts
if (!intent || intent.email.toLowerCase() !== session.user.email.toLowerCase()) return 401;
if (body.userId && body.userId !== intent.userId) return 401;
const targetUserId = intent.userId;
```

Then call `addUserEmail` and `logIdentityEvent` with `targetUserId`.

- [x] **Step 4: Odstranit PII z internich logu**

In `src/routes/internal.tsx`, remove `email` from the `internal/magic-link` `console.warn` payload. Keep `correlationId`, `status`, and message.

- [x] **Step 5: Overit**

Run:

```bash
npm test -- tests/routes/internal-verify-add-email.test.ts tests/routes/internal-magic-link.test.ts tests/routes/profile-emails.test.ts
npm run typecheck
```

Expected: all selected tests and typecheck pass.

### Task 2: FIO verify atomicita, Origin/HX guard a TTL

**Files:**
- Modify: `src/routes/checkout.tsx`
- Create: `tests/routes/fio-verify.test.ts`

- [x] **Step 1: Napsat testy pro rate limit TTL a public guard**

Create tests covering:

```ts
it("rejects non-HTMX POST without same-origin Origin", async () => { ... expect(res.status).toBe(403); });
it("uses FIO_RATE_LIMIT_MS-aligned KV TTL", async () => { ... });
it("keeps already-active purchase idempotent", async () => { ... });
```

Use `SELF.fetch("https://test.local/api/fio/verify/33123456", { method: "POST", headers: { "HX-Request": "true", Origin: "https://test.local" } })`.

- [x] **Step 2: Pridat request guard**

In `src/routes/checkout.tsx` before DB work:

```ts
const origin = c.req.header("Origin");
const host = new URL(c.req.url).origin;
const isHtmx = c.req.header("HX-Request") === "true";
if (origin && origin !== host) {
  return c.html(<VerifyError message="Ověření platby není povoleno z této stránky." />, 403);
}
if (!isHtmx) {
  return c.html(<VerifyError message="Ověření platby spusťte z platební stránky." />, 403);
}
```

This keeps the endpoint usable from the payment page while blocking cross-site form posts and generic scripted probing.

- [x] **Step 3: Sjednotit KV TTL**

Replace:

```ts
await c.env.KV.put(rateLimitKey, String(Date.now()), { expirationTtl: 60 });
```

with:

```ts
await c.env.KV.put(rateLimitKey, String(Date.now()), {
  expirationTtl: Math.ceil(FIO_RATE_LIMIT_MS / 1000),
});
```

- [x] **Step 4: Zatomizovat update**

Replace the active update with:

```ts
const updated = await db
  .update(purchase)
  .set({
    status: "active",
    expiresAt: newExpiresAt,
    fioTransactionId: String(match.transaction.id),
    amountPaid: match.transaction.amount,
  })
  .where(and(eq(purchase.id, p.id), eq(purchase.status, "pending")))
  .returning({ id: purchase.id });

if (updated.length === 0) {
  return c.html(<VerifySuccess email={p.email} />);
}
```

Ensure `and` is already imported from `drizzle-orm`; it is.

- [x] **Step 5: Overit**

Run:

```bash
npm test -- tests/routes/fio-verify.test.ts tests/lib/fio.test.ts
npm run typecheck
```

Expected: tests and typecheck pass.

### Task 3: FIO historicka castka a proforma

**Files:**
- Modify: `src/routes/checkout.tsx`
- Modify: `src/scheduled.ts`
- Modify: `tests/routes/partner-api.test.ts` if expectations need aligning
- Create: `tests/routes/proforma.test.ts` or extend existing `tests/lib/proforma.test.ts` with route-level coverage if practical

- [ ] **Step 1: Test na proformu nezavislou na aktualnim ceniku**

Seed pending FIO purchase with `amountPaid = 1800`, set current `site_config.price_individual = 2500`, fetch `/checkout/proforma/:vs`, assert rendered HTML contains `1 800` and not `2 500`.

- [ ] **Step 2: Pri vytvoreni FIO pending ulozit ocekavanou castku**

In `startFioCheckout`, add to insert values:

```ts
amountPaid: price,
```

This preserves the order-time amount until real bank match overwrites it with transaction amount.

- [ ] **Step 3: Pouzit ulozenou castku na pay a proforma strance**

In `/checkout/pay/:vs`, replace recomputed `price` with:

```ts
const fallbackPrice = applyDiscount(fullPrice, p.discountPercent ?? 0);
const price = p.amountPaid > 0 ? p.amountPaid : fallbackPrice;
```

In `/checkout/proforma/:vs`, replace `amount` calculation with the same pattern.

- [ ] **Step 4: Sjednotit cron FIO fakturaci na skutecnou bankovni castku**

In `src/scheduled.ts`, when calling `exportPurchaseInvoice`, pass:

```ts
amount: result.transaction.amount,
```

This avoids invoicing a configured expected amount if the bank matched a precise but differently represented numeric amount.

- [ ] **Step 5: Overit**

Run:

```bash
npm test -- tests/routes/proforma.test.ts tests/routes/partner-api.test.ts tests/lib/fio.test.ts
npm run typecheck
```

Expected: tests and typecheck pass.

### Task 4: Stripe/Fakturoid idempotence

**Files:**
- Modify: `src/queue.ts`
- Create: `tests/queue.test.ts`

- [x] **Step 1: Napsat unit/integration test pro skip existujici faktury**

Mock or stub `exportPurchaseInvoice` so the test can assert it is not called when a purchase with matching `stripePaymentId` already has `fakturoidInvoiceId`.

- [x] **Step 2: Pred exportem nacist aktualni purchase**

In `issueFakturoidInvoice`, before `exportPurchaseInvoice`, add:

```ts
const [existing] = await db
  .select({ fakturoidInvoiceId: purchase.fakturoidInvoiceId })
  .from(purchase)
  .where(eq(purchase.stripePaymentId, opts.sessionId))
  .limit(1);

if (!existing || existing.fakturoidInvoiceId) return;
```

- [x] **Step 3: Zuzit queue event typ a logovat nezname typy**

Change `WebhookMessage.type` from `string` to:

```ts
type WebhookMessageType =
  | "checkout.session.completed"
  | "customer.subscription.deleted"
  | "invoice.paid";
```

Add `default` in switch:

```ts
default:
  console.warn(`[queue] Unknown webhook message type: ${type}`);
  break;
```

- [x] **Step 4: Overit**

Run:

```bash
npm test -- tests/queue.test.ts
npm run typecheck
```

Expected: queue tests and typecheck pass.

### Task 5: Partner API rate limiting a enumeration fix

**Files:**
- Modify: `src/routes/partner-api.tsx`
- Modify: `tests/routes/partner-api.test.ts`

- [ ] **Step 1: Upravit test non-numeric id**

Change expectation from `400 invalid_id` to `404 not_found` with same body as missing id.

- [ ] **Step 2: Pridat per-key rate-limit test**

Use 21 requests with `X-Partner-Key: test-partner-key` against `/api/partner/purchases`; assert the final request returns 429 and a JSON body `{ error: "rate_limited" }`.

- [ ] **Step 3: Implementovat KV rate limit**

In `src/routes/partner-api.tsx`, add middleware after `requirePartnerKey`:

```ts
const PARTNER_RATE_LIMIT_WINDOW_SECONDS = 60;
const PARTNER_RATE_LIMIT_MAX = 20;

partner.use("/api/partner/*", async (c, next) => {
  const key = c.req.header("X-Partner-Key") ?? "unknown";
  const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  const keyHash = Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
  const bucket = Math.floor(Date.now() / (PARTNER_RATE_LIMIT_WINDOW_SECONDS * 1000));
  const kvKey = `partner_rate:${keyHash}:${bucket}`;
  const current = Number(await c.env.KV.get(kvKey) ?? "0");
  if (current >= PARTNER_RATE_LIMIT_MAX) return c.json({ error: "rate_limited" }, 429);
  await c.env.KV.put(kvKey, String(current + 1), { expirationTtl: PARTNER_RATE_LIMIT_WINDOW_SECONDS * 2 });
  await next();
});
```

- [ ] **Step 4: Sjednotit detail chyby**

Change non-numeric id branch to:

```ts
if (!Number.isFinite(id)) {
  return c.json({ error: "not_found" }, 404);
}
```

- [ ] **Step 5: Overit**

Run:

```bash
npm test -- tests/routes/partner-api.test.ts
npm run typecheck
```

Expected: tests and typecheck pass.

### Task 6: Login/leads throttling

**Files:**
- Modify: `src/routes/auth.tsx`
- Modify: `src/routes/leads.tsx`
- Create: `tests/routes/login-send.test.ts`
- Create: `tests/routes/leads-rate-limit.test.ts`

- [ ] **Step 1: Test login per-email limit**

Post 4 times to `/login/send` with same email and assert the final response is 429. Use invalid Better Auth downstream mocking only if necessary; otherwise test the rate-limit branch before proxy call.

- [ ] **Step 2: Implementovat per-email throttle**

In `src/routes/auth.tsx`, before `createAuth` call:

```ts
const loginKey = `login_send:${email}`;
const sentCount = Number(await c.env.KV.get(loginKey) ?? "0");
if (sentCount >= 3) {
  const msg = "Odkaz už byl odeslán. Zkuste to za chvíli znovu.";
  return isHtmx ? c.html(<div>{msg}</div>, 429) : c.html(<LoginPage prefillEmail={email} error={msg} />, 429);
}
await c.env.KV.put(loginKey, String(sentCount + 1), { expirationTtl: 120 });
```

- [ ] **Step 3: Test leads per-IP limit**

Post 6 times to each leads endpoint with same `CF-Connecting-IP` and assert 429 after configured threshold.

- [ ] **Step 4: Implementovat leads throttle helper**

In `src/routes/leads.tsx`, add local helper:

```ts
async function checkIpRateLimit(env: Env, ip: string, scope: string): Promise<boolean> {
  const key = `leads_rate:${scope}:${ip}`;
  const count = Number(await env.KV.get(key) ?? "0");
  if (count >= 5) return false;
  await env.KV.put(key, String(count + 1), { expirationTtl: 60 });
  return true;
}
```

Call it before sending Resend events.

- [ ] **Step 5: Overit**

Run:

```bash
npm test -- tests/routes/login-send.test.ts tests/routes/leads-rate-limit.test.ts
npm run typecheck
```

Expected: tests and typecheck pass.

### Task 7: Stredni a nizka hardening davka

**Files:**
- Modify: `src/middleware/auth.ts`
- Modify: `src/lib/email.ts`
- Modify: `src/routes/admin.tsx`
- Modify: `src/views/admin-courses.tsx`
- Modify: `src/db/schema.ts`
- Add migration: `drizzle/migrations/0019_purchase_fio_transaction_unique.sql`
- Modify tests as needed

- [ ] **Step 1: Normalizovat admin email**

Use existing `normalizeEmail()` if available; otherwise `email.toLowerCase().trim()` before `ADMIN_EMAIL_SET.has(...)`.

- [ ] **Step 2: Zkratit Resend error log**

In `src/lib/email.ts`, log only `res.status` and a correlation message, not full response body.

- [ ] **Step 3: Nahradit hardcoded ceny v adminu**

Import `PRICE_INDIVIDUAL` and `PRICE_ORGANIZATION`; replace `"2000"` and `"15000"` fallbacks with `String(...)`.

- [ ] **Step 4: Odebrat zbytecne exporty**

Remove exported `loadDiscountSettings` if unused and remove `loadSettings` from export list.

- [ ] **Step 5: Escapovat admin inline fields**

Add a small JS escaping helper inside the inline script or refactor to DOM creation. Minimum acceptable fix:

```js
const escapeAttr = (value) => String(value ?? "")
  .replace(/&/g, "&amp;")
  .replace(/"/g, "&quot;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/'/g, "&#39;");
```

Use it for chapter numeric fields and benefits form values.

- [ ] **Step 6: Pridat unique index na `fioTransactionId`**

Create migration:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS `purchase_fioTransactionId_unique`
ON `purchase` (`fioTransactionId`)
WHERE `fioTransactionId` IS NOT NULL;
```

Update Drizzle schema with a unique index if the local Drizzle version supports partial indexes for SQLite; otherwise document index-only migration.

- [ ] **Step 7: Overit**

Run:

```bash
npm test
npm run typecheck
npm run build
```

Expected: full test suite, typecheck, and dry-run build pass.

## Explicitne odlozeno do navazujicich planu

- Plosny CSRF pro admin POST endpointy a vsechny formulare. Duvod: velky zasah do 25+ handleru a UI formularu; je lepsi ho delat samostatne s helperem a testy pro jeden vzorovy form.
- Rotace/verzovani `X-Partner-Key` a alerting. Duvod: vyzaduje provozni rozhodnuti o ulozeni vice klicu, metrikach a dashboardu.
- Sdilena utilita `loadSiteConfigSettings()`, centralni `formatCzk`, zod/type guardy pro externi API a refaktor inline JS do modulu. Duvod: kvalita kodu s nizsim okamzitym bezpecnostnim dopadem.

## Finalni overeni cele davky

Run:

```bash
npm test
npm run typecheck
npm run build
git diff --stat
git diff --check
```

Expected:
- Testy projdou.
- TypeScript bez chyb.
- Wrangler dry-run build projde.
- `git diff --check` bez whitespace chyb.
