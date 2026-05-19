# Payment reminders (FIO pending)

Automatické upomínky platby pro nezaplacené FIO objednávky a storno email
po uplynutí splatnosti. Stripe pending se ignoruje — karta platí okamžitě.

## Timeline jedné FIO objednávky

```
Den 0       │ Objednávka vytvořena (status='pending', expiresAt=+7 dní)
            │ → fioPendingHtml email s QR a platebními údaji
            │
Den 2 ± 12h │ ⏰ 1. upomínka — "Připomínáme platbu kurzu"
            │   QR + IBAN + odkaz na /checkout/pay/<vs> + link na kartu
            │
Den 5 ± 12h │ ⏰ 2. upomínka — "Platba kurzu — splatnost končí za 2 dny"
            │   Urgentnější tón, jinak stejný obsah
            │
Den 7+      │ Auto-storno: status='expired'
            │ → paymentCancelledHtml email s odkazem na novou objednávku
            │
Kdykoli     │ Pokud platba dorazí → scanFioPayments spáruje, status='active'
            │ → purchaseConfirmedHtml. Další upomínky filtr `status='pending'`
            │ vyhodí.
```

Cron běží denně v 03:00 UTC (registrace v `wrangler.toml: crons = ["0 3 * * *"]`).
Pořadí v `handleScheduled`: **scan → reminders → expire → renewals**. Tím se
neupomíná objednávka, která byla v témže běhu spárována nebo expirována.

## Filtr objednávek

`sendPaymentReminders` v `src/lib/payment-reminders.ts`:

```sql
WHERE status = 'pending'
  AND paymentMethod = 'fio'
  AND kind = 'paid'                            -- granty (comp/staff) se neupomínají
  AND createdAt ∈ [now - day - 12h, now - day + 12h]   -- day ∈ {2, 5}
  AND variableSymbol IS NOT NULL               -- bez VS by uživatel neměl jak zaplatit
```

Storno (`expirePendingFioOrders`) přidává `expiresAt < now`, jinak stejný filtr.

## Dedup přes KV

Klíč: `payment-reminder:<purchase_id>:<day>` (day ∈ {2, 5}).
TTL: **14 dní** — bohatě překrývá pending okno (7d) + buffer pro ad-hoc běhy
cronu. Druhý běh stejný den najde klíč a inkrementuje `skipped`, ne `sent`.

Renewal reminders používají oddělený prefix `reminder:<id>:<daysLeft>` — žádná
kolize.

## Šablony emailů

V `src/lib/email.ts`:

- `paymentReminder2dHtml(opts)` — jemné připomenutí
- `paymentReminder5dHtml(opts)` — urgence před auto-stornem
- `paymentCancelledHtml({ reorderUrl, vs })` — info o stornu + nová objednávka

`PaymentReminderOpts` obsahuje VS, částku, číslo účtu, splatnost, SPD řetězec,
`payUrl` (FIO stránka) a `cardUrl` (Stripe flow).

### QR kód

PNG generuje **api.qrserver.com** jako externí `<img>`:

```
https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=<SPD URI>
```

Žádná build dependence, žádný PNG/SVG embed. Service je veřejná a stabilní;
kdyby přestala fungovat, email se odešle bez obrázku (alt text "QR platba"
zůstane, IBAN+VS v tabulce pod tím pokrývají manuální zadání).

### Link na platbu kartou

Sekundární odkaz `${BETTER_AUTH_URL}/checkout/<type>` jde na běžný checkout
flow. Uživatel tam vybere Stripe a vytvoří se mu **nová** objednávka. Pending
FIO řádek zůstane a stornuje se časem (7d) nebo manuálně.

> Důvod: existující VS nelze "přepnout" na Stripe bez nové route a refactoru
> checkoutu. Pragmatic compromise — uživatel zaplatí kartou, dostane přístup,
> starý pending sám zmizí.

## Kill switch

Env var **`PAYMENT_REMINDERS_ENABLED`** (Cloudflare → Variables and Secrets):

| Hodnota | Chování |
|---|---|
| `"false"` | `sendPaymentReminders` skončí okamžitě, `skipped=-1` v logu. `expirePendingFioOrders` stále expiruje, ale **bez** storno emailu. |
| chybí / cokoli jiného | Reminders i storno emaily zapnuté (default) |

Nastavení:

```bash
npx wrangler secret put PAYMENT_REMINDERS_ENABLED
# pak zadat: false
```

Smazání (= znovu zapnout):

```bash
npx wrangler secret delete PAYMENT_REMINDERS_ENABLED
```

## Edge cases

| Případ | Chování |
|---|---|
| Uživatel zaplatí mezi 1. a 2. upomínkou | Spárováno přes `scanFioPayments` v dalším cronu → `status='active'` → filtr ho z 5d upomínky vyhodí |
| Cron spadne den 2, doběhne den 2.4 | Okno ±12 h zachytí; pokud doběhne ještě jednou, KV dedup |
| Uživatel zaplatí přesně mezi cron během 5d a auto-stornem 7d | Den 5 dostane upomínku, den 6 zaplatí, den 7 ráno `scanFioPayments` spáruje (před `expire`) → bez storno emailu |
| Platba dorazí po stornu | Manuální admin musí status vrátit na active. (Auto-restore není implementovaný — záměrně, aby se nestrhával accidental refund.) |
| Komp/staff grant s krátkou platností | Vynechán filtrem `kind='paid'`. Renewal reminders ho ošetří před expirací. |

## Logging

Hledat v Cloudflare logs (worker `videokurzy`):

```
[cron] payment reminders: sent=2, errors=0, skipped=3
[cron] payment reminders: KILLED via PAYMENT_REMINDERS_ENABLED=false
[cron] expired 1 pending FIO orders at <timestamp>
[cron] cancel email for purchase 42 failed: <err>
```

## Soubory

| Cesta | Co |
|---|---|
| `src/lib/payment-reminders.ts` | Hlavní logika `sendPaymentReminders` |
| `src/lib/email.ts` | 3 šablony + `PaymentReminderOpts` typ + `qrImageTag` helper |
| `src/scheduled.ts` | Napojení v `handleScheduled`, rozšířený `expirePendingFioOrders` o cancel email |
| `src/config/payment.ts` | `FIO_PAYMENT_REMINDER_DAYS = [2, 5]` |
| `tests/lib/payment-reminders.test.ts` | 6 testů (2d, 5d, skip filters, KV dedup, kill switch, missing VS) |

## Konfigurovatelnost

Časování upomínek (`FIO_PAYMENT_REMINDER_DAYS = [2, 5]`) je hardcoded.
Pokud bude potřeba změnit, jediná konstanta + případně nová email šablona
v `TEMPLATE_BY_DAYS` mapě v `payment-reminders.ts`. Pro tři a více upomínek
je třeba přidat odpovídající `paymentReminderXdHtml` šablonu.
