# Nasazení fio-proxy na rock8.cloud — krok za krokem

Tenhle návod tě provede nasazením FIO proxy na [rock8.cloud](https://rock8.cloud)
a jejím napojením na produkční worker `videokurzy`. Počítej s ~15 minutami.

> **Proč to děláme:** `fioapi.fio.cz` neumí ALPN a Cloudflare Workers `fetch()`
> s ním padá na chybu 525. Proxy běží v Node.js (kde TLS handshake projde) a FIO
> request přepošle. Viz [`README.md`](./README.md).

---

## Co budeš potřebovat předem

1. **Účet na rock8.cloud** propojený s GitHubem.
2. **Ostrý FIO API token** (read-only) — z FIO internetbankingu:
   Nastavení → API → token pro čtení. Stejný, jaký je dnes v CF jako `FIO_API_TOKEN`.
3. **Vygenerovaný `PROXY_SECRET`** — sdílené heslo mezi proxy a workerem. Vygeneruj:
   ```bash
   openssl rand -hex 32
   ```
   Zkopíruj si výsledek, budeš ho potřebovat dvakrát (na proxy i do CF).
4. **Branch `fix/payment-matching-fio-proxy` mergnutý do `main`** (nebo nasazuj
   přímo z té branche, pokud to rock8 umožní vybrat).

---

## Krok 1 — Připoj GitHub repo

1. Na rock8.cloud klikni na **New Service** (nebo „Deploy").
2. **Configure GitHub App** → vyber organizaci/účet `tangero` → zpřístupni
   repozitář **`videokurzy`** → **Install**.
3. Vyber repozitář **`videokurzy`**.

## Krok 2 — Nastav build root na podadresář `fio-proxy/`

Proxy **není v rootu repa**, ale v podadresáři `fio-proxy/`. Tohle je nejdůležitější
krok — bez něj rock8 zkusí buildit hlavní worker, ne proxy.

- Hledej pole **Root Directory** / **Working Directory** / **Subdirectory**
  (název se může lišit) a nastav ho na:
  ```
  fio-proxy
  ```
- Build je z **Dockerfile** (rock8 ho v tom podadresáři najde automaticky).

> **Pokud rock8 nepodporuje subdirectory** (v dokumentaci to není potvrzené):
> napiš jim na Discord/support, nebo použij záložní řešení v sekci
> [„Když nejde subdirectory"](#když-nejde-subdirectory) na konci.

## Krok 3 — Nastav veřejnou URL

V kroku **Configure Your Deployment** uvidíš pole **URL** — první část je tvoje
(můžeš editovat). Nastav třeba:
```
videokurzy-fio
```
Výsledná adresa bude např. `https://videokurzy-fio.rock8.cloud`. **Poznamenej si ji** —
půjde do CF jako `FIO_PROXY_URL`.

## Krok 4 — Nastav environment variables

V **Configuration → Environment Variables** přidej dva klíče:

| Key | Value |
|-----|-------|
| `FIO_API_TOKEN` | *(ostrý FIO token z internetbankingu)* |
| `PROXY_SECRET`  | *(hodnota z `openssl rand -hex 32` z přípravy)* |

Oboje se uloží jako **secret** (rock8 je injektuje do kontejneru, neukáže jako
plain text). **Save** → rock8 spustí redeploy.

> Port nemusíš řešit. Dockerfile má `EXPOSE 8080` a server čte `process.env.PORT`
> s fallbackem 8080 — když rock8 injektuje vlastní PORT, proxy se přizpůsobí.
> Server poslouchá na `0.0.0.0` (default `@hono/node-server`), jak rock8 vyžaduje.

## Krok 5 — Deploy a ověření

1. Klikni **Deploy**. Počkej, až build proběhne (status „running").
2. Ověř health endpoint (bez autentizace):
   ```bash
   curl https://videokurzy-fio.rock8.cloud/health
   # → {"ok":true}
   ```
3. Ověř, že proxy reálně načte FIO transakce (s tvým `PROXY_SECRET`):
   ```bash
   curl -H "Authorization: Bearer <PROXY_SECRET>" \
     "https://videokurzy-fio.rock8.cloud/transactions?dateFrom=2026-05-14&dateTo=2026-06-11"
   ```
   Měl bys dostat JSON s `accountStatement` (reálné FIO transakce). Pokud vidíš
   `401`, secret nesedí; `503 fio_token_missing` → chybí `FIO_API_TOKEN`.

---

## Krok 6 — Napoj worker (Cloudflare)

Teprve teď worker začne proxy používat. V Cloudflare dashboardu:

**Workers & Pages → `videokurzy` → Settings → Variables and Secrets** přidej:

| Proměnná | Typ | Hodnota |
|----------|-----|---------|
| `FIO_PROXY_URL` | plain text | `https://videokurzy-fio.rock8.cloud` |
| `FIO_PROXY_SECRET` | **secret** | *(stejná hodnota jako `PROXY_SECRET` na proxy)* |

> **Ne přes `wrangler secret put`** — to historicky chodí na jiný worker. Nastav
> ručně v dashboardu (viz `CLAUDE.md`).

Worker použije proxy automaticky, jakmile jsou nastavené **obě** proměnné
(`fioProxyFromEnv()` v `src/lib/fio.ts`). Pokud kód proxy ještě neumí (branch
nemergnutá), nasaď nejdřív `npm run deploy`.

## Krok 7 — Ověř z workeru

1. Přihlaš se do adminu jako admin.
2. Otevři `https://kurzy.vibecoding.cz/admin/api/fio/diagnose`.
   - Měl bys vidět `"mode": "proxy"` a v `tests` reálné FIO transakce (status 200).
   - Když vidíš `"mode": "direct"`, CF proměnné se nenačetly (zkontroluj překlepy
     a že worker byl po jejich nastavení redeploynutý).
3. V adminu spusť ručně **FIO scan** — měl by teď načíst platby a spárovat
   nezaplacené pending objednávky (díky cross-bank logice i ty, co dorazily na FIO
   přes Creditas objednávku).

---

## Když nejde subdirectory

Pokud rock8.cloud neumí nastavit `fio-proxy/` jako build root, máš dvě možnosti:

**A) Samostatné repo (nejčistší).** Zkopíruj obsah `fio-proxy/` do nového repa
`videokurzy-fio-proxy` a nasaď to z jeho rootu. Nevýhoda: údržba na dvou místech.

**B) Dockerfile v rootu.** Přidej do rootu repa tenký `Dockerfile`, který buildí
z podadresáře (`COPY fio-proxy/ .`). Nevýhoda: kolize s build configem hlavního
workeru — nedoporučuji, pokud rock8 umí vybrat Dockerfile path.

Doporučení: nejdřív zkus subdirectory (krok 2). Když nepůjde, jdi cestou A.

---

## Provoz a údržba

- **Rotace FIO tokenu:** změň `FIO_API_TOKEN` v env na rock8 → automatický redeploy.
  CF nemusíš sahat (token žije jen na proxy).
- **Rotace `PROXY_SECRET`:** změň na obou místech (rock8 `PROXY_SECRET` i CF
  `FIO_PROXY_SECRET`) — jinak worker dostane 401.
- **Náklady:** proxy se volá jen 1× denně z cronu (+ při ručním scanu / verifikaci
  platby v checkoutu). Stačí nejmenší kontejner.
- **Rollback:** smaž CF proměnné `FIO_PROXY_URL`/`FIO_PROXY_SECRET` → worker se
  vrátí k přímému volání FIO (a zase bude padat na 525, ale nic se nerozbije).
