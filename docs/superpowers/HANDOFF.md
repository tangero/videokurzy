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

## Stav projektu (commit `c67d101`, branch `main`)

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

**Etapa 3 — Admin CRUD** (commity `5f14ec0`, `f6427ae`)
- `src/views/admin-courses.tsx` — view komponenty: `AdminCoursesList`, `AdminCourseForm`, `AdminCourseDetail`, `AdminModuleForm`, `AdminLessonForm`
- `src/routes/admin.tsx` — plný CRUD pro kurzy/moduly/lekce (20 route handlerů)
- KV cache invalidace `cache:catalog` po každé mutaci
- Smazat kurz/modul/lekci smaže cascade přes DB FK
- Lekce generují `publicId` přes `nanoid(8)` při vytvoření

---

## Co zbývá (priority sorted)

### Prio 1: Pre-launch blockery

1. **Stripe LIVE mode switch** (až uživatel otestuje TEST)
   - `wrangler secret put STRIPE_SECRET_KEY` s sk_live_ z Stripe Dashboard
   - `stripe webhook_endpoints create --live --url https://videokurzy.zandl.workers.dev/api/webhooks/stripe --enabled-events checkout.session.completed,customer.subscription.deleted,invoice.paid,invoice.payment_failed`
   - Nový whsec_* do `STRIPE_WEBHOOK_SECRET`
   - `stripe webhook_endpoints delete we_1TNo7hLxrPFHwJcKFfMZwww3` (test endpoint cleanup)
   - Redeploy

2. ✅ **Stránka `/terms`** (commit `c67d101`) — B2C + B2B licence, FIO splatnost 7/21 dní, refund policy

3. ✅ **Error monitoring** — rozhodnuto: Workers Observability (Dashboard → Workers & Pages → videokurzy → Observability), Logpush odložen. R2 bucket `videokurzy-logs` vytvořen pro případné budoucí použití.

### ~~Prio 2: Etapa 3 — Admin CRUD~~ ✅ HOTOVO

### ~~Prio 2: Technický dluh z review Etapy 2~~ ✅ HOTOVO

- **I3** ✅ Admin UI domain mismatch warning (commit `4625479`) — sloupec Kupující v org tabulce, ⚠ badge při neshodě domény
- **I5** ✅ Renewal reminder idempotence (commit `73c30b1`) — KV marker `reminder:{purchaseId}:{daysLeft}`, TTL 2 dny
- **M10** ✅ Unit testy (commit `7b8f295`) — 35 testů pro `matchPayment`, `isFreemailDomain`, `generateVariableSymbol`

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
