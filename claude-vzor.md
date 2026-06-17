# CLAUDE.md

<!--
  POZNÁMKA PRO ČLOVĚKA, KTERÝ TENTO SOUBOR UPRAVUJE.  (Claude, tuto sekci v komentáři ignoruj.)

  Ber to jako odrazový můstek k vlastní úpravě. Projdi soubor řádek po řádku
  a smaž všechno, co pro tvůj projekt neplatí. Důvod je praktický: každý řádek,
  který tu necháš, se načítá do kontextu při každém sezení a soutěží o pozornost
  modelu. Čím víc pravidel, tím méně spolehlivě se každé jednotlivé dodržuje.
  Krátký a konkrétní soubor funguje líp než dlouhý a obecný. Cherny drží svůj
  kolem 100 řádků / ~2,5k tokenů.

  Těžiště hodnoty jsou sekce Příkazy / Architektura / Konvence / Pozor na. To jsou
  fakta o TVÉM projektu, která model jinak nezná, a kvůli nim ten soubor existuje.
  Behaviorální pravidla v sekci Pracovní dohoda jsou komodita - nech jen ta, která
  ti reálně řeší opakovanou chybu, ostatní vyhoď.

  Dvě věci, které sem NEPATŘÍ: instrukce "přečti si tento soubor" (načítá se sám)
  a změnový log (od toho je git).
-->

## Příkazy projektu

```
npm run dev                  # dev server: Tailwind watch + wrangler dev (http://localhost:8787)
npm test                     # testy (Vitest); npm run test:watch pro watch režim
npm run build                # build: build:css + wrangler deploy --dry-run
npm run typecheck            # TypeScript kontrola app i testů (tsc + tsconfig.test.json)
npm run deploy               # wrangler deploy na produkční Worker
npm run db:migrate[:prod]    # aplikuje SQL migrace lokálně / na produkční D1
```

- Správce balíčků: **npm**. Jiný nepoužívej.

## Architektura a stack

- **Runtime: Cloudflare Workers** (edge) — žádné Node-only API. Entry point je
  `src/index.tsx` s `{ fetch, scheduled, queue }`.
- **Hono + JSX SSR** jako web framework, **htmx** pro interaktivitu (žádný
  React/Vue), **Tailwind CSS v4** pro styly.
- **Data: Cloudflare D1 (SQLite) + Drizzle ORM.** Stav navíc v KV (rate-limit,
  cache) a Queues (Stripe webhooky). Schema v `src/db/` (`schema.ts`,
  `auth-schema.ts`, `identity-schema.ts`).
- **Externí integrace:** bunny.net Stream (video), Stripe + FIO Banka (platby),
  Fakturoid + ARES (fakturace), Resend (transakční e-maily + Automations),
  better-auth (magic-link, OIDC provider).
- **Kde co žije:** `src/lib/` doménová logika (access, bunny, fio, fakturoid,
  resend, …), `src/routes/` Hono routy, `src/views/` JSX komponenty,
  `src/middleware/` auth, `src/scheduled.ts` cron (denně 03:00 UTC),
  `src/queue.ts` consumer. Migrace v `drizzle/migrations/`, testy v `tests/`.
- **Záměrná rozhodnutí (nepřepisovat):** SSR + htmx místo SPA frameworku;
  edge runtime bez Node API; secrets jen v Cloudflare dashboardu, ne v repu.

## Konvence

- **Migrace piš ručně** jako `drizzle/migrations/NNNN_nazev.sql` a zároveň uprav
  `src/db/schema.ts`, ať sedí typy (`db:generate` je rozbité — viz Pozor na).
- **Chyby a logování:** edge runtime — používej `console.*` střídmě (vidíš je
  ve `wrangler tail`), doménové chyby vracej přes Hono response, ne tiše polykej.
- **Commity:** krátký prefix oblasti malými písmeny + česky (`watch:`, `docs:`,
  `auth:`). Větve `feat/…`, `fix/…`. Před commitem zelený typecheck i test.
- **UI/brand:** fonty Space Grotesk + IBM Plex Mono, primární barva indigo-600,
  B2B accent amber. Detaily v `.impeccable.md` — drž se ho u změn UI.

## Pozor na

- **`npm run db:generate` (drizzle-kit) je rozbité** kvůli kolizi meta snapshotů
  ve `drizzle/migrations/meta/` (0004/0005). Migrace proto piš ručně (viz výše).
- **Po nasazení migrace nezapomeň `npm run db:migrate:prod`** — bez toho chybí
  nové sloupce na produkční D1 a runtime spadne.
- **`.dev.vars` jsou placeholdery.** Cokoli volá reálné externí API (bunny,
  Resend, FIO, Stripe) musí běžet z nasazeného Workeru nebo s klíčem dodaným za
  běhu — lokální volání s placeholdery selže.
- **Secrets a vars nastavuj jen v Cloudflare dashboardu** (Workers & Pages →
  videokurzy → Settings), **ne** přes `wrangler secret put` (chodilo na jiný worker).
- **Typecheck nevidí runtime JS uvnitř JSX šablon** (`dangerouslySetInnerHTML`,
  inline `<script>`) — po netriviální editaci ověř greppem, že kód je v souboru.
- Další provozní poznámky v `docs/gotchas.md`.

## Pracovní dohoda

**Než začneš.** U netriviálního úkolu (3+ kroků nebo architektonické rozhodnutí) nejdřív napiš stručný plán a kritéria úspěchu, pak počkej na souhlas.
Vyslov své předpoklady nahlas; při více možných výkladech zadání je ukaž všechny a nerozhoduj potichu sám. U triviální opravy (překlep, zřejmý
jednořádek) tohle přeskoč a použij úsudek.

**Jednoduchost a minimální zásah.** Zvol nejjednodušší řešení, které splní požadavek. Vynech spekulativní funkce, abstrakce i konfigurovatelnost navíc.
Měň jen to, co s požadavkem přímo souvisí, a drž se stávajícího stylu. Okolní nesouvisející kód nech být.

**Kořenová příčina.** Najdi a oprav skutečnou příčinu. Dočasné záplaty kolem symptomu vynech. Pokud oprava působí hacky, udělej ji pořádně - tahle
elegance platí pro tvou změnu, okolní projekt do toho netahej.

**Ověř, než řekneš hotovo.** Úkol je hotový teprve tehdy, když prokážeš, že funguje: spusť testy, zkontroluj logy tam, kde to dává smysl, a kde je to
relevantní, porovnej chování proti hlavní větvi. Měřítko: prošlo by to code review u zkušeného kolegy?

**Opravuj autonomně.** U bug reportu nebo padajícího CI nečekej na vedení za ručičku. Z logu, chyby nebo padajícího testu najdi příčinu a rovnou ji
vyřeš.

**Souhlas si vyžádej u:** mazání testů; destruktivních operací (drop, force push, mazání dat); velkého refaktoru napříč mnoha soubory, který nebyl
zadaný.

**Učení.** Po každé korekci od uživatele zapiš vzorec chyby do `tasks/lessons.md` a zformuluj si pravidlo, které ji příště zarazí.

<!--
  VOLITELNÉ MODULY - ve výchozím stavu vypnuté, protože přidávají režii.
  Pokud je tvůj workflow opravdu využije, odkomentuj. Jinak nech být.

  ## Orchestrace
  - Rešerše, průzkum kódu a paralelní analýzu odsouvej do subagentů, ať hlavní
    kontext zůstane čistý. Jeden subagent = jeden úkol.

  ## Sledování úkolů
  - Plán zapiš do `tasks/todo.md` jako odškrtávací seznam, průběžně odškrtávej
    a na konci doplň krátké shrnutí výsledku.

  ## Živá dokumentace v docs/
  - docs/PRD-v2.md = produktové zadání; docs/auth-master.md = architektura auth;
    docs/fakturoid-integration.md = fakturace; docs/superpowers/ = specy a plány.
  - Než začneš měnit nějakou oblast, přečti k ní příslušný dokument v `docs/`.
  - Po změně, která mění chování systému, ten dokument rovnou aktualizuj.
-->
