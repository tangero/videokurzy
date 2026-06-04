# Osobní slevové odkazy (invite tokeny) — design

**Datum:** 2026-06-03
**Stav:** návrh k odsouhlasení

## Cíl

Nabídnout 50% slevu lidem, které máme v placených kurzech na jiném systému
(vibecoding.cz). Každý dostane **osobní jednorázový odkaz**, kterým si slevu
aktivuje sám — bez psaní kódu, bez administrativy na jeho i naší straně po
prvotním rozeslání. Sleva je **časově omezená**.

## Klíčová rozhodnutí (odsouhlasená)

1. **Osobní jednorázový token**, vázaný evidenčně na e-mail příjemce.
2. **Spotřeba tokenu až při zaplacení** (aktivaci nákupu) — nedokončená/nezaplacená
   objednávka token nespálí.
3. **Shoda e-mailu se nevynucuje** — token sám je autoritou, nákup může být na
   jakýkoli e-mail (na vibecoding.cz může mít člověk jinou adresu).
4. **Sleva platí na B2C i B2B** (2000→1000 Kč, 15000→7500 Kč).
5. **Časová expirace** tokenu (datum nastavíme při generování dávky).
6. Token je jednorázový → na obnovení (renewal) po roce se neuplatní automaticky,
   protože renewal flow nejde přes checkout s invite parametrem.
7. **Rozesílka:** CSV e-mailů → generátor tokenů → Resend.

## Architektura

Systém je **paralelní** ke stávající globální zaváděcí slevě (`src/lib/discount.ts`,
jeden kód v `site_config`). Invite tokeny tu logiku nenahrazují; rozšiřují ji o
osobní vrstvu, která má při checkoutu přednost a funguje i když je globální sleva
vypnutá.

### Komponenty

#### 1. Datový model — tabulka `discount_invite`

Nová tabulka (`src/db/schema.ts` + ruční migrace `drizzle/migrations/NNNN_discount_invites.sql`):

| sloupec            | typ                      | popis                                                        |
|--------------------|--------------------------|--------------------------------------------------------------|
| `token`            | text PRIMARY KEY         | náhodný `nanoid()`, nese se v URL                            |
| `email`            | text NOT NULL            | komu byl vystaven (evidence; shoda se nevynucuje)           |
| `percent`          | integer NOT NULL         | typicky 50                                                   |
| `label`            | text                     | popisek do checkoutu, např. „Osobní sleva pro absolventy"   |
| `expiresAt`        | integer (timestamp) NULL | NULL = bez expirace; jinak platí do data                    |
| `createdAt`        | integer (timestamp) NOT NULL |                                                          |
| `batch`            | text NULL                | označení dávky (např. `vibecoding-2026-06`) pro reporting   |
| `usedAt`           | integer (timestamp) NULL | NULL = nevyužitý; vyplní se při aktivaci nákupu             |
| `usedByPurchaseId` | integer NULL             | FK na `purchase.id` — který nákup token spotřeboval         |

Token je **platný** když: existuje, `usedAt IS NULL` a (`expiresAt IS NULL` nebo
`expiresAt > now`).

#### 2. Vyhodnocení slevy — rozšíření `src/lib/discount.ts`

Nová funkce `resolveInviteDiscount(db, token, now)`:
- vrátí `{ percent, token, label } | null`,
- načte řádek z `discount_invite`, ověří platnost (viz výše).

`resolveCheckoutDiscount(db, settings, providedCode, inviteToken, now)` se rozšíří
o parametr `inviteToken`:
- **Invite má přednost.** Je-li `inviteToken` platný, vrátí se invite sleva se
  `source: "invite"` a `code: "invite:<token>"` — bez ohledu na stav globální slevy.
- Když invite neplatí (nebo není), spadne se na stávající logiku globálního kódu
  / auto slevy beze změny.

`AppliedDiscount` dostane `source: "auto" | "code" | "invite"`. Pole `code` u invite
nese `"invite:<token>"`, aby se token propsal do `purchase.discountCode` a šel
dohledat při spotřebě.

#### 3. Checkout — `src/routes/checkout.tsx` + `src/views/checkout.tsx`

**GET `/checkout/individual` a `/checkout/organization`:**
- přečtou query `invite` (`c.req.query("invite")`),
- ověří token přes `resolveInviteDiscount`,
- je-li platný: `checkoutSelectView` zobrazí cenu rovnou po slevě + popisek
  („Osobní sleva 50 %") a místo viditelného promo inputu vloží **skryté pole**
  `<input type="hidden" name="inviteToken" value="TOKEN">`. Pole `promoCode` se
  skryje (invite a ruční kód se nemíchají).
- token neplatný/chybí → beze změny, stávající chování (globální sleva).

Pohledová vrstva `CheckoutSelect` dostane nové prop `inviteToken?: string`
(skryté pole) vedle stávajícího `discountPercent`/`discountLabel`/`showCodeInput`.

**POST `/checkout/individual` a `/checkout/organization`:**
- přečtou `inviteToken` z form data,
- předají ho do `resolveCheckoutDiscount(..., inviteToken)`,
- zbytek (Stripe/FIO startér, zápis `discountPercent`+`discountCode`) beze změny —
  protože invite jen vyplní `AppliedDiscount`, který už oba startéry umí.

Invite token se musí přenést přes platební bránu, aby šel po zaplacení spotřebovat:
- **Stripe:** přidat do `session.metadata.inviteToken` (vedle `discountPercent`/
  `discountCode`, které už tam jsou).
- **FIO:** token je už v `purchase.discountCode` jako `"invite:<token>"` — netřeba
  nic navíc.

#### 4. Spotřeba tokenu při aktivaci

Společná funkce `consumeInviteToken(db, token, purchaseId, now)` v `discount.ts`:
- atomicky `UPDATE discount_invite SET usedAt=?, usedByPurchaseId=? WHERE token=? AND usedAt IS NULL`,
- idempotentní (druhé volání nic neudělá).

Voláním ze dvou míst, vždy až když je purchase **aktivní**:
- **Stripe:** `src/queue.ts`, handler `checkout.session.completed`, po vložení
  aktivní purchase. Token vezme z `metadata.inviteToken`.
- **FIO:** `src/routes/checkout.tsx`, endpoint `/api/fio/verify/:vs`, po úspěšné
  `activateFioPurchaseIfPending`. Token vyparsuje z `purchase.discountCode`
  (prefix `invite:`).

#### 5. Generátor tokenů — `scripts/discount-invites/generate.ts`

Vstup: CSV s e-maily (jeden sloupec, příp. `email,jmeno`). Parametry: `percent`,
`expiresAt`, `batch`, `label`.

Protože ostrá D1 je dostupná jen z workeru / přes `wrangler d1`, generátor:
- vyrobí pro každý e-mail `token = nanoid()`,
- vygeneruje **SQL `INSERT` dávku** do souboru (`drizzle`-kompatibilní, ale
  spuštěná jednorázově přes `wrangler d1 execute --remote`), nebo zapíše přes
  malý interní admin endpoint chráněný admin auth,
- vypíše CSV `email,token,url` kde `url = https://kurzy.vibecoding.cz/checkout/individual?invite=TOKEN`.

> Rozhodnutí mezi „SQL dávka přes wrangler" vs. „interní admin endpoint" se
> dořeší v implementačním plánu; preferenčně wrangler `d1 execute --remote`,
> protože nevyžaduje nový veřejný povrch.

#### 6. Rozeslání e-mailů — Resend

Šablona e-mailu s osobním odkazem (oslovení, nabídka 50 %, datum expirace, tlačítko
na `url`). Rozeslání skriptem ve stylu `scripts/resend/` nad výstupním CSV
generátoru. E-maily se posílají z nasazeného prostředí / s `RESEND_API_KEY`
dodaným za běhu (lokální `.dev.vars` placeholder nestačí).

## Tok dat (happy path, Stripe)

```
e-mail s odkazem  ─►  GET /checkout/individual?invite=TOK
                         └─ resolveInviteDiscount → platný → cena 1000 Kč + hidden inviteToken
POST /checkout/individual (inviteToken=TOK)
   └─ resolveCheckoutDiscount → {percent:50, source:"invite", code:"invite:TOK"}
   └─ startStripeCheckout → session.metadata.inviteToken=TOK, discountPercent=50
Stripe zaplaceno ─► webhook ─► WEBHOOK_QUEUE ─► queue.ts checkout.session.completed
   └─ insert purchase (status=active, discountPercent=50, discountCode="invite:TOK")
   └─ consumeInviteToken(TOK, purchase.id)  →  usedAt vyplněno
```

FIO varianta je shodná, jen spotřeba proběhne v `/api/fio/verify/:vs` po napárování
platby.

## Ošetření chyb a hran

- **Expirovaný / již využitý token:** checkout se chová, jako by žádný invite nebyl
  (spadne na globální slevu nebo plnou cenu). Volitelně lze zobrazit nenápadnou
  hlášku „Tvůj slevový odkaz už není platný" — doladí plán.
- **Token v URL, ale člověk odejde a vrátí se bez parametru:** sleva se neaplikuje;
  musí použít odkaz znovu. (Token je v hidden poli jen pokud přišel v URL.)
- **Race / dvojí zaplacení:** `consumeInviteToken` má `WHERE usedAt IS NULL`, takže
  je idempotentní; token spotřebuje jen první aktivace.
- **Drift ceny:** beze změny — `amountPaid` se ukládá v době objednávky stejně jako
  u stávajících slev.
- **Neplatné CSV / duplicitní e-mail v dávce:** generátor přeskočí prázdné řádky a
  zaloguje duplicity; jeden e-mail = jeden token (duplicitní řádek se ignoruje).

## Testování

- **`discount.ts` unit testy:** `resolveInviteDiscount` (platný / expirovaný /
  využitý / neexistující), přednost invite nad globální slevou, `consumeInviteToken`
  idempotence.
- **Checkout integrační:** GET s platným `?invite=` zobrazí sníženou cenu a hidden
  pole; POST aplikuje slevu a propíše `discountCode="invite:..."`.
- **Spotřeba:** po simulované aktivaci (Stripe queue / FIO verify) je `usedAt`
  vyplněno a druhá aktivace nic nemění.
- **Generátor:** z malého CSV vyrobí očekávané tokeny/odkazy a SQL dávku.

## Mimo rozsah (YAGNI)

- Admin UI pro správu invite tokenů (stačí SQL/skript a reporting dotazem).
- Hromadná deaktivace/zneplatnění dávky (lze ručně `UPDATE ... SET expiresAt`).
- Vícenásobné použití jednoho tokenu (záměrně jednorázové).
- Napojení invite na renewal flow.

## Dotčené soubory

- `src/db/schema.ts` — nová tabulka `discount_invite`.
- `drizzle/migrations/NNNN_discount_invites.sql` — ruční migrace.
- `src/lib/discount.ts` — `resolveInviteDiscount`, `consumeInviteToken`, rozšíření
  `resolveCheckoutDiscount` + `AppliedDiscount.source`.
- `src/routes/checkout.tsx` — čtení `invite` (GET/POST), FIO spotřeba, Stripe metadata.
- `src/views/checkout.tsx` — hidden `inviteToken`, zobrazení invite slevy.
- `src/queue.ts` — spotřeba tokenu po Stripe aktivaci.
- `scripts/discount-invites/generate.ts` — generátor tokenů + odkazů.
- `scripts/resend/` — šablona a rozeslání e-mailů.
- testy k výše uvedenému.
