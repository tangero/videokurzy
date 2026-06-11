# FIO proxy

Malý relay mezi Cloudflare Workerem (`videokurzy`) a FIO Bank API.

## Proč existuje

`fioapi.fio.cz` běží na TLSv1.3 a **neumí ALPN negotiation**. Cloudflare Workers
`fetch()` s takovým peerem nedokončí TLS handshake a vrací chybu **525 (SSL
handshake failed)**. Z běžného Node.js prostředí (tahle proxy v Dockeru) se
spojení naváže bez problému.

Worker tedy volá tuhle proxy (moderní TLS, ALPN OK → žádné 525), proxy uvnitř
přepošle request na FIO a vrátí JSON 1:1.

```
CF Worker (videokurzy)  ──HTTPS──>  fio-proxy (rock8.cloud)  ──HTTPS──>  fioapi.fio.cz
```

## Endpointy

- `GET /health` → `{ ok: true }` (bez autentizace)
- `GET /transactions?dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD`
  - vyžaduje `Authorization: Bearer <PROXY_SECRET>`
  - relayuje FIO `periods` endpoint, vrací FIO status + tělo beze změny

## Konfigurace (env na rock8.cloud)

| proměnná | popis |
|----------|-------|
| `FIO_API_TOKEN` | ostrý FIO API token (read-only). **Žije jen tady, ne ve workeru.** |
| `PROXY_SECRET`  | sdílený secret; worker ho posílá v `Authorization` hlavičce. |
| `PORT`          | port (default 8080; rock8 ho injektuje sám). |

`PROXY_SECRET` vygeneruj např. `openssl rand -hex 32`.

## Deploy na rock8.cloud

1. Push tohoto repa na GitHub (proxy je v podadresáři `fio-proxy/`).
2. Na rock8.cloud → nový container service → připoj GitHub repo, root nastav na
   `fio-proxy/` (buildí se z `Dockerfile`).
3. Nastav env `FIO_API_TOKEN` a `PROXY_SECRET`.
4. Deploy → dostaneš veřejnou URL, např. `https://fio-proxy-xyz.rock8.cloud`.
5. Ověř: `curl https://<url>/health` → `{"ok":true}`.

## Napojení workeru

V Cloudflare dashboardu (Workers & Pages → **videokurzy** → Settings →
Variables and Secrets) nastav:

- `FIO_PROXY_URL` = veřejná URL proxy (např. `https://fio-proxy-xyz.rock8.cloud`)
- `FIO_PROXY_SECRET` = stejná hodnota jako `PROXY_SECRET` na proxy (jako **secret**)

Worker použije proxy automaticky, jakmile jsou nastavené **obě** proměnné
(viz `fioProxyFromEnv()` v `src/lib/fio.ts`). Bez nich volá FIO přímo (a padá na
525 z Workers). Ověření: admin → tlačítko FIO scan, nebo `GET /admin/api/fio/diagnose`
(vrátí `"mode": "proxy"`).

## Lokální test

```bash
cd fio-proxy
npm install
PROXY_SECRET=test FIO_API_TOKEN=<ostrý-token> node server.js
curl -H "Authorization: Bearer test" \
  "http://localhost:8080/transactions?dateFrom=2026-05-14&dateTo=2026-06-11"
```
