# Handoff — kde jsme a co dál

> Datum: 2026-04-19
> Cíl: Při startu nové Claude session načíst tento soubor + design spec.

---

## Co načíst na začátku session

1. **`docs/superpowers/specs/2026-04-18-unification-design.md`** — kanonický spec (rozhodnutí o platebních metodách, FIO účtu, emailu, admin uživatelech, freemail blacklistu atd.)
2. **Tento soubor** (HANDOFF.md) — stav projektu a priority
3. **`git log --oneline -30`** — hotová práce
4. `~/.claude/CLAUDE.md` — user preferences (jazyk: čeština s diakritikou)

---

## Stav projektu (commit `27a7dbe`, branch `main`)

### Hotovo

**Etapa 1 — Foundation** (merge `56f8065`)
- Tailwind v4 build step, Better Auth 1.6.5 upgrade
- Purchase schema extended (paymentMethod, variableSymbol, fioTransactionId, pending status)
- Drizzle relations
- Config: `src/config/payment.ts`, `freemail-domains.ts`, `admin.ts`
- Cron trigger 03:00 UTC + scheduled handler skeleton
- Auto-promote admin (patrick@vibecoding.cz + andrea@vibecoding.cz)

**Etapa 2 — FIO Integration** (merge `a288eb3`)
- `lib/fio.ts` (VS prefix 33, matchPayment, SPD, fetchFioTransactions)
- `lib/qr.ts` (uqr QR SVG)
- `lib/email.ts` (Resend client + 9 branded templates, sender Andrea Maloveczká)
- `lib/renewal-reminders.ts` (21/14/7/1 day cron logic)
- `views/checkout.tsx` (CheckoutSelect + PaymentDetails + Verify partials, Tailwind)
- `routes/checkout.tsx` (Stripe/FIO dispatcher + verify endpoint + KV rate limit)
- `routes/dev.tsx` (FIO mock gated by `FIO_API_TOKEN === "dev"`)
- Admin approval email po schválení organizace
- Freemail blacklist pro B2B domény
- Legacy `/api/checkout/*` redirects na `/checkout/*`
- Landing CTA migrace na linky + oprava ceny 3000 → 2000 Kč

**Produkční deploy — TEST mode**
- URL: `https://videokurzy.zandl.workers.dev`
- Stripe test webhook endpoint `we_1TNo7hLxrPFHwJcKFfMZwww3`
- 9/9 secrets nastaveno (BETTER_AUTH_*, RESEND_API_KEY, STRIPE_*, BUNNY_* × 3, FIO_API_TOKEN)
- Prod D1 migrace 0003 aplikována
- Cron `0 3 * * *` registered

**Produkční bugfixy nalezené smoke testem**
- `aefad05` — Stripe webhook `constructEvent` → `constructEventAsync` (sync crypto nefunguje v Cloudflare Workers; Stripe webhook jinak v produkci nikdy nefungoval)
- `02e9fc5` — Login form endpoint `magic-link/send` → `sign-in/magic-link` (Better Auth 1.6 path change)
- `4bb43ee` — Login flow proper implementation: `/login/send` UX proxy route (form-data → JSON pro Better Auth), progressive enhancement (native + htmx), detekce HX-Request
- `fc91dd5` — Magic link platnost 5 → 10 min

**Etapa 4 Step 1** (commit `27a7dbe`)
- Inline CSS extrahováno z `layout.tsx` (598 → 139 řádků) do `src/styles/input.css`
- Brand CSS i Tailwind utility v `public/styles.css` (33.5 KB)
- HTML response menší (žádné `<style>`), cachable `/styles.css`
- **Zastaveno na tomto kroku** — views používají semantické class names (`.btn`, `.card`), přepisování na čistě Tailwind utility by degrovalo čitelnost

---

## Co zbývá (priority sorted)

### Prio 1: Pre-launch blockery

1. **Stripe LIVE mode switch** (až uživatel otestuje TEST)
   - `wrangler secret put STRIPE_SECRET_KEY` s sk_live_ z Stripe Dashboard
   - `stripe webhook_endpoints create --live --url https://videokurzy.zandl.workers.dev/api/webhooks/stripe --enabled-events checkout.session.completed,customer.subscription.deleted,invoice.paid,invoice.payment_failed`
   - Nový whsec_* do `STRIPE_WEBHOOK_SECRET`
   - `stripe webhook_endpoints delete we_1TNo7hLxrPFHwJcKFfMZwww3` (test endpoint cleanup)
   - Redeploy

2. **Stránka `/terms`** — footer na ni linkuje, vrací 404. PRD vyžaduje pre-launch.
   - Vytvořit `src/views/terms.tsx` a napojit v `src/index.tsx` na `/terms` (podobně jako `/privacy`)
   - Text obchodních podmínek pro B2C + B2B licenci + FIO splatnost + refund policy (14 dní / < 50% epizod, viz PRD sekce 4)

3. **Error monitoring** — Cloudflare Logpush → R2
   - `wrangler logpush create` nebo přes Cloudflare Dashboard
   - Minimálně `workers-trace-events` → R2 bucket

### Prio 2: Etapa 3 — Admin CRUD

Správa kurzů/modulů/lekcí z admin GUI. Alternativa: zůstat u seed SQL + ruční DB edits.

Pokud se rozhodne postavit:
- Port `AdminCoursePage`, `AdminCourseForm`, `AdminModuleForm`, `AdminLessonForm` z `videokurz-demo/src/components/AdminPage.tsx`
- Nové routes: `/admin/courses`, `/admin/courses/new`, `/admin/courses/:id/edit`, `/admin/courses/:id`, moduly + lekce
- KV cache invalidace při změně (`env.KV.delete("cache:catalog")`)
- Tailwind utility od začátku (jako `checkout.tsx`)
- Plán: napsat do `docs/superpowers/plans/YYYY-MM-DD-unification-etapa3-admin-crud.md`

### Prio 3: Technický dluh z review Etapy 2

- **I3** Admin UI domain mismatch warning — když B2B buyer z `@gmail.com` žádá licenci pro `microsoft.com`, admin UI to vizuálně zvýrazní
- **I5** Renewal reminder idempotence — nahradit time-window ±12h za KV marker `reminder:{purchaseId}:{daysLeft}` s TTL 2 dny
- **M10** Unit testy pro `matchPayment`, `isFreemailDomain`, `generateVariableSymbol` (fintech kritické)

### Prio 4: Nice-to-have

- Renewal reminder real-world test (vytvořit FIO purchase s `expiresAt = now + 21d`, simulovat cron)
- Stripe Customer Portal link v dashboardu (PRD 11.1)
- SEO: OG tagy pro landing page (už tam jsou ale ověřit)

### Prio 5: Odložené z PRD

- Watermark s emailem uživatele přes Bunny
- Certifikáty o dokončení
- Kvízy a cvičení
- Diskuze pod videi
- Team admin dashboard pro firmy
- SCORM export

---

## Klíčové URL a zdroje

- **Produkce:** `https://videokurzy.zandl.workers.dev`
- **D1 database:** `videokurzy-db` (id `c4e3cf23-d6c8-4c63-94ca-d6c64809ca9f`)
- **KV namespace:** `afc09797ca644747b2c159f705334fb0`
- **Queue:** `videokurzy-webhooks`
- **Stripe test webhook:** `we_1TNo7hLxrPFHwJcKFfMZwww3` (smazat při LIVE switch)
- **FIO účet:** `2403461724/2010`, IBAN `CZ9720100000002403461724`, BIC `FIOBCZPP`
- **Admin users:** patrick@vibecoding.cz, andrea@vibecoding.cz (auto-promote přes middleware)
- **Email sender:** Andrea Maloveczká `<andrea@vibecoding.cz>`

---

## Git branch strategy

- Práce na `main` (žádné persistent feature branches; etapy byly mergnuty a branch smazány)
- Drobné fixy commitnuty rovnou na main (Stripe constructEventAsync, login endpoint, magic link 10 min)
- Uncommitted untracked adresáře `.agents/`, `.claude/`, `.factory/`, `.kiro/`, `skills/`, `skills-lock.json` — tooling state, mimo project scope

---

## Known issues

1. **`.dev.vars` na disku** — pro lokální dev obsahuje Stripe test key + whsec + FIO_API_TOKEN=dev. Gitignored, bezpečné.
2. **`.env.local.json` (pokud existuje)** — pro Better Auth CLI / local test, pokud potřeba.
3. **Wrangler verze** — globální je `4.56.0` (starší), project má `4.83.0`. `npm run` používá projektovou. Pro CLI operace `npx wrangler` nebo globální je vedlejší rozdíl.

---

## Commands quick reference

```bash
# Dev
npm run dev              # build CSS + wrangler dev + concurrent CSS watch

# Build & deploy
npm run typecheck        # tsc --noEmit
npm run build            # build CSS + wrangler deploy --dry-run
npm run deploy           # build CSS + wrangler deploy

# DB
npm run db:generate      # drizzle-kit generate (after schema change)
npm run db:migrate       # apply migrations locally
npm run db:migrate:prod  # apply migrations to remote D1
npm run db:seed          # seed local D1 (admin users etc.)

# Stripe CLI (test mode)
stripe listen --forward-to http://localhost:8787/api/webhooks/stripe
stripe trigger checkout.session.completed

# Prod tail
wrangler tail videokurzy --format=pretty

# Prod DB query
wrangler d1 execute videokurzy-db --remote --command="SELECT ..."
```
