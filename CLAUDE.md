# Claude pracovní instrukce pro videokurzy

## Před každým commitem
Vždy spusť:

```bash
npm run typecheck && npm test
```

Pokud cokoli selže, oprav před commitem. Nepush bez zelených testů.

## Po nasazení migrací
Pokud commit obsahuje nový soubor v `drizzle/migrations/`, **po `npm run deploy`** spusť také:

```bash
npm run db:migrate:prod
```

Bez toho budou nové sloupce/tabulky chybět na produkční D1, runtime spadne.

## Deploy infrastructure
- Produkce běží na Cloudflare worker **`videokurzy`** (default, bez `--env`), bound na `kurzy.vibecoding.cz`.
- Secrets a non-sensitive vars (např. `COOKIE_DOMAIN`, `BUNNY_PULL_ZONE`) se nastavují v Cloudflare dashboardu (Workers & Pages → videokurzy → Settings → Variables and Secrets). **Ne** přes `wrangler secret put` — to historicky chodilo na jiný worker.
- `npm run deploy` = `wrangler deploy` (bez `--env`). Nesahá se na to.
