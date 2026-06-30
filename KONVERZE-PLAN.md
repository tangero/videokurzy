# Plán v2.3: Konverzní měření pro videokurzy (Meta + Google + Sklik)

> v2 po vypořádání 3 nezávislých oponentur (technika / korektnost dat / GDPR).
> v2.2 po 1. externí review (Meta API verze, manual platby, idempotence, rozhraní, capture, Google doc).
> v2.3 po 2. externí review (Google API dostupnost, per-provider claim/retry, čas konverze,
> manual env, conversion_log kontrakt, fbc/fbp). Inline tagy **[OPRAVA]/[v2.2]/[v2.3]**.

## Changelog verzí (pro oponenturu)

Změny jsou v textu označené inline tagy `[OPRAVA]` (v1→v2) a `[v2.2]` (v2→v2.2).

- **v1** — první návrh. Server-side jako zdroj pravdy + client pixely na success page,
  napojení jen na Stripe webhook, konfigurace přes env.
- **v2** — po 3 nezávislých adversariálních oponenturách. Opraveno:
  - Bankovní převody (FIO+Creditas) se potvrzují CRONEM, ne webhookem → druhý reportovací bod.
  - GDPR: žádný consent + lživá privacy policy → consent gate jako blokující podmínka.
  - Zrušeny client-side Purchase pixely (refresh duplikuje, success page u převodů neexistuje,
    veřejná URL šla zneužít k fingování) → čistě server-side.
  - Idempotence přes `conversionReportedAt`, dedup klíč `purchase.id`, fbc/fbp/IP/UA v checkoutu.
  - Google: škrtnuta nepodložená „EC for Leads pro purchase", fázováno přes gclid capture.
- **v2.1** — drobné dotažení: Stripe consent přes session `metadata` (row vzniká až ve webhooku),
  hodnota z `match.amountPaid` u převodů, přiznán kompromis „consent gate měří jen podmnožinu".
- **v2.2** — po externí review (4 původně-blokující + 2 P2):
  - **[P1] Meta API verze** — `v21.0` zastaralá (k 30.6.2026 aktuální v25.0) → do env `META_API_VERSION`.
  - **[P1] `manual` platby** — `manuallyConfirmPayment` (`admin-users.ts:518`) je TŘETÍ místo vzniku
    placené konverze, dosud nenapojené → třetí reportovací bod.
  - **[P1] Idempotence** — `conversionReportedAt` před odesláním by při selhání konverzi ZTRATIL
    → claim-lock `conversionAttemptedAt` + per-provider stav v `conversion_log` (doposlání selhání).
  - **[P2] Rozhraní `conversions.ts`** — „bez DB", ale dělá DB claim+log = rozpor
    → `reportPurchase(db, env, purchaseId, valueOverride?)`.
  - **[P2] Click-ID capture** — `gclid` nejde „jen číst" v POST checkoutu (GET→POST nepřenáší query)
    → R5: capture na vstupu → cookie/hidden → POST.
  - **[P2] Google Ads** — upřesněno dle aktuální doc (ClickConversion + user-provided data),
    neimplementovat bez ověření conversion action v účtu.
- **v2.3** — po druhém kole externí review (3 blokery + 3 P2):
  - **[P1] Google API dostupnost** — Google od 15.6.2026 blokuje nové adoptery offline importů přes
    Google Ads API (jen allowlistnuté dev tokeny). Krok 0: ověřit allowlist → jinak Data Manager API.
  - **[P1] Claim/retry** — per-purchase `conversionAttemptedAt` z v2.2 blokoval re-run `failed` providerů
    → claim přepsán na **per-provider** v `conversion_log` (sent skip, failed doposlat).
  - **[P1] Čas konverze** — `createdAt` je u převodů čas OBJEDNÁVKY, ne platby → nová `conversionOccurredAt`
    (R6) plněná v momentě reálné platby; používá ji Google `conversion_date_time` i Meta `event_time`.
  - **[P2] Manual bod bez `env`** — `manuallyConfirmPayment` má jen `(db, opts)` → report volat v ROUTE.
  - **[P2] `conversion_log` kontrakt** — `UNIQUE(purchaseId,provider)`, `attemptCount`, `lastError`,
    `httpStatus`, `requestId`, `updatedAt`.
  - **[P2] fbc/fbp** — z `fbclid` skládat serverový `fbc` (`fb.1.<ms>.<fbclid>`), `fbp` jen z existující cookie.

## Kontext / zjištěný stav (ověřeno v kódu)
- Web: Cloudflare Workers + Hono (JSX SSR), TypeScript. Layout `src/views/layout.tsx`.
- **3 platební metody**: `stripe`, `fio`, `creditas` (`schema.ts:77`). **[OPRAVA]**
- Stripe: webhook → `WEBHOOK_QUEUE` → `handleCheckoutCompleted` (`queue.ts:234`, queue consumer, má `env`).
- **Bankovní převody (FIO + Creditas): potvrzují se CRONEM**, ne webhookem — `activateMatchedPurchase`
  v `scheduled.ts:279`. Tam nastává `status='active'` + reálná `amountPaid`. **[OPRAVA — v1 to ignoroval]**
- `purchase.id` je autoincrement PK, existuje pro VŠECHNY platební metody (`schema.ts:73`).
- `purchase.kind`: `paid|manual|comp|staff`. **Konverze reportovat jen pro reálné peníze**
  (`paid`, `manual`), NE pro `comp`/`staff` (granty zdarma). **[OPRAVA]**
- **`manual` platby vznikají ve TŘETÍM místě**: `manuallyConfirmPayment` (`admin-users.ts:518`)
  — admin ručně potvrdí pending převod, který scan nenapároval → `status='active'`, `kind='manual'`,
  vlastní `amountPaid` (override nebo očekávaná). **Tímto bodem report v1/v2 NEprošel.** **[v2.2]**
- Hodnota: `amountPaid` v Kč, už PO slevě (Stripe `price_data unit_amount = finalPrice*100`,
  `checkout.tsx:419`). Sleva tedy hodnotu nezkresluje. Měna = CZK.
- Web NEMÁ žádný cookie consent management. `privacy.tsx:72` doslova tvrdí „Nepoužíváme
  analytické ani marketingové cookies." **[BLOCKER pro client-side pixely]**
- Web nikde neukládá gclid/fbclid/utm (grep = 0).
- Web Crypto `crypto.subtle.digest("SHA-256")` v repu už funguje (`cc-news/detect.ts:46`).
- Env/secrets přes wrangler (Env v `types.ts`). Žádná D1 conversion_config (na rozdíl od vibecoding).

## Zásadní designová rozhodnutí (po oponentuře)

### R1. ČISTĚ SERVER-SIDE (žádné client-side Purchase pixely). **[OPRAVA]**
v1 chtěl client Purchase pixel na success page. Zrušeno, protože:
- Success page se nezobrazí spolehlivě jednou (refresh → duplicita).
- U FIO/Creditas se success page NIKDY nezobrazí (kupující odejde s číslem účtu).
- Veřejná `/checkout/success?session_id=` bez validace → kdokoli nafingује konverzi.
→ Reporting jde výhradně server-side z míst, kde platba reálně nastává. Stejný model jako
referenční `vibecoding-site/conversions.ts`. Tím padá race condition, dedup i fingování naráz.

**Výjimka — pixely v layoutu** (PageView/retargeting pro Meta/Sklik/gtag) se NEnasadí dokud
není consent vrstva (viz R4). Pro konverze nejsou potřeba; server-side stačí.

### R2. TŘI reportovací body, ne jeden. **[OPRAVA — hlavní věcný blocker v1; rozšířeno v2.2]**
`reportPurchase(db, env, purchaseId, valueOverride?)` se volá ze VŠECH tří míst, kde vzniká
reálná placená konverze:
1. `handleCheckoutCompleted` (`queue.ts`) — Stripe nákupy. Jednou, na konci, mimo if/else větve.
   Hodnota = `paidAmountCzk` (z `amount_total`).
2. `activateMatchedPurchase` (`scheduled.ts`) — FIO + Creditas (cron scan).
   **Hodnota = `match.amountPaid` (reálně přijatá), NE `p.amountPaid`** — to u pending FIO drží jen
   OČEKÁVANOU částku z objednání (`schema.ts:105`). **[OPRAVA v2.1]**
3. Ruční potvrzení převodu adminem (`kind='manual'`). Hodnota = `amountPaid` použitá při potvrzení
   (`opts.amountPaid ?? row.amountPaid`). **POZOR [v2.3]: `manuallyConfirmPayment` (`admin-users.ts:518`)
   bere jen `(db, opts)` a `env` NEMÁ.** `env` je až v route handleru (`admin.tsx:1256`, má `c.env`).
   Helper nechat čistě DB; **`reportPurchase` volat v ROUTE po úspěšném `manuallyConfirmPayment`**
   (tam je `c.env` i `db`), ne uvnitř helperu.
Bez bodu 2 by se neměřila polovina trafficu; bez bodu 3 by chyběly ručně potvrzené převody.
Guard na `kind` uvnitř `reportPurchase` stejně odfiltruje comp/staff, takže přidání bodu 3 je bezpečné.

### R3. Idempotence + retry: claim PER-PROVIDER, ne per-purchase. **[OPRAVA; v2.2; přepracováno v2.3]**
v2 mělo díru: `conversionReportedAt` PŘED odesláním → selhání = trvalá ztráta. v2.2 zavedlo
per-purchase `conversionAttemptedAt`, ale to mělo **vnitřní rozpor**: jakmile první pokus nastaví
`conversionAttemptedAt`, další běh skončí na purchase-level skipu a `failed` provider se NEdoposlá. **[v2.3]**
Opraveno — claim i stav jsou **per-provider** v `conversion_log`, žádný purchase-level lock:
- `conversion_log` má unikát `(purchaseId, provider)` (viz migrace). Pro každý aktivní provider
  `reportPurchase` provede **atomický upsert-claim**:
  `INSERT (purchaseId, provider, status='pending', attemptCount=1) ON CONFLICT(purchaseId,provider)
   DO UPDATE SET status='pending', attemptCount=attemptCount+1, updatedAt=now
   WHERE conversion_log.status != 'sent'`
  a přečte `meta.changes` (funkční vzor `admin-users.ts:438`).
  - 0 změněných řádků → provider už `sent` (nebo si claim drží souběžný běh) → **skip jen tento provider**.
  - >0 → claim získán → odeslat; po výsledku `UPDATE status='sent'|'failed', httpStatus, lastError, updatedAt`.
- **Re-run doposílá jen `failed`/`pending` providery** — `sent` se přeskočí, ostatní se zkusí znovu.
  Tím funguje queue retry (max_retries=3), opět. cron scan i ruční `retryFailed`, bez ztráty konverze.
- **Žádný `conversionAttemptedAt`/`conversionReportedAt` na purchase** (v2.2 sloupce ruším).
  Volitelně lze `conversionReportedAt` dopočítat jako „všichni aktivní provideři sent", čistě informativně.
- (Souběh: claim přes `status!='sent'` ve WHERE chrání před dvojím odesláním téhož provideru;
  krátké okno dvou souběžných `pending` claimů řeší Meta `event_id` dedup, u Google `order_id`/dedup okno.)
- `eventId` (Meta dedup) = `purchase.id`, ne `session_id` (session_id u převodů neexistuje). **[OPRAVA]**

### R4. GDPR — consent gate je podmínka nasazení. **[BLOCKER, řešit napřed]**
- Server-side CAPI s hashed emailem/IP je marketingové zpracování → právní základ = souhlas,
  ne „plnění smlouvy". Stav souhlasu musí dotéct až do reportu.
- **fbclid/fbp/IP/UA + marketingový souhlas zachytit v checkoutu** (`checkout.tsx`, kde JE request
  kontext). POZOR na dvě různé cesty: **[OPRAVA v2.1]**
  - **Stripe path**: purchase row vzniká až později v queue consumeru z webhooku (request uživatele
    tam není). Signály proto protáhnout přes **Stripe session `metadata`** (jako dnes `extractBilling`,
    `queue.ts:222`) a v `handleCheckoutCompleted` je z metadata přečíst. NE ukládat na row v checkoutu
    (row ještě neexistuje). IP/UA z hosted Stripe stránky nejsou uživatelovy → brát je z requestu
    při zakládání checkoutu, ne z webhooku.
  - **FIO/Creditas path**: row se zakládá přímo v requestu (`checkout.tsx:529`) → uložit signály
    rovnou na insert.
- `reportPurchase` pošle konverzi jen když `purchase.marketingConsent = true`.
- Lehký vlastní cookie banner (cookie + stav), netřeba placený CMP. Google Consent Mode v2,
  Meta fbq consent, Sklik `consent` param plnit reálnou hodnotou (NIKDY napevno `consent:1`).
- **Přepsat `privacy.tsx`**: doplnit Meta/Google/Seznam jako příjemce, účel měření+remarketing,
  právní základ souhlas, přenos do 3. země (Meta DPF/SCC), hashování. Dokud se nepřepíše,
  jsme v rozporu i kdyby consent technicky fungoval.

## Architektura

### `src/lib/conversions.ts` (server-side; DB potřebuje pro claim + log) **[rozhraní přepsáno v2.2]**
v2 popisoval modul jako „bez DB závislostí", ale měl dělat DB claim i `conversion_log` → vnitřní
rozpor. **[v2.2]** Opraveno: rozhraní `reportPurchase(db, env, purchaseId, valueOverride?)`:
- Uvnitř načte aktuální `purchase` row (email, kind, createdAt, consent, fbc/fbp/ip/ua, amountPaid).
  `valueOverride` pokrývá případy, kdy se reálná hodnota liší od `p.amountPaid` (cron `match.amountPaid`,
  manuál `opts.amountPaid`). Volající nemusí skládat celý objekt — předá jen ID + případně hodnotu.
- **Claim** dle R3 (atomický UPDATE `conversionAttemptedAt`, čtení `meta.changes`); 0 změněných → skip.
- Guard: skip pokud `kind` ∈ {comp, staff} nebo hodnota `<=0` nebo `!marketingConsent`.
- `Promise.allSettled([ sendMetaCapi(), sendGoogleAds() ])` + per-call `try/catch`; výsledek každého
  provideru zapíše do `conversion_log` (`sent|failed`), aby šlo selhání doposlat (R3).
- **Vnější `try/catch` v místě volání** (queue.ts / scheduled.ts / admin-users.ts) tak, že reportPurchase
  NIKDY nepropustí výjimku nahoru → nesmí shodit aktivaci/fakturaci/retry. **[OPRAVA]**
- **`AbortSignal.timeout(3000)`** na každý fetch (visící API nesmí blokovat consumer). **[OPRAVA]**
- **Meta retry** s exp. backoffem na 5xx / transient (převzít z reference conversions.ts).

### Meta CAPI (`sendMetaCapi`)
- Endpoint `graph.facebook.com/{META_API_VERSION}/{META_PIXEL_ID}/events`, event `Purchase`.
- **Verzi API dát do env `META_API_VERSION`, NE hardcode `v21.0`.** **[v2.2]** K 30. 6. 2026 je
  aktuální v25.0; v23.0 měla dostupnost do 9. 6. 2026, takže v21.0 je za zenitem. Default nastavit
  na aktuální podporovanou verzi a ověřit v changelogu (developers.facebook.com/docs/graph-api/changelog).
- `event_id = purchaseId` (dedup), `value`, `currency:'CZK'`, `user_data`: hashed em (trim+lower+SHA256),
  + `fbc`/`fbp`/`client_ip_address`/`client_user_agent` pokud zachyceny v checkoutu (lepší match).
- Konfigurace: `META_PIXEL_ID` (public ok), `META_CAPI_TOKEN` (server-only secret),
  `META_TEST_EVENT_CODE` (jen test, v produkci NESMÍ zůstat).

### Google Ads — fázovat + ověřit dostupnost API. **[OPRAVA; v2.2; přepracováno v2.3]**
- **NEJDŘÍV ověřit dostupnost cesty.** **[v2.3]** Google k **15. 6. 2026 blokuje nové adoptery**
  offline click conversion importů přes Google Ads API — `UploadClickConversions` je dostupné jen
  pokud byl developer token **allowlistnutý podle předchozího použití**. Pro nový token / účet, který
  to dosud nedělal, je správná cesta **Data Manager API**, NE Google Ads API. Krok 0 fáze B:
  ověřit allowlist developer tokenu; podle výsledku zvolit Google Ads API (allowlistnutý) nebo
  Data Manager API (nový adopter). Zdroje:
  ads-developers.googleblog.com/2026/05/changes-to-offline-click-conversion.html ;
  developers.google.com/google-ads/api/docs/conversions/upload-offline.
- `ClickConversion` podporuje `gclid`/`gbraid`/`wbraid`, `conversion_date_time`, `consent`, `order_id`.
  Web žádné click ID neukládá (grep = 0). User-provided data (hashed email) mohou pomoct atribuci
  i bez GCLID, ale **závisí na typu conversion action v účtu** — bez ověření nepokračovat.
- **Fáze A (teď): zavést click-ID capture** — viz R5 (capture na vstupu, ne ze static GET formuláře).
- **Fáze B: až click ID teče A je ověřená API cesta** → Offline/Data Manager import z `reportPurchase`.
  OAuth refresh → `oauth2.googleapis.com/token`, access token CACHOVAT v KV (~50 min TTL, ne per-nákup).
  REST (ne gRPC). `login-customer-id` = MCC bez pomlček. `conversion_date_time` = **`conversionOccurredAt`**
  (viz R6), NE `createdAt`.
- Do té doby Google = jen volitelný client-side gtag conversion na success page PO consentu (fáze C).

### R5. Click-ID capture: GET → POST flow neprochází sám od sebe. **[v2.2]**
Současné checkout GET stránky query parametry nepropisují do POST formuláře; POST má jen vlastní pole
(`src/views/checkout.tsx:83`, `src/routes/checkout.tsx:215`). `gclid`/`gbraid`/`wbraid`/`fbclid` proto
nelze „jen přečíst v checkout.tsx" při POSTu. Nutný řetězec:
1. **Capture na vstupu** (landing / GET checkout): přečíst query → uložit do **first-party cookie**
   (krátká TTL) NEBO hidden field ve formuláři. Capture cookie smí být marketingová → až po consentu.
   - **fbc/fbp upřesnění [v2.3]**: ukládá se serverový **`fbc`** ve formátu `fb.1.<ms>.<fbclid>`
     odvozený z URL `fbclid` (NE raw `fbclid`). **`fbp`** se NEgeneruje server-side — vezme se jen
     pokud už `_fbp` cookie existuje (vytváří ji Meta Pixel po consentu). Bez pixelu/consentu `fbp` chybí
     a posílá se jen `fbc`+email. Neplést raw `fbclid` se serverovým `fbc`.
   - Google: `gclid`/`gbraid`/`wbraid` se ukládají tak, jak přišly v URL (žádná transformace).
2. **POST checkout**: přečíst cookie/hidden field.
3. **Stripe path** → do session `metadata`; **FIO/Creditas path** → na `purchase` insert.
4. Z metadata/row je pak `reportPurchase` přiloží do CAPI / Offline Conversions.

### R6. Čas konverze = čas PLATBY, ne čas objednávky. **[v2.3]**
v2.2 chtělo `conversion_date_time` z `purchase.createdAt`. To je ale **čas objednávky**, a u FIO/Creditas
mezi objednáním a přijetím platby uběhnou klidně dny → Google/Meta by dostaly událost datovanou PŘED
faktickou konverzí. Měříme Purchase až po reálné platbě, takže potřebujeme samostatný čas konverze:
- **Nová kolonka `purchase.conversionOccurredAt`** (nullable), nastavená v momentě, kdy platba reálně
  nastane — z každého ze tří reportovacích bodů:
  - **Stripe**: čas z `checkout.session.completed` (webhook event / session created), v consumeru.
  - **FIO/Creditas**: datum bankovní transakce nebo čas spárování v `activateMatchedPurchase`.
  - **manual**: čas ručního potvrzení v route handleru.
- `reportPurchase` posílá `conversion_date_time` (Google) i `event_time` (Meta CAPI) z `conversionOccurredAt`.
  Deterministické (uložené, ne `new Date()` při běhu) → idempotentní i při retry.
- Pozn. Meta CAPI okno: `event_time` nesmí být starší než 7 dní — u dlouho visících převodů, které se
  zaplatí pozdě, je `conversionOccurredAt` (čas platby) správně uvnitř okna, `createdAt` by mohl vypadnout.

### Sklik
- Sklik nemá rozumné server-side konverzní API → zůstává client-side `rc.js` `conversionHit`.
- Dědí slabiny success page (refresh, FIO neprojde) → **na videokurzech má Sklik konverze omezenou
  spolehlivost**; přiznat. Mitigace: jednou přes `sessionStorage` flag keyovaný na purchase/session,
  `consent` param reálný. Sklik retargeting v layoutu až po consentu.

### Migrace (Drizzle) **[upraveno v2.2; v2.3]**
Nové nullable sloupce na `purchase`: `conversionOccurredAt` (čas platby, R6), `marketingConsent`,
`fbc`, `fbp`, `gclid`, `gbraid`, `wbraid`, `clientIp`, `userAgent`.
**[v2.3] `conversionAttemptedAt`/`conversionReportedAt` z v2.2 ZRUŠENY** — claim je per-provider
v `conversion_log` (R3), ne na purchase.

Tabulka `conversion_log` — kontrakt pro deterministický re-run **[v2.3]**:
- `purchaseId` (FK), `provider` (`meta|google|sklik`)
- **`UNIQUE(purchaseId, provider)`** — bez něj vznikají duplicitní řádky a není jasné, co je pravda
- `status` (`pending|sent|failed`)
- `attemptCount` (int, ++ při každém claimu), `lastError` (text), `httpStatus` (int), `responseBody` (text)
- `requestId` (idempotency key poslaný provideru, kde to dává smysl)
- `createdAt`, `updatedAt`

## Pořadí implementace (fázované, každá fáze samostatně nasaditelná)
1. **Consent vrstva + přepis privacy.tsx** (R4) — BLOCKER, musí být první.
2. **Migrace** (nové sloupce + conversion_log).
3. **Click-ID + consent capture** (R5: capture na vstupu → cookie/hidden → POST → Stripe metadata / FIO row).
4. **`conversions.ts` + Meta CAPI** s claim/log/retry/timeout/guard a env `META_API_VERSION`.
5. **Napojení reportPurchase ze TŘÍ míst**: `queue.ts` (Stripe), `scheduled.ts` (FIO+Creditas) — oba
   mají `env`; **manual v ROUTE `admin.tsx:1256` po `manuallyConfirmPayment`** (helper `env` nemá, R2/v2.3).
   Každý bod nastaví `conversionOccurredAt` (R6). Idempotence per-provider claim (R3).
6. **Test** Meta přes test_event_code → Events Manager.
7. **Google fáze B** (až click ID teče): **KROK 0 — ověřit allowlist developer tokenu** → podle výsledku
   Google Ads API NEBO Data Manager API (R-Google/v2.3). Pak import + KV token cache. Ověřit conversion action.
8. **Sklik + base pixely v layoutu** za consent gate.

## Testování
- Meta: `META_TEST_EVENT_CODE` → Events Manager Test Events živě vidí Purchase + dedup dle event_id.
- Stripe test mode nákup → ověřit report z queue. FIO: testovací spárování → report z cronu.
  Manual: admin ruční potvrzení (route) → ověřit report. Ověřit `conversionOccurredAt` = čas platby, ne objednávky.
- Idempotence: ručně přehrát queue zprávu → `sent` provider se NEpošle podruhé (per-provider claim).
  Selhání Meta → `conversion_log` drží `failed`; re-run **doposílá `failed`, ale `sent` přeskočí** (R3).
- Google: API diagnostics / „Recent conversions" v Ads. Sklik: náhled měření konverzí.

## Zbytkové vědomé kompromisy (ne blockery)
- **Consent gate měří jen PODMNOŽINU konverzí.** Reportujeme jen při `marketingConsent=true`;
  u B2B checkoutu opt-in potvrdí typicky menšina (~20–50 %). Naměřená konverzní base tedy NENÍ
  úplná → počítat s tím při hodnocení ROAS/CPA a nesrovnávat 1:1 s interním revenue z DB. **[v2.1]**
- Subscription renewal (`invoice.paid`, `queue.ts:464`) se NEreportuje — měříme jen akvizici. Záměrně.
- Match rate u Meta bez fbc (organik) bude nižší — akceptováno, email match funguje.
- Sklik konverze méně spolehlivá než Meta CAPI — akceptováno, je to omezení Sklik API.
- Nákup bez emailu se nezměří (Meta nemá match key) — okrajový případ, akceptováno.
