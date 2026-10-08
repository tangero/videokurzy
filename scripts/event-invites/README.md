# Kódy na akci z vibecoding.cz pro předplatitele videokurzů

Každý platný předplatitel (individuální licence, `kind` paid/manual/comp) dostane
dva osobní promo kódy do D1 `vibecoding-events`:

| Kód | Cena | `max_uses` | Účel |
|---|---|---|---|
| `VSTUP-XXXXXX` | 0 Kč | 1 | vstupenka zdarma pro jednoho člověka |
| `KAMARAD-XXXXXX` | např. 250 Kč | 0 = neomezeně | sleva 50 % pro kamarády, skupiny povoleny |

`max_uses` se ve vibecoding-site počítá na vstupenky (skupina o N lidech spotřebuje N
použití), takže kód `VSTUP` na skupinovou objednávku neprojde.
Promo kódy se vážou na `events.id`, nikoli na konkrétní termín.

## Postup

```bash
# 1) předplatitelé (jen čtení)
npx wrangler d1 execute videokurzy-db --remote --json --command \
  "SELECT DISTINCT lower(trim(email)) AS email FROM purchase WHERE status='active' \
   AND expiresAt > strftime('%s','now') AND kind IN ('paid','manual','comp') AND type='individual'" \
  > scripts/event-invites/out/subscribers.json

# 2) kódy (event-id a cenu termínu najdeš v adminu akce / v event_dates)
node scripts/event-invites/generate.mjs --subscribers scripts/event-invites/out/subscribers.json \
  --event-id evt_... --friend-price 250 --valid-until 2026-10-12 --batch nazev-akce

# 3) nahrát kódy (ZÁPIS do produkce)
cd ../vibecoding-site && npx wrangler d1 execute vibecoding-events --remote \
  --file=../videokurzy/scripts/event-invites/out/promo.sql

# 4) test na sebe, pak ostré rozeslání
RESEND_API_KEY=re_... node scripts/event-invites/send.mjs --url https://www.vibecoding.cz/akce/<slug>/<datum>/ --dry-run
RESEND_API_KEY=re_... node scripts/event-invites/send.mjs --url ... --only vas@email.cz  # ne patrick@zandl.cz, ta promo ignoruje (testovací 1 Kč)
RESEND_API_KEY=re_... node scripts/event-invites/send.mjs --url ...
```

Využití kódů:

```sql
SELECT note LIKE '% zdarma %' AS zdarma, COUNT(*) kodu, SUM(used_count > 0) pouzitych, SUM(used_count) vstupenek
FROM promo_codes WHERE note LIKE 'nazev-akce %' GROUP BY 1;
```

`contact_email` je u kódů prázdný schválně, jinak by cron `promo-summary` posílal
předplatitelům partnerské souhrny.
