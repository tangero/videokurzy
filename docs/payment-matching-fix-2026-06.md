# Oprava párování plateb — červen 2026

**Datum:** 2026-06-11
**Branch/PR:** `fix/payment-matching-fio-proxy` → [PR #9](https://github.com/tangero/videokurzy/pull/9)
**Stav:** kód hotový, typecheck + 271 testů zelené, **NENASAZENO** (čeká na deploy proxy + CF proměnné).

## Spouštěč

Uživatel `pcvrcek@softeu.com` zaplatil 1500 Kč, ale platba se nenapárovala a
zůstala viset jako `pending`. Admin mu ručně přidal účet jako `comp` (grant
zdarma) — tím sice dostal přístup, ale účetně to vypadalo, že nezaplatil.
Rozbor odhalil **tři nezávislé příčiny / mezery**, které tento PR řeší.

## Diagnóza

### Příčina A — FIO API z Cloudflare Workers padá na chybu 525
`fioapi.fio.cz` běží na TLSv1.3 a **neumí ALPN negotiation** (ověřeno přes
`openssl s_client` → „No ALPN negotiated"). Cloudflare Workers `fetch()`
s takovým peerem nedokončí TLS handshake a vrací **525 (SSL handshake failed)**.
Z běžného Node.js prostředí (mimo Workers) stejné spojení projde bez problému.

Důsledek: FIO scan z workeru nikdy nenačte transakce → žádná FIO platba se
nenapáruje. Creditas tím netrpí (modernější API), proto funguje napřímo.

### Příčina B — párování bylo vázané na banku z objednávky (cross-bank slepá skvrna)
Původní `scanFioPayments` pároval jen objednávky s `paymentMethod='fio'` proti
FIO transakcím a `scanCreditasPayments` jen `creditas` proti Creditas. Jenže
lidé reálně platí, kam mají uložený účet — typicky pošlou **Creditas objednávku
na starý FIO účet** podle dřívější faktury. Taková platba se strukturálně nikdy
nenapárovala. Přesně případ `pcvrcek@softeu.com`: objednávka byla Creditas
(VS prefix 34), ale 1500 Kč dorazilo na FIO účet 2010.

### Příčina C — nebyl způsob, jak evidovat ručně potvrzenou platbu
Jediná ruční cesta byla grant `kind='comp'` (přístup zdarma, `amountPaid=0`,
mimo revenue). Chyběla sémantika „peníze reálně dorazily, jen je párovač minul".

## Řešení

### 1. Cross-bank párování (`src/scheduled.ts`)
Nová funkce **`scanBankPayments`** vybere všechny pending převodové objednávky
(`paymentMethod IN ('fio','creditas')`), načte transakce z **obou** bank
nezávisle a každou objednávku zkusí napárovat nejdřív proti „své" bance, pak
proti druhé jako fallback. Transakce se zapíše do sloupce podle banky, kde se
reálně našla (`fioTransactionId` / `creditasTransactionId`). Dedup per banka
(`usedFio` / `usedCre`). Selhání načtení jedné banky neshodí druhou.

`scanFioPayments` zůstal jako zpětně kompatibilní wrapper (kvůli ručnímu scanu
v adminu a internal callsite). V cronu se volá jednou místo dvakrát.

### 2. FIO proxy (`fio-proxy/`)
Relay v **Node.js + Hono** (Docker, určeno pro rock8.cloud), které obejde
chybu 525: worker volá proxy (moderní TLS, ALPN OK), ta přepošle request na FIO
a vrátí JSON 1:1.

- `GET /transactions?dateFrom=…&dateTo=…` — ověří `Bearer <PROXY_SECRET>`,
  zavolá FIO s tokenem z vlastního env, relayuje status + tělo.
- `GET /health` — bez autentizace.
- **FIO token žije jen na proxy** (`FIO_API_TOKEN` env na rock8), worker ho
  nezná. Worker se autentizuje sdíleným `PROXY_SECRET`.

Worker (`src/lib/fio.ts`): `fetchFioTransactions` má volitelný 3. argument
`proxy`. Helper `fioProxyFromEnv(env)` vrátí proxy config, když jsou nastavené
**obě** proměnné `FIO_PROXY_URL` + `FIO_PROXY_SECRET`; jinak fallback na přímé
volání FIO. Zapojeno ve scheduled scanu, checkoutu i admin `/admin/api/fio/diagnose`
(ten nově ukáže `"mode": "proxy"` vs `"direct"`).

Návod na nasazení: [`fio-proxy/DEPLOY.md`](../fio-proxy/DEPLOY.md).

### 3. Ruční potvrzení platby (`kind='manual'`)
Přidána 4. hodnota `purchase.kind` = **`manual`** vedle `paid`/`comp`/`staff`.
`manual` = reálné peníze potvrzené ručně adminem → **počítá se do revenue a
fakturace jako `paid`** (na rozdíl od `comp`/`staff` grantů zdarma).

- `manuallyConfirmPayment()` v `src/lib/admin-users.ts` — aktivuje konkrétní
  pending objednávku (NEzakládá druhý řádek): status→active, kind→manual,
  amountPaid, grantedBy, expiresAt (+1 rok, pokud původní propadla). Zachová
  původní VS, typ i metodu.
- Admin: tlačítko **„Potvrdit platbu"** u pending paid objednávky v detailu
  uživatele → `POST /admin/users/:id/purchases/:purchaseId/confirm`.
- Revenue dotazy (karty, buyerRow, revenueTotal/Active), `accessSource`
  a renewal-reminders zahrnují `manual`.
- **Bez DB migrace** — `kind` je volný text bez CHECK constraintu, jen TS enum
  ve `schema.ts`. D1 přijme novou hodnotu bez DDL.

## Vyřešený konkrétní případ

`pcvrcek@softeu.com` (2026-06-11): původní pending creditas objednávka (id 90,
VS 34824923, 1500 Kč) aktivována na `kind='manual'`, `status='active'`,
platnost do 2027-06-11, `grantedBy=zandl@marigold.cz`. Provizorní `comp` řádek
(id 100) smazán. Uživatel má teď jeden čistý `manual` řádek. Provedeno přímo
SQL na produkční D1 (data fix, nezávislý na deployi kódu). FIO platba zůstane
nenapárovaná na FIO účtu, ale účetně je evidovaná.

## Co zbývá k dokončení (deploy)

> Bez těchhle kroků FIO platby dál nepůjdou načíst (525). Cross-bank fix a
> tlačítko „Potvrdit platbu" naběhnou hned po `npm run deploy`, nezávisle na proxy.

1. **Mergnout PR #9** do `main`.
2. **Nasadit `fio-proxy/` na rock8.cloud** — build root `fio-proxy/`, env
   `FIO_API_TOKEN` (ostrý) + `PROXY_SECRET` (`openssl rand -hex 32`).
   Detaily: [`fio-proxy/DEPLOY.md`](../fio-proxy/DEPLOY.md).
   - ⚠️ Otevřená nejistota: dokumentace rock8.cloud nepotvrzuje podporu
     monorepo subdirectory. Když nepůjde, varianta A = samostatné repo
     (viz DEPLOY.md sekce „Když nejde subdirectory").
3. **V CF dashboardu** (videokurzy → Variables) nastavit `FIO_PROXY_URL` +
   `FIO_PROXY_SECRET` (= stejná hodnota jako `PROXY_SECRET`). Ne přes
   `wrangler secret put`.
4. **`npm run deploy`** workeru.
5. Ověřit `/admin/api/fio/diagnose` → `"mode": "proxy"` + reálné transakce.
6. Spustit ruční FIO scan v adminu — spáruje nezaplacené pending objednávky.

## Dotčené soubory

- `src/scheduled.ts` — `scanBankPayments` (cross-bank), proxy ve fetchi.
- `src/lib/fio.ts` — `fetchFioTransactions(…, proxy?)`, `fioProxyFromEnv`.
- `src/lib/admin-users.ts` — `manuallyConfirmPayment`, typ detailu, accessSource.
- `src/routes/admin.tsx` — confirm route, tlačítko stavů, revenue dotazy, diagnose proxy.
- `src/routes/checkout.tsx` — proxy ve verifikaci platby.
- `src/lib/renewal-reminders.ts` — `manual` v renewal filtru.
- `src/db/schema.ts` — `kind` enum rozšířen o `manual`.
- `src/types.ts` — `FIO_PROXY_URL`, `FIO_PROXY_SECRET`.
- `src/views/admin-users.tsx` — tlačítko „Potvrdit platbu", zobrazení `manual`.
- `fio-proxy/` — nová proxy (server.js, Dockerfile, README.md, DEPLOY.md).
- `CLAUDE.md` — pasti: FIO 525/proxy, cross-bank, ruční potvrzení.
