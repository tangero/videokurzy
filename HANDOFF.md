# HANDOFF — videokurzy / kurzy.vibecoding.cz

Stav k 2026-05-20. Tento dokument zachycuje, co se v poslední iteraci
udělalo, co je nasazené na produkci, co je rozdělané a co stojí za to
udělat příště. Aktualizovat při každém větším bloku práce.

## TL;DR

V uplynulé iteraci jsme dodali kompletní **B2B fakturační pipeline**
(IČO → ARES → zálohový doklad → Fakturoid faktura) pro FIO i Stripe,
opravili kritický **DOCTYPE middleware bug** a prošli **a11y/anti-pattern
audit checkoutu** (skóre 11 → 18/20). Vše nasazené, otestované, zelené.

Vedle toho proběhl **audit landing page** s konkrétními návrhy, jak lépe
komunikovat „roční předplatné + průběžně přibývající obsah". Návrhy zatím
neimplementovány.

## Co je živé na produkci

| Feature | Endpoint / Soubor | Stav |
|---|---|---|
| ARES lookup | `GET /api/ares-lookup?ico=...&name=...` | ✓ ověřeno |
| Firemní fakturační údaje v checkoutu | `/checkout/individual`, `/checkout/organization` | ✓ |
| Zálohový doklad (ZD) jako platební stránka | `GET /checkout/pay/:vs` | ✓ |
| ZD pro tisk / PDF | `GET /checkout/proforma/:vs` | ✓ |
| ZD generování pro každou FIO objednávku | `nextProformaNumber` v `site_config.proforma_seq_{year}` | ✓ |
| Stripe metadata průchozí pro company údaje | `b_ico`, `b_name`, ... v `session.metadata` | ✓ |
| Fakturoid `findSubjectByIco` (dedup) | `src/lib/fakturoid.ts` | ✓ |
| Email s linkem na ZD | `fioPendingHtml` | ✓ |
| Externí `public/js/checkout.js` (CSP-friendly) | static asset | ✓ |

Smoke test po posledním deployi: všechny endpointy 200, žádné `Worker
threw exception`. Konkrétní VS pro ruční test: `33667507` (ZD-2026-001).

## Co jsme změnili — git history

```
a1a29dd checkout: aria-hidden na line-through ceně + gray-500
30c22e9 checkout: a11y + design fixes z auditu (kontrast, gradient, card-in-card)
160a21c checkout: ZD jako platební stránka + fix DOCTYPE middleware
5a66098 checkout: ARES lookup + zálohový doklad + firemní fakturace
```

Migrace `0016_purchase_company_fields.sql` aplikována lokálně i na prod
D1. Přidává: `companyName/Ico/Dic/Address/City/Zip`, `contactName`,
`proformaNumber` (UNIQUE), `proformaIssuedAt`.

## Architektura nově přidaných součástí

### Datový tok (FIO objednávka s firmou)

```
User vyplní form (POST /checkout/{individual,organization})
  ↓ parseBilling(formData) → BillingData | null
  ↓ ARES auto-fill (volitelný, na klientu přes /api/ares-lookup)

startFioCheckout()
  ↓ nextProformaNumber(db) → "ZD-2026-NNN" (alokace ze site_config)
  ↓ INSERT purchase (status=pending, billing*, proformaNumber)
  ↓ sendEmail(fioPendingHtml) s linkem na /checkout/pay/{VS}

User otevře /checkout/pay/{VS}
  ↓ Render PaymentDetails (ZD-style HTML: dodavatel/odběratel/položka/QR)
  ↓ User naskenuje QR a zaplatí

Cron (denně 03:00 UTC) v scheduled.ts::scanFioPayments
  ↓ fetchFioTransactions(FIO_API_TOKEN, 28 days)
  ↓ matchPayment(VS, expectedAmount)
  ↓ UPDATE purchase status=active
  ↓ exportPurchaseInvoice(env, {..., companyName, companyIco, ...})
  ↓ Fakturoid: ensureSubject (findByIco nebo create) → createInvoice → recordPayment
  ↓ Email s magic linkem + Fakturoid pošle fakturu PDF
```

### Datový tok (Stripe objednávka s firmou)

```
User vyplní form → parseBilling → billingToStripeMetadata
  → Stripe Checkout Session s metadata.b_ico/b_name/...

Stripe webhook checkout.session.completed → queue.ts::handleCheckoutCompleted
  ↓ extractBilling(metadata)
  ↓ INSERT purchase (..., billing*)
  ↓ issueFakturoidInvoice → exportPurchaseInvoice
```

### Klíčové soubory

| Soubor | Účel |
|---|---|
| `src/lib/ares.ts` | ARES API klient (`lookupByIco`, `lookupByName`) |
| `src/lib/proforma.ts` | HTML generátor zálohového dokladu pro tisk |
| `src/lib/proforma-sequence.ts` | Atomický counter v site_config |
| `src/lib/fakturoid.ts` | Fakturoid v3 + dedup by IČO + ARES enrichment fallback |
| `src/views/checkout.tsx` | CheckoutSelect + PaymentDetails (ZD-style) |
| `src/routes/checkout.tsx` | Endpoint routes + parseBilling + Stripe metadata |
| `public/js/checkout.js` | ARES lookup debounce + clipboard (CSP-friendly) |
| `drizzle/migrations/0016_purchase_company_fields.sql` | DB schema |

## Audit landing page — TODO neimplementováno

**Hlavní zjištění**: „roční předplatné + průběžně přibývající obsah" není
přesvědčivě komunikováno. Skóre auditu 16/20.

Navržené změny (priorita pro biggest impact):

1. **Hero copy** — eyebrow `// videokurz · sezóna 01` → `// roční
   předplatné · sezóna 01`. Hero meta doplnit „+ nové kurzy průběžně".
2. **Nová sekce Roadmapa** mezi `#obsah` a `#cenik` — vizuální timeline
   plánovaných kurzů (✓ teď / ● v přípravě / ○ plánováno). Data z nového
   klíče `site_config.roadmap_items` (JSON), aby admin mohl editovat.
3. **Cenová karta** — explicit annual CTA „koupit za 2 000 Kč na rok",
   benefit list jmenovitě uvádět budoucí kurzy s odhadem termínu,
   pojistka „po roce staré kurzy zůstávají dostupné" (verifikovat, že
   skutečně platí, jinak vynechat).

A11y / hygiene findings (P1 z auditu landingu):
- Newsletter input bez `<label>` → přidat sr-only label.
- Discount badge `🔥` → SVG ikona + `aria-label`.
- Hero terminal `aria-hidden` → nahradit `aria-label` s popisem.
- 40+ inline `style="..."` → přesunout do `public/styles.css`.

## Známé dluhy / out of scope

- **Tailwind semantic tokens** (P1 z auditu checkoutu) — vyžaduje
  refaktor `tailwind.config.ts` se semantic tokens (color.primary,
  color.bg.subtle, atd.). Samostatná práce.
- **Sweep `text-gray-{400,500}` mimo checkout** — landing, dashboard,
  watch. `/audit` na další view když budou kapacity.
- **Backfill `proformaNumber` pro staré FIO objednávky bez ZD** — SQL
  skript připravený k odpalu, ale neaplikováno. Většina těch starých už
  expirovala/zaplacena, takže low impact.
- **`/teach-impeccable` proper conversation** — `.impeccable.md` byl
  napsán autonomně z landing.tsx + CLAUDE.md, ne přes interview
  s Patrickem. Stojí za to projít a doplnit nuance.

## Operační návyky

Z CLAUDE.md:
- Před commitem: `npm run typecheck && npm test` (povinné).
- Po commitu s novou migrací: `npm run deploy` **pak** `npm run db:migrate:prod`.
- Wrangler bind: `videokurzy` worker bez `--env`, doména `kurzy.vibecoding.cz`.
- Secrets v Cloudflare dashboardu, ne přes `wrangler secret put` (jiný worker).

## Otevřené otázky pro příští session

1. **Roadmapa kurzů** — jaké kurzy konkrétně plánuješ na podzim 2026 /
   zima 2026 / jaro 2027? Bez konkrétních titulků sekce nebude credible.
2. **„Po roce staré kurzy zůstávají dostupné"** — platí to teď, nebo
   `purchase.status=expired` reálně zablokuje přístup ke všemu?
   `hasAccess()` chování ověřit, podle toho upravit copy.
3. **Komu posílat oznámení o novém kurzu** — všem aktivním předplatným
   automaticky přes `purchase.completed` event jen jednou, nebo na každý
   nový kurz? Návaznost na Resend automations.
4. **Backfill `proformaNumber`** — chceš ho udělat, nebo ne?

## Kontext pro AI agenta

- `.impeccable.md` v rootu má design context (cílovka, tone, brand).
- `MEMORY.md` v `~/.claude/projects/.../memory/` má pracovní návyky.
- Skill `frontend-design` a `audit` použity v poslední iteraci pro audit
  flow. Návrhy z auditu landing page čekají na implementaci.
