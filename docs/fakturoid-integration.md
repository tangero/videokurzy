# Fakturoid integrace

Automatické vystavování zaplacených faktur pro každý úspěšný nákup
(Stripe i FIO). Stav faktury v Fakturoidu je vždy **Zaplacená** —
žádné polostavy.

## Konfigurace

Worker `videokurzy` (Cloudflare → Variables and Secrets):

| Secret | Popis |
|---|---|
| `FAKTUROID_CLIENT_ID` | OAuth2 client ID z Fakturoid → Nastavení → API → OAuth aplikace |
| `FAKTUROID_CLIENT_SECRET` | OAuth2 client secret ze stejné aplikace |

Bez nich integrace silently přeskočí. Žádný error v hlavním
checkout flow.

Účet musí být v Fakturoidu nastavený jako **neplátce DPH**
(Nastavení → Účetnictví → DPH). Pole `vat_rate: 0` na řádcích
faktury Fakturoid pro neplátce automaticky ignoruje.

## Datový model

Sloupce v `purchase` (migrace `0012_purchase_fakturoid.sql`):

| Sloupec | Význam |
|---|---|
| `fakturoidInvoiceId` | ID faktury v Fakturoidu (pro audit + budoucí dobropisy) |
| `fakturoidSubjectId` | ID odběratele v Fakturoidu |

Pro `admin_grant_*` purchases se faktura **nevystavuje** (zdarma
přístup, žádná reálná platba).

## Hlavní flow — `exportPurchaseInvoice`

Soubor: `src/lib/fakturoid.ts`.

Pořadí kroků **musí být zachované**, jinak faktura zůstane v
nesprávném stavu:

1. **`createSubject`** — vytvoří odběratele v Fakturoidu (e-mail
   jako jméno pro B2C, doména s popisem pro B2B).
2. **`createInvoice`** — POST `/invoices.json`. Vytvoří fakturu
   ve stavu `open` (= Vystavená). `paid_on` na invoice body se
   **nenastavuje** — bylo by to misleading, Fakturoid status řídí
   payments tabulka, ne datum na faktuře.
3. **`sendInvoiceEmail`** (volitelné, jen pokud `options.sendEmail`)
   — POST `/invoices/{id}/message.json`. Pošle fakturu e-mailem.
   Status přechází `open` → `sent` (= Odeslaná).
4. **`recordPayment`** — POST `/invoices/{id}/payments.json`.
   **Vždy poslední krok.** Status přechází `sent`/`open` → `paid`
   (= Zaplacená).

Pokud `recordPayment` selže, faktura zůstane `sent`/`open`. Admin
endpoint `mark-invoices-paid` to umí opravit (viz níže).

### Kde se volá

- `src/queue.ts` — Stripe webhook (`checkout.session.completed`).
  Částka se bere z `session.amount_total` (cents → CZK).
- `src/scheduled.ts` — FIO scan (`scanFioPayments`). Částka se
  počítá z aktuálních cen × purchase.discountPercent. Volání je
  `await` — fire-and-forget by způsobilo, že worker zabije pending
  promise a `fakturoidInvoiceId` se neuloží do DB (orphan invoice
  v Fakturoidu).

## Tři historické chyby, kterým se vyhnout

1. **Fire-and-forget v scanFioPayments** → worker zabil promise →
   Fakturoid stihl fakturu vytvořit, ale DB update nezaprseděl.
   *Fix:* `await` v `scheduled.ts`.
2. **Spoléhat na `paid_on` v invoice POST** → status zůstal `open`,
   protože Fakturoid status řídí payments tabulka.
   *Fix:* vždy zavolat `/payments.json` separately.
3. **Poslat email po `payments.json`** → status se vrátil z `paid`
   na `sent`.
   *Fix:* email PŘED record payment, ne po.

## Opravné admin akce (skryté v UI, ale endpointy aktivní)

Tlačítka v adminu byla po stabilizaci flow odebrána. Endpointy
zůstávají dostupné pro budoucí ad-hoc opravy. Spustitelné curlem
z admin sessions cookie nebo dočasným tlačítkem v dashboardu.

### `POST /admin/api/purchases/issue-missing-invoices`

Pro každý **active** purchase BEZ `fakturoidInvoiceId`:

- **Admin granty** (`admin_grant_*`) → skip
- **Stripe** (`cs_live_*`) → stáhne `amount_total` ze Stripe
  Checkout Session a vystaví fakturu
- **FIO** → vypočítá částku z aktuálních cen × `discountPercent`
  a vystaví fakturu

Idempotentní (purchase s existujícím `fakturoidInvoiceId` se
přeskočí). Bezpečné spustit opakovaně.

Historický use case: po prvním nasazení integrace existovaly
purchases vytvořené před zapnutím — tahle akce pro ně doplnila
faktury zpětně.

### `POST /admin/api/purchases/mark-invoices-paid`

Pro každý active purchase **s** `fakturoidInvoiceId`:

- `fetchInvoice` z Fakturoidu
- Pokud `invoice.status === "paid"` → skip
- Jinak → `recordPayment` (zjistí částku ze Stripe session nebo
  z first line item faktury)

Historický use case: 8 faktur zůstalo ve stavu Vystavená/Odeslaná
poté, co předchozí verze `createPaidInvoice` selhala na
`payments.json` kvůli race condition. Akce je všechny dotlačila
do `paid`.

### `POST /admin/api/purchases/link-orphan-invoices`

Pro každý active purchase BEZ `fakturoidInvoiceId`:

- `findSubjectByEmail` → najde Fakturoid subjekt podle e-mailu
- `listSubjectInvoices` → vypíše jeho faktury
- Vybere fakturu s `total` přesně rovnou expected amount
  (full_price × (100 − discountPercent) / 100, zaokrouhleno dolů)
- Naváže `fakturoidInvoiceId` + `fakturoidSubjectId` do DB
- Pokud faktura není `paid`, dotáhne `recordPayment`

Historický use case: 8 orphaned faktur vzniklo, když FIO cron
volal Fakturoid fire-and-forget. Faktury existovaly v Fakturoidu,
ale neměly DB protějšek. Akce je dohledala a navázala.

### Smazat tlačítka úplně?

Ne. Tlačítka skryta z dashboardu (komentář `{/* ... */}` v
`src/routes/admin.tsx`). Endpointy zůstávají pro:
- Migraci po incidentu (vrácený výpadek Fakturoidu během
  Stripe/FIO checkoutu).
- Ruční audit (admin chce ověřit konzistenci).
- Vrácení tlačítka v případě podobné regrese v budoucnu.

## Failure modes a co s nimi

| Symptom | Pravděpodobná příčina | Řešení |
|---|---|---|
| Faktury jsou ve stavu `open` | Fakturoid /payments.json odmítl | spusť `mark-invoices-paid` |
| Faktury jsou ve stavu `sent` | Email se poslal, payment se nestihl | spusť `mark-invoices-paid` |
| Purchase má fakturoidInvoiceId = NULL ale faktura existuje | scanFioPayments před `await` fixem | spusť `link-orphan-invoices` |
| Stripe purchase má fakturoidInvoiceId = NULL | Stripe webhook proběhl před zapnutím integrace | spusť `issue-missing-invoices` |
| Fakturoid: „credentials nejsou nakonfigurované" | secrets chybí | nastav `FAKTUROID_CLIENT_ID` + `_SECRET` v CF dashboardu |

## Testování

`src/lib/fakturoid.ts` nemá unit testy — vše je network I/O proti
externí službě. Smoke test = spustit `/admin/api/purchases/issue-missing-invoices`
na produkci po deployi nového release a ověřit, že faktury vznikají
ve stavu `paid` (viditelné v Fakturoid UI).
