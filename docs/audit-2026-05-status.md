# Audit 2026-05 — stav řešení a handoff

Doprovodný dokument k [`audit-2026-05.md`](./audit-2026-05.md) (40 nálezů) a
plánu [`superpowers/plans/2026-05-31-audit-security-quality.md`](./superpowers/plans/2026-05-31-audit-security-quality.md).
Zachycuje, co je **hotové, nasazené a ověřené**, a co zbývá do navazujícího plánu.

Stav k **2026-05-31**. Vše níže je nasazené na produkci (`videokurzy` worker, `kurzy.vibecoding.cz`).

## Shrnutí stavu

| Fáze | Stav |
|---|---|
| **P0** (1 kritický + vysoké) | ✅ hotovo, nasazeno, ověřeno na produkci |
| **P1 + hardening** | ✅ hotovo, 175/175 testů, mergnuto do `main` (PR #3) |
| **Migrace 0019** (unique index) | ✅ aplikována na produkční D1 (`videokurzy-db --remote`) |
| **Produkce** | ✅ nasazena aktuální `main`, worker verze `01a5817a-481a-404a-9882-c5ce10437db9` |

Ověření nasazení P0: `POST /api/fio/verify/<vs>` bez `HX-Request` vrací **403** (Origin/HX guard běží).

## Mapa nálezů → commit

P0 commit `02d3a79` (na `main`), P1 přes PR #3 (merge `509c658`).

| Nález(y) | Závažnost | Co | Commit |
|---|---|---|---|
| 1 + 9 | KRITICKÝ | `/internal/auth/verify-add-email` — podepsaný add-email intent (`targetUserId`+`email` v HMAC), validace proti tokenu | `02d3a79` |
| 2 | vysoký | FIO verify race — atomický UPDATE s `eq(status,'pending')` | `02d3a79` |
| 3 | vysoký | Idempotence faktur — kontrola `fakturoidInvoiceId` před `exportPurchaseInvoice()` | `02d3a79` |
| 4 + 5 | vysoký | Veřejný FIO verify — Origin/HX guard + sjednocení rate-limit TTL (`FIO_RATE_LIMIT_MS`) | `02d3a79` |
| 17 | střední | PII (e-mail) odebrán z internal `console.warn` | `02d3a79` / `6f60177` |
| 6 + 14 | vysoký/stř. | FIO `amountPaid` se ukládá při vzniku pending objednávky; pay/proforma čte uloženou částku; cron fakturuje reálnou bankovní částku | `0848b5f` (Task 3) |
| 7 + 18 | vysoký/stř. | Partner API — per-key KV rate limit (SHA-256 hash klíče, 20/60 s) + sjednocení `:id` chyby na `404 not_found` (anti-enumerace) | `2564257` (Task 5) |
| 8 + 19 | vysoký/stř. | `/login/send` per-email throttle (3/120 s) + leads per-IP throttle (5/60 s) | `b96ffc5` (Task 6) |
| 20 | střední | Normalizace admin e-mailu (`normalizeEmail` na obou stranách `ADMIN_EMAIL_SET`) | `6f60177` (Task 7a) |
| 29 | nízký | Resend error log jen status, ne celé tělo | `6f60177` |
| 23 | střední | Import `PRICE_INDIVIDUAL`/`PRICE_ORGANIZATION` místo hardcoded `"2000"`/`"15000"` | `6f60177` |
| 24 + 25 | střední | Odstranění mrtvého exportu `loadDiscountSettings`, od-export `loadSettings` | `6f60177` |
| 15 + 16 | střední | Escapování admin inline polí (`escapeAttr`, `&` first) v `admin-courses.tsx` | `6f60177` |
| 28 | nízký | Partial UNIQUE index na `purchase.fioTransactionId` (migrace `0019`) | `99298f3` (Task 7b) |
| 13 | střední | KV cooldowny finančních admin operací (`checkAdminCooldown`, 60 s) na `link-orphan-invoices`, `mark-invoices-paid`, `issue-missing-invoices` | `99298f3` |
| — | — | Test admin cooldownů jako přímý unit test helperu (HTTP auth v testech nešla spolehlivě složit) | `2ef21a7` |

Pozn.: dvojí sémantika `purchase.amountPaid` (pending FIO = očekávaná částka, po
spárování = reálná) je zdokumentovaná komentářem v `src/db/schema.ts`.

## Zbývá — navazující plán (vědomě odloženo)

Pořadí dle dopadu. Žádné z těchto není kritické, ale **plošný admin CSRF** má nejvyšší
bezpečnostní hodnotu ze zbytku.

1. **Plošný CSRF pro admin POST endpointy** (nález 12). ~25+ handlerů + formuláře
   (`admin-courses.tsx:140`, `admin-users.tsx:280`). Dělat samostatně: helper na
   CSRF token v session + skryté pole + validace; nejdřív jeden vzorový form s testem.
   Částečná mitigace dnes: `SameSite=lax` (chrání HTMX/XHR, ne klasické HTML formuláře).
2. **Rotace/verzování `X-Partner-Key` + alerting** (součást 7). Vyžaduje provozní
   rozhodnutí (kde držet víc klíčů, metriky, dashboard). Rate limit už hotový.
3. **Admin rate limiting na dalších IO operacích** (zbytek 13) — `video-stats/sync`
   zatím cooldown nemá (jen 3 fakturační operace).
4. **Kvalita kódu / konzistence** (nálezy 21, 26, 30–40):
   - sdílená utilita `loadSiteConfigSettings()` v `src/lib/` (vzor `Object.fromEntries` nad `siteConfig` se opakuje ~10×)
   - centrální `formatCzk` v `src/lib/format.ts` (5 různých implementací)
   - sdílená `escapeHtml` utilita
   - zod schémata / type guardy u externích API odpovědí (queue, bunny-stats, fakturoid)
   - union typ + `default` case v queue consumeru (nález 21)
   - refaktor inline JS z `dangerouslySetInnerHTML` do modulů (27, 30)

## Provozní poznámky (pasti)

- **Migrace 0019 je už na produkci.** Při dalším deployi NENÍ třeba znovu spouštět
  `db:migrate:prod`. Nové migrace piš ručně jako `drizzle/migrations/NNNN_*.sql`
  (drizzle-kit generate je rozbité — viz [`CLAUDE.md`](../CLAUDE.md)).
- **Před UNIQUE indexem na produkci vždy pre-check duplicit** (osvědčilo se):
  ```bash
  npx wrangler d1 execute videokurzy-db --remote --command \
    "SELECT fioTransactionId, COUNT(*) c FROM purchase WHERE fioTransactionId IS NOT NULL GROUP BY fioTransactionId HAVING c>1"
  ```
- **Deploy:** `npm run deploy` = `wrangler deploy` (bez `--env`, default top-level
  prostředí). Worker `videokurzy`, bound na `kurzy.vibecoding.cz`.
- **Workflow před commitem:** `npm run typecheck && npm test` (aktuálně 175 testů).
- **Admin auth v route testech** zatím nejde spolehlivě složit (ruční better-auth
  session cookie přes HMAC nebyla guardem přijata → 403; pravděpodobně hashování
  session tokenu v DB). Proto se admin chování testuje přes přímé unit testy helperů,
  ne přes `SELF.fetch` s falešnou session. Pokud bude potřeba HTTP admin test,
  nejdřív vyřešit reálné složení session (viz `tests/routes/admin-cooldown.test.ts`
  historie).
