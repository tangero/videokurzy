# Sjednocení videokurzy + videokurz-demo — Design Spec

> Datum: 2026-04-18
> Autor: Patrick Zandl
> Status: Schváleno, připraveno k implementaci
> Verze: 1.1 (finalizováno po druhé kole upřesnění)

---

## Kontext

Existují dva projekty:
- **`videokurzy`** — cílový stav, má: Stripe, Cloudflare Queue, lead capture, strukturovaný kód (routes/views/lib), ale chybí Tailwind, Admin CRUD pro obsah, FIO platby
- **`videokurz-demo`** — demo stav, má: Tailwind CSS v4, FIO Bank platby, Admin CRUD, Better Auth 1.6, Drizzle relations, dokumentaci, ale chybí Stripe a Queue

Cíl: sjednotit oba projekty **do `videokurzy`** tak, aby vznikl produkčně připravený celek.

---

## Rozhodnutí

### 1. Cílový projekt
Pracujeme v **`videokurzy`**. Funkce z `videokurz-demo` přinášíme sem.

### 2. Platební metody — výběr na checkout stránce
**Varianta A:** Zákazník si na checkout stránce sám volí mezi:
- **Platba kartou** → Stripe Checkout (stávající implementace, subscription)
- **QR platba bankovním převodem** → FIO Bank (nová integrace, jednorázová platba)

Platí pro **B2C i B2B** (obě typy nákupů podporují obě metody).

### 3. FIO Bank — splatnost
- **Výchozí splatnost:** 7 dní od vytvoření objednávky
- **Prodloužená splatnost:** 21 dní — aktivuje se checkboxem „Prodloužená splatnost (pro firemní zpracování)" na checkout stránce
- Na stránce s platebními údaji musí být **jasné upozornění**: „Platbu proveďte do [datum]. Po uplynutí lhůty bude objednávka zrušena."
- Purchase se vytvoří se statusem `pending`; po úspěšném spárování platby se přepne na `active`

### 4. Status flow `purchase` — asymetrický
- **Stripe:** webhook → purchase rovnou `active` (Stripe platbu garantuje před redirectem)
- **FIO:** `pending` → `active` po spárování v FIO API (nebo manuálně adminem)
- Rozdílný flow je akceptovaný — reflektuje rozdíl mezi synchronní kartou a asynchronním převodem

### 5. FIO po roce — renewal flow
FIO je jednorázový převod, ne subscription. Po 1 roce:
- **3 týdny před expirací:** email „Předplatné se blíží ke konci, obnovte"
- **2 týdny před expirací:** druhý reminder
- **1 týden před expirací:** třetí reminder s posledním upozorněním
- **Poslední den před expirací:** finální upozornění
- Pokud uživatel nezaplatí novou objednávku do posledního dne → status `expired`, ztrácí přístup
- Uživatel musí aktivně vytvořit novou objednávku přes checkout (emaily obsahují CTA odkaz)

### 6. Expirace `pending` FIO objednávek
- **Cloudflare Cron Trigger** jednou denně (`0 3 * * *`, 03:00 UTC)
- Přepne všechny `pending` objednávky s `expiresAt < now()` na status `expired`
- Registrace v `wrangler.toml` pod `[triggers]` a scheduled handler v `src/index.tsx`

### 7. B2B FIO + schvalování domén
- Checkout vytvoří `organization` (status `pending`) + `purchase` (status `pending`)
- Po spárování FIO platby: `purchase` → `active`, `organization` zůstává `pending`
- Admin ručně schvaluje doménu v `/admin` → `organization` → `active`
- Po schválení: email uživateli „Firemní licence aktivována pro doménu X, kdokoliv s emailem na této doméně se může přihlásit"
- **Blacklist freemailových domén** — odmítnout při checkoutu:
  - České: `seznam.cz`, `post.cz`, `email.cz`, `centrum.cz`, `atlas.cz`, `volny.cz`, `tiscali.cz`
  - Mezinárodní: `gmail.com`, `yahoo.com`, `outlook.com`, `hotmail.com`, `icloud.com`, `me.com`, `mac.com`, `protonmail.com`, `proton.me`, `tutanota.com`, `gmx.com`, `aol.com`, `live.com`, `msn.com`
  - UX: "Pro firemní licenci potřebujeme vlastní firemní doménu. Freemailové domény (gmail.com, seznam.cz…) nelze použít, protože licence by se vztahovala na všechny uživatele dané služby."
  - Seznam spravovaný v `src/config/freemail-domains.ts` pro snadnou údržbu

### 8. UI checkout flow — mezistránka
Landing CTA → mezistránka `/checkout/individual` resp. `/checkout/organization`:
- Formulář: email (+ doména pro B2B) + radio `[karta | převod]` + checkbox `[Prodloužená splatnost (21 dní)]`
- Submit → dle volby buď Stripe redirect, nebo FIO pending page `/checkout/pay/:vs`
- Stávající přímé POST z landingu na `/api/checkout/*` se zruší

### 9. Tailwind CSS — kompletní migrace
- Přidáme Tailwind CSS v4 build step (stejná konfigurace jako v `videokurz-demo`)
- **Všechny existující komponenty** se přepíší na Tailwind:
  - `layout.tsx`, `landing.tsx`, `login.tsx`, `dashboard.tsx`, `watch.tsx`, `privacy.tsx`
  - Stripe success page (aktuálně používá Tailwind CDN — nahradit za build-time CSS)
- Nové komponenty rovnou v Tailwindu
- Produkční CSS build: `@tailwindcss/cli -i src/styles/input.css -o public/styles.css --minify`

### 10. Better Auth
Upgrade na **nejnovější verzi** (ověřit aktuální stable v context7).
- Zachovat magic link plugin
- Per-request instance (D1 binding je request-scoped) — zachovat stávající pattern
- Znovu ověřit kompatibilitu se stávající auth-schema.ts

### 11. Admin CRUD pro obsah
Přenést z `videokurz-demo` správu:
- Kurzy (create/edit/delete, toggle published)
- Moduly (create/edit/delete, sortOrder)
- Lekce (create/edit/delete, bunnyVideoId, isFree, durationSeconds)
- KV cache invalidace při každé změně
- Přenést views: `AdminCourseForm`, `AdminCourseDetail`, `AdminModuleForm`, `AdminLessonForm`

### 12. Drizzle relations
Přidat `relations()` definice do schématu:
- `course` → `modules`
- `module` → `course`, `lessons`
- `lesson` → `module`
- `user` → `progress`, `purchases`
- `progress` → `user`, `lesson`
- `purchase` → `user`

### 13. Admin uživatelé a notifikace
- **`role = "admin"` v DB** pro dva uživatele:
  - `patrick@vibecoding.cz`
  - `andrea@vibecoding.cz`
- **Admin email notifikace** (nové B2B objednávky, schválené platby atd.):
  - Odesílat na: `patrick@vibecoding.cz` **a** `andrea@vibecoding.cz`
- **Odesílatel transakčních emailů:**
  - `Andrea Maloveczká <andrea@vibecoding.cz>`

---

## Rozšíření databázového schématu

### Tabulka `purchase` — rozšíření o FIO-specifické sloupce

| Sloupec | Změna | Popis |
|---|---|---|
| `paymentMethod` | **nový** — `"stripe" \| "fio"` NOT NULL default `"stripe"` | typ platby |
| `variableSymbol` | **nový** — text, UNIQUE, nullable | 8místný VS pro FIO (prefix `33`) |
| `fioTransactionId` | **nový** — text, nullable | ID transakce z FIO API (po spárování) |
| `status` | **rozšíření enumu** | nově: `pending \| active \| expired \| refunded` (původně bez `pending`) |
| `stripePaymentId` | **změna nullable** | dosud NOT NULL, nově nullable (FIO purchase nemá Stripe ID) |

### Tabulka `user` — přidat role enum
Better Auth `user` tabulka už má `role` sloupec (text default "user"). Po migraci nastavíme explicit `"admin"` pro Patricka a Andreu v seed nebo migrace.

---

## Přístup k implementaci: Po etapách (Přístup B)

### Etapa 0: Prerequisites
- Ověřit aktuální stable verzi Better Auth (context7)
- Konfigurace `src/config/payment.ts` — finální konstanty:
  - `PAYMENT_IBAN = "CZ9720100000002403461724"`
  - `PAYMENT_ACCOUNT = "2403461724/2010"`
  - `PAYMENT_BIC = "FIOBCZPP"`
  - `PAYMENT_RECIPIENT = "Patrick Zandl"` (FIO účet je jeho)
  - `PRICE_INDIVIDUAL = 2000`
  - `PRICE_ORGANIZATION = 15000`
  - `ACCESS_DURATION_DAYS = 365`
  - `FIO_VS_PREFIX = "33"`
  - `FIO_DEFAULT_DUE_DAYS = 7`
  - `FIO_EXTENDED_DUE_DAYS = 21`
  - `FIO_RATE_LIMIT_MS = 35000`
  - `FIO_LOOKBACK_DAYS = 28` (pokrývá prodlouženou splatnost + margin)
  - `ADMIN_EMAILS = ["patrick@vibecoding.cz", "andrea@vibecoding.cz"]`
  - `EMAIL_FROM = "Andrea Maloveczká <andrea@vibecoding.cz>"`

### Etapa 1: Schema + Better Auth + config
1. Upgrade Better Auth na nejnovější stable
2. Rozšíření `purchase` tabulky — Drizzle schema + migrace SQL
3. Drizzle `relations()` pro všechny tabulky
4. `src/config/payment.ts`
5. `src/config/freemail-domains.ts`
6. Seed update: `patrick@vibecoding.cz` a `andrea@vibecoding.cz` jako admin
7. `wrangler.toml` — cron trigger `"0 3 * * *"`

### Etapa 2: FIO integrace
1. `src/lib/fio.ts` — přenesení z demo (matchPayment, generateVariableSymbol s prefixem, fetchFioTransactions, generateSPD)
2. `src/lib/qr.ts` — uqr knihovna
3. `src/lib/email.ts` — rozšíření o FIO-specifické šablony (purchase confirmation, B2B approved, renewal reminders ×4)
4. Nový checkout flow:
   - `GET /checkout/individual` — mezistránka s volbou metody
   - `GET /checkout/organization` — mezistránka s volbou metody + doména (blokace freemail domén)
   - `POST /checkout/individual` — podle radio buttonu buď Stripe redirect nebo FIO pending
   - `POST /checkout/organization` — stejně
   - `GET /checkout/pay/:vs` — FIO platební stránka s QR kódem, upozorněním na splatnost, tlačítkem „Ověřit platbu"
   - `POST /api/fio/verify/:vs` — ověření platby přes FIO API + KV rate limiting (35s)
   - Dev mock: `GET /dev/fio/pay/:vs`
5. Admin ruční schvalování organizací (již existuje) + email po schválení → rozšířit o email trigger
6. Scheduled handler v `src/index.tsx` — cron job pro expiraci pending objednávek
7. Renewal reminder cron (stejný trigger, jiná logika): 21d / 14d / 7d / 1d emaily

### Etapa 3: Admin CRUD pro obsah
1. Přenést z `videokurz-demo`:
   - Routes: admin courses/modules/lessons CRUD endpointy
   - Views: `AdminCourses`, `AdminCourseForm`, `AdminCourseDetail`, `AdminModuleForm`, `AdminLessonForm`
2. KV cache invalidace (`env.KV.delete("cache:catalog")`)
3. Ochrana: `requireAdmin` middleware

### Etapa 4: Tailwind CSS — kompletní migrace
1. Přidat Tailwind CSS v4 build step:
   - `package.json` scripts: `build:css`, `dev:css`
   - `src/styles/input.css` se standard `@tailwind` direktivami
   - `public/styles.css` jako build output
2. Static asset serving z `public/` v Hono app
3. Migrovat existující komponenty:
   - `layout.tsx` (sdílený layout)
   - `landing.tsx`
   - `login.tsx`
   - `dashboard.tsx`
   - `watch.tsx`
   - `privacy.tsx`
   - Stripe success page v `routes/stripe.tsx`
4. Nové komponenty rovnou v Tailwindu

---

## Otevřené otázky (vyřešeno)

| # | Otázka | Odpověď |
|---|---|---|
| 1 | FIO ověření platby — polling vs background | On-demand polling (uživatel klikne „Ověřit platbu"), cron pouze pro expiraci pending a renewal reminders |
| 2 | Co s pending FIO objednávkami po splatnosti | Cloudflare Cron Trigger (daily 03:00 UTC) → `expired` |
| 3 | IBAN a FIO API token | FIO účet `2403461724/2010`, IBAN `CZ9720100000002403461724`, BIC `FIOBCZPP`. Token v `.dev.vars` (dev = mock) a Workers secret (prod) |
| 4 | Admin rozlišuje FIO pending objednávky? | Admin primárně schvaluje organizace. FIO pending se řeší automaticky přes cron + on-demand verify |

---

## Technický stack po sjednocení

| Vrstva | Technologie |
|---|---|
| Runtime | Cloudflare Workers |
| Framework | Hono (TypeScript) |
| UI | Hono JSX + htmx 2.x |
| Styling | **Tailwind CSS v4** (kompletní migrace) |
| ORM | Drizzle ORM + relations |
| Databáze | Cloudflare D1 (SQLite) |
| Cache | Cloudflare KV |
| Async | Cloudflare Queue (Stripe webhooks) + Cron Triggers (FIO expirace, renewal reminders) |
| Auth | **Better Auth nejnovější** |
| Platby | **Stripe** (karta, subscription) + **FIO Bank** (převod, jednorázová platba) |
| Video | Bunny Stream (signed embed URLs) |
| Email | Resend (odesílatel `Andrea Maloveczká <andrea@vibecoding.cz>`) |
| QR kódy | uqr (pure JS, edge-compatible) |

---

## Nové env proměnné (přidané do `.dev.vars` a Workers secrets)

```
# Existující (videokurzy)
BETTER_AUTH_SECRET
BETTER_AUTH_URL
RESEND_API_KEY
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
BUNNY_API_KEY
BUNNY_LIBRARY_ID
BUNNY_TOKEN_KEY

# Nové
FIO_API_TOKEN       # Produkční token pro FIO API, dev = "dev" (mock)
```

---

## Reference

- [PRD v2](../../../videokurz-demo/docs/PRD-v2.md) — kanonický zdroj požadavků (v `videokurz-demo`)
- [videokurz-demo](../../../videokurz-demo/) — zdrojový projekt pro FIO, Tailwind, Admin CRUD
- [videokurzy](../../) — cílový projekt
- [vibecoding-site `src/config/payment.ts`](../../../vibecoding-site/src/config/payment.ts) — zdroj FIO účtu a company údajů

---

## Changelog

| Verze | Datum | Změny |
|-------|-------|-------|
| 1.0 | 2026-04-18 | Inicializace designu — sjednocení projektů |
| 1.1 | 2026-04-18 | Finalizace po druhém kole upřesnění: status flow asymetrie, renewal flow 3-2-1 týden, cron expirace, freemail blacklist, kompletní Tailwind migrace, FIO účet 2403461724/2010, VS prefix 33, admin andrea+patrick, odesílatel Andrea Maloveczká |
