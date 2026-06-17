# Claude pracovní instrukce pro videokurzy

Operační manuál pro práci na tomhle projektu. Architektura, stack a setup jsou
v [`README.md`](./README.md); design konvence v [`.impeccable.md`](./.impeccable.md).
Tady jsou jen pravidla a pasti specifické pro tento repozitář.

## Workflow před commitem
Vždy spusť:

```bash
npm run typecheck && npm test
```

Pokud cokoli selže, oprav před commitem. Necommituj a nepushuj bez zelených testů.
Commit/push/deploy dělej jen na výslovný pokyn uživatele, ne preventivně.

## Ověřuj obsah, ne jen exit kód
**Zelený typecheck/test neznamená, že tvoje změna je v souboru.** Edit může tiše
selhat (nesedící `old_string`) a `tsc` neuvidí runtime JS uvnitř JSX šablon
(`dangerouslySetInnerHTML`, inline `<script>`). Po každé netriviální editaci
ověř greppem, že kód tam reálně je (`grep -c "marker" soubor`) — teprve pak commituj.
Commit message musí odpovídat skutečnému stavu.

## Migrace — piš ručně
`npm run db:generate` (drizzle-kit) je **rozbité** kvůli kolizi meta snapshotů
ve `drizzle/migrations/meta/` (0004/0005). Nové migrace proto piš ručně jako
`drizzle/migrations/NNNN_nazev.sql` — `wrangler d1 migrations apply` čte jen
`.sql`, drizzle meta ignoruje. Změň zároveň `src/db/schema.ts`, ať sedí typy.

## Po nasazení migrací
Pokud commit obsahuje nový soubor v `drizzle/migrations/`, **po `npm run deploy`**
spusť také:

```bash
npm run db:migrate:prod
```

Bez toho budou nové sloupce/tabulky chybět na produkční D1 a runtime spadne.

## FIO API z Workers padá na 525 → proxy
`fioapi.fio.cz` běží na TLSv1.3 a **neumí ALPN**. Cloudflare Workers `fetch()`
s ním nedokončí TLS handshake → chyba **525**. Z běžného Node.js (mimo Workers)
spojení projde. Proto FIO voláme přes relay **`fio-proxy/`** (Node+Hono kontejner
na rock8.cloud): worker volá proxy (moderní TLS), ta přepošle na FIO a vrátí JSON
1:1. FIO token žije jen na proxy; worker se autentizuje `FIO_PROXY_SECRET`.

- Aktivace: nastav v CF dashboardu `FIO_PROXY_URL` + `FIO_PROXY_SECRET` (obě nutné,
  viz `fioProxyFromEnv()` v `src/lib/fio.ts`). Bez nich worker volá FIO přímo → 525.
- Deploy proxy: viz `fio-proxy/README.md`. Ověření: `/admin/api/fio/diagnose`
  (vrátí `"mode": "proxy"`).
- Creditas tímhle netrpí (modernější API), volá se napřímo.

## Párování plateb je cross-bank
`scanBankPayments` v `src/scheduled.ts` paruje každou pending převodovou objednávku
proti **oběma** bankám (FIO i Creditas), ne jen proti té z `paymentMethod`. Lidé
totiž reálně platí, kam mají uložený účet (Creditas objednávka zaplacená na starý
FIO účet apod.). Transakce se zapíše do sloupce podle banky, kde se našla.
`scanFioPayments` je zpětně kompatibilní wrapper delegující sem.

## Ruční potvrzení platby
Platba, kterou automat nezachytil (typicky FIO 525 nebo cross-bank), se potvrdí
v adminu tlačítkem „Potvrdit platbu" u pending objednávky → `kind='manual'`
(reálné peníze, počítá se do revenue; **ne** `comp`, to je grant zdarma).
`manuallyConfirmPayment()` v `src/lib/admin-users.ts`.

## Secrets a externí API
- `.dev.vars` obsahuje **placeholder** hodnoty (`BUNNY_LIBRARY_ID="smoke_test"`,
  krátké klíče). Ostré secrets žijí jen v Cloudflare dashboardu.
- Cokoli volá reálné externí API (bunny statistiky, Resend CLI/automations)
  **musí běžet z nasazeného workeru** nebo s klíčem dodaným za běhu
  (`RESEND_API_KEY=re_... bash script.sh`). Lokální volání s `.dev.vars` selže.
- Resend automatizace se spravují přes `resend` CLI a skripty v `scripts/resend/`
  (event schémata používají **camelCase** `eventName`, ne `event_name`).

## Deploy infrastructure
- Produkce běží na Cloudflare worker **`videokurzy`** (default, bez `--env`),
  bound na `kurzy.vibecoding.cz`.
- Secrets a non-sensitive vars (např. `COOKIE_DOMAIN`, `BUNNY_PULL_ZONE`) se
  nastavují v Cloudflare dashboardu (Workers & Pages → videokurzy → Settings →
  Variables and Secrets). **Ne** přes `wrangler secret put` — to historicky
  chodilo na jiný worker.
- `npm run deploy` = `wrangler deploy` (bez `--env`). Nesahá se na to.

## Cloudflare Queues
- Webhooky jedou přes frontu **`videokurzy-webhooks`** (producer `WEBHOOK_QUEUE`).
  Po vyčerpání retry padají do **`videokurzy-webhooks-dlq`** (dead-letter),
  kterou obsluhuje `handleDlq` v `src/queue.ts` (alert adminovi, žádný retry).
- Obě fronty musí existovat **před deployem**, jinak `wrangler deploy` selže na
  referenci neexistující fronty. Vytvoření:
  `wrangler queues create videokurzy-webhooks-dlq`.
- Rozcestník konzumentů je v `src/index.tsx` (`queue:` export) — rozlišuje podle
  `batch.queue` (sufix `-dlq` → `handleDlq`, jinak `handleQueue`).
