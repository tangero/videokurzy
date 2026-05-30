# kurzy.vibecoding.cz

> **Vzorový projekt s dvojím účelem.** Tohle je živá platforma, na které běží
> [kurzy.vibecoding.cz](https://kurzy.vibecoding.cz) — distribuce placených
> videokurzů vibe codingu. Zároveň slouží jako **referenční / učební projekt pro
> práci s Claude Code**: ukazuje reálnou produkční kódovou základnu (platby,
> auth, fakturace, video, e-mailové automatizace) na které se dá demonstrovat
> AI-asistovaný vývoj — od zadání přes plán po nasazení.
>
> Není to umělé demo. Je to skutečný byznys, který zároveň učí, jak ho stavět.

---

## Co projekt umí

- **Distribuce videokurzů** — přehrávání přes [bunny.net](https://bunny.net)
  Stream (podepsané embed URL), sledování postupu, přepisy videí.
- **Platby** — Stripe (karta) i FIO Banka (převod + QR), jednorázově i B2B
  licence na celou doménu.
- **Fakturace** — IČO → ARES → zálohový doklad → faktura ve Fakturoidu,
  bez ruční práce.
- **Auth** — [better-auth](https://better-auth.com) s magic-link přihlášením
  (bez hesel), OIDC provider pro budoucí cross-domain SSO.
- **E-mailové automatizace** — onboarding a re-engagement sekvence přes Resend
  Automations (eventy emitované z aplikace).
- **Admin** — správa kurzů, uživatelů, grantů a statistik.

## Tech stack

| Vrstva | Technologie |
|---|---|
| Runtime | [Cloudflare Workers](https://workers.cloudflare.com) (edge, žádné Node-only API) |
| Web framework | [Hono](https://hono.dev) + JSX SSR |
| Interaktivita | [htmx](https://htmx.org) (žádný React/Vue) |
| Styly | [Tailwind CSS v4](https://tailwindcss.com) (utility-first) |
| Databáze | Cloudflare D1 (SQLite) + [Drizzle ORM](https://orm.drizzle.team) |
| Úložiště stavu | Cloudflare KV (rate-limit, cache), Queues (webhooky) |
| Video | bunny.net Stream |
| Platby | Stripe, FIO Banka API |
| Fakturace | Fakturoid API + ARES |
| E-mail | Resend (transakční + Automations) |
| Testy | Vitest + `@cloudflare/vitest-pool-workers` |

## Struktura projektu

```
src/
├── index.tsx          # entry point Workeru: { fetch, scheduled, queue }
├── types.ts           # Env (bindingy + secrets) a Variables
├── scheduled.ts       # cron handler (denně 03:00 UTC): FIO scan, reminders,
│                      #   expirace, renewal, sync bunny statistik
├── queue.ts           # consumer Cloudflare Queue (Stripe webhooky)
├── config/            # konstanty: ceny, admini, freemail domény
├── db/                # Drizzle schema (schema.ts, auth-schema.ts, identity-schema.ts)
├── middleware/        # auth, internal-auth, partner-auth
├── lib/               # doménová logika (access, bunny, fio, fakturoid, resend,
│                      #   discount, proforma, transcribe, …)
├── routes/            # Hono routy: landing, watch, checkout, auth, stripe,
│                      #   admin, profile, progress, internal, partner-api, dev
└── views/             # JSX komponenty (layout, landing, checkout, watch, admin-*)

drizzle/migrations/    # SQL migrace (aplikují se přes wrangler d1 migrations)
tests/                 # Vitest (lib/, routes/, middleware/, views/)
scripts/               # seed.sql + resend/ (setup e-mailových automatizací)
docs/                  # PRD, specy, integrace; docs/superpowers/ = plány a specy
public/                # statické assety (styles.css generuje Tailwind)
```

## Rozchození lokálně

### Předpoklady
- Node.js 20+
- účet Cloudflare (Wrangler CLI je v devDependencies)

### 1. Instalace
```bash
npm install
```

### 2. Konfigurace prostředí
Zkopíruj `.dev.vars.example` do `.dev.vars` a vyplň hodnoty:
```bash
cp .dev.vars.example .dev.vars
```

Potřebné proměnné (viz `.dev.vars.example`):

| Proměnná | K čemu |
|---|---|
| `BUNNY_API_KEY`, `BUNNY_LIBRARY_ID`, `BUNNY_TOKEN_KEY` | přehrávání a statistiky videí |
| `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` | auth (secret: `openssl rand -base64 32`) |
| `RESEND_API_KEY` | odesílání e-mailů |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | platby kartou |
| `FIO_API_TOKEN` | párování plateb převodem (volitelné lokálně) |

> ⚠️ `.dev.vars` typicky obsahuje **placeholder** hodnoty pro lokální běh. Ostré
> produkční secrets žijí v Cloudflare dashboardu (viz Nasazení), ne v repu.
> Cokoli, co volá reálné externí API, je proto nutné testovat proti nasazenému
> Workeru nebo s klíčem dodaným za běhu.

### 3. Databáze
```bash
npm run db:migrate     # aplikuje migrace na lokální D1
npm run db:seed        # naplní ukázková data (volitelné)
```

### 4. Vývojový server
```bash
npm run dev            # Tailwind watch + wrangler dev (http://localhost:8787)
```

## Užitečné příkazy

| Příkaz | Co dělá |
|---|---|
| `npm run dev` | lokální vývoj (CSS watch + wrangler dev) |
| `npm run typecheck` | TypeScript kontrola (app + testy) |
| `npm test` | spustí Vitest |
| `npm run build:css` | vygeneruje `public/styles.css` |
| `npm run db:generate` | vygeneruje Drizzle migraci ze schématu¹ |
| `npm run db:migrate` / `:prod` | aplikuje migrace lokálně / na produkci |
| `npm run db:seed` / `:prod` | naplní seed data |
| `npm run deploy` | `wrangler deploy` na produkční Worker |

¹ Viz „Známá úskalí" — `db:generate` aktuálně nefunguje, migrace se píší ručně.

## Nasazení

Produkce běží na Cloudflare Workeru **`videokurzy`** (default, bez `--env`),
napojeném na `kurzy.vibecoding.cz`.

```bash
npm run deploy
# pokud commit přidal migraci v drizzle/migrations/, hned po deployi:
npm run db:migrate:prod
```

- **Secrets a vars** (např. `COOKIE_DOMAIN`, `BUNNY_PULL_ZONE`) se nastavují
  v Cloudflare dashboardu (Workers & Pages → videokurzy → Settings → Variables
  and Secrets), **ne** přes `wrangler secret put`.
- Cron a Queue bindingy jsou v `wrangler.toml`.

## Workflow (povinné před commitem)

```bash
npm run typecheck && npm test
```

Bez zelených testů se necommituje a nepushuje. Plný workflow je popsaný
v [`CLAUDE.md`](./CLAUDE.md) (instrukce pro Claude Code i lidské přispěvatele).

## Známá úskalí

- **`npm run db:generate` (drizzle-kit) je rozbité** kvůli kolizi meta snapshotů
  ve `drizzle/migrations/meta/`. Nové migrace se proto píší **ručně** jako
  `drizzle/migrations/NNNN_nazev.sql` — `wrangler d1 migrations apply` čte jen
  `.sql` soubory.
- Další provozní poznámky v [`docs/gotchas.md`](./docs/gotchas.md).

## Dokumentace

- [`CLAUDE.md`](./CLAUDE.md) — pracovní instrukce a konvence
- [`docs/PRD-v2.md`](./docs/PRD-v2.md) — produktové zadání
- [`docs/auth-master.md`](./docs/auth-master.md) — architektura auth
- [`docs/fakturoid-integration.md`](./docs/fakturoid-integration.md) — fakturace
- [`docs/superpowers/`](./docs/superpowers/) — specy a implementační plány

---

Projekt Patricka Zandla a Andrey Maloveczké · [vibecoding.cz](https://vibecoding.cz)
