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

## Bunny — více video library
Lekce má `bunnyLibraryId` (NULL = hlavní library z `BUNNY_LIBRARY_ID` /
`BUNNY_API_KEY` / `BUNNY_TOKEN_KEY` / `BUNNY_PULL_ZONE`). Další library se
konfigurují JSON secretem `BUNNY_EXTRA_LIBRARIES`
(`{"655172": {"apiKey","tokenKey","pullZone","pullZoneToken?","name?"}}`).
Každá library má **vlastní** Stream API klíč i Token Authentication Key —
account klíč Stream API nepřijímá a token key přes API nejde získat. Library
pro lekci vždy přes `resolveBunnyLibrary()` v `src/lib/bunny-library.ts`,
nikdy napřímo `env.BUNNY_*`.

## Novinky v CC — zdroj od Week 38/2026
Anthropic od Week 37 nevydává oficiální týdenní přehledy (whats-new RSS stojí).
Článek vzniká ze **changelogu** (CHANGELOG.md, data vydání ze stránky changelogu
v dokumentaci; GitHub releases ne — chybí v nich verze) a z **rozdílů v dokumentaci**
(týdenní snímky v KV `cc-docs:*`). Kód: `src/lib/cc-news/{changelog-source,classify,
docs-snapshot,weekly,changelog-week}.ts`, tabulka `cc_change_item` (témata, význam,
návaznosti; stránky `/novinky-cc/temata`).
- Denní cron synchronizuje changelog a snímek dokumentace; v pondělí zmrazí týden
  a založí vydání `/changelog/<rok>-w<NN>` za minulý týden → fronta → schvalovací e-mail.
- Zpětné týdny ručně: `/admin/api/cc-news/changelog-week?week=2026-w39`, **postupně**
  (rozsah verzí navazuje na konec posledního vydání).
- **Automatické vydávání (od 18. 10. 2026): lidské schválení před publikací se NEvyžaduje**
  (rozhodnutí Patricka, nevracet jako „chybu“). Přepínač `cc_news_autopublish` v `/admin/settings`
  (výchozí zapnuto): český článek se po napsání sám publikuje (`autoPublishDraft`), přijde e-mail
  „Vydáno“ s odkazy na úpravy a nálezy kontrol; anglické přehledy se po úspěšném buildu webu samy
  sloučí (fronta `cc-news.en-merge`, `mergeSitePullRequest`). Úpravy zpětně: český text admin →
  Newsletter, anglický Keystatic na vibecoding.cz/keystatic. Newsletter předplatitelům zůstává ruční.
- Styl článku = skill „Technický článek" (`WRITER_SYSTEM` v `weekly.ts`). Názor
  v 1. osobě ano, **vymyšlené osobní zkušenosti autora ne**.
- Nová stránka dokumentace / velký nový oddíl = povinně hlavní novinka.
- Oficiální přehled k týdnu, který už má vydání ze changelogu, se nezakládá
  (stejný slug `<rok>-w<NN>-novinky`) — viz dedupe v `detect.ts`.
- Lokální experimenty a porovnání: `scripts/cc-news-changelog/`, `docs/cc-news-changelog/`.
- Anglická verze (vibecoding.cz/en): po schválení české verze fronta `cc-news.en-weekly`
  napíše článek anglicky z uloženého výběru (`cc-news:selection:<itemId>`, ne překladem)
  a otevře PR do `tangero/vibecoding-site` (`english.ts`, secret `VIBECODING_SITE_GITHUB_TOKEN`),
  který se při automatickém vydávání sám sloučí po úspěšném buildu.
  Kontrakt souboru je v `docs/english-section.md` webu. Nanečisto:
  `GET /admin/api/cc-news/english?itemId=…`. Více nástrojů: `docs/cc-news-changelog/vice-zdroju.md`.
- Další sledované nástroje (Grok Build, Codex CLI, Antigravity CLI, Muse Code): `cc_change_item.tool`
  (dotazy článků a stránek témat Claude Code VŽDY filtrují `tool = 'claude-code'`; mapa ekosystému má vlastní dotazy), sběr v `src/lib/tools/`,
  denní cron, týdenní výběr do KV `tools:week:<tool>:<týden>`, admin `/admin/tools/grok-build`.
  Týdenní výběr se uloží i jako `cc-news:selection:<tool>-<rok>-w<NN>`; z něj tlačítko v adminu
  píše anglický přehled (PR do webu, nástroj musí být ve `WEEKLY_TOOLS` webu). Bez českého článku.
  Při automatickém vydávání se zařadí sám po sestavení týdne (fronta `tools.week`), jen u nástrojů
  s `englishWeekly` v `src/lib/tools/registry.ts` (od 18. 10. 2026 všechny čtyři, Muse Code od 19. 10.; nový nástroj nejdřív do WEEKLY_TOOLS webu).
  Codex a Antigravity se sbírají z GitHub releases (`src/lib/tools/github-releases.ts`), Muse Code
  z `changelog.md` dokumentace s daty z npm a GitHubu (`src/lib/tools/muse-code.ts`); jeho dokumentace
  nemá v sitemap `lastmod`, snímek ji proto stahuje denně a změnu pozná podle hashe obsahu.
- **Mapa ekosystému `/novinky-cc/ekosystem`** (od 24. 10. 2026, rozhodnutí Patricka, zkušebně): všechny nástroje
  vedle sebe, ne už „jen srovnání na stránkách témat“. Karta týdne pro každý nástroj (Claude Code = poslední český
  článek, ostatní = krátký český souhrn 3–5 vět), mapa témat × nástroje za 4 týdny (`ToolFocus.shares`) a dohánění.
  Souhrn píše fronta `tools.week-cs` (`src/lib/tools/week-cs.ts`) z ověřeného výběru týdne po `tools.week`,
  do KV `tools:week-cs:<tool>:<rok>-wNN`; nový výběr ho zneplatní. Celý český článek o ostatních nástrojích se nepíše.
  Zpětně: `POST /admin/api/tools/week-cs?weeks=4` (všechny nástroje), stav týdne `GET …?tool=codex&week=2026-w42`.
  Pruh „Ostatní nástroje tento týden“ je i na `/novinky-cc`. Data a loader: `src/lib/cc-news/ecosystem.ts`.
  Počty jsou **položky changelogu**, ne „změny“: mezi nástroji se nedají srovnávat (Muse Code píše kolem 100
  položek na vydání), proto stránka ukazuje i počet vydání a průměr na vydání. Changelog Muse Code nemá data;
  verze bez data z npm/GitHubu mají datum jen jako horní mez. Synchronizace to zapisuje do KV
  `tools:dates-approx:<tool>` (`ToolDates`) a karta nástroje to čtenáři vysvětlí. Data v `cc_change_item` neměnit.
- Stránka tématu `/novinky-cc/temata/<téma>` (`topic-history.ts`, `views/cc-topic.tsx`): týdenní osa od vzniku
  tématu, detail týdne (`?tyden=2026-w41`), detail pojmu napříč nástroji (`?pojem=PreToolUse`), srovnání
  s ostatními nástroji podle podílu na jejich změnách, slovník identifikátorů z changelogu a milníky.
  Cache v KV na hodinu. Box „Nejnovější na vibecoding.cz“ bere jen rubriku hlavního nástroje z RSS feedu
  webu (`site-articles.ts`); odkazy na tahák vibecoding.cz mají přednost před anglickou dokumentací.

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
