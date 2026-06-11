// FIO proxy — relay mezi Cloudflare Workerem a FIO Bank API.
//
// PROČ EXISTUJE: fioapi.fio.cz běží na TLSv1.3 a NEUMÍ ALPN negotiation.
// Cloudflare Workers fetch() s takovým peerem nedokončí TLS handshake a vrací
// chybu 525 (SSL handshake failed). Node.js (zde, v Dockeru na rock8.cloud)
// stejné spojení naváže bez problému. Worker tedy volá tuhle proxy (moderní
// TLS, ALPN OK) a ta přepošle request na FIO.
//
// BEZPEČNOST: FIO token žije VÝHRADNĚ zde (env FIO_API_TOKEN na rock8.cloud).
// Worker ho nezná — autentizuje se sdíleným secretem (env PROXY_SECRET) přes
// hlavičku Authorization: Bearer <secret>. Bez správného secretu proxy odmítne.

import { serve } from "@hono/node-server";
import { Hono } from "hono";

const app = new Hono();

const FIO_API_TOKEN = process.env.FIO_API_TOKEN ?? "";
const PROXY_SECRET = process.env.PROXY_SECRET ?? "";
const PORT = parseInt(process.env.PORT ?? "8080", 10);

if (!FIO_API_TOKEN) console.warn("[fio-proxy] VAROVÁNÍ: FIO_API_TOKEN není nastaven.");
if (!PROXY_SECRET) console.warn("[fio-proxy] VAROVÁNÍ: PROXY_SECRET není nastaven — proxy je otevřená!");

/** Konstantní porovnání secretů — bez early-return na délce (timing). */
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Ověří Authorization: Bearer <PROXY_SECRET>. */
app.use("/transactions", async (c, next) => {
  const auth = c.req.header("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!PROXY_SECRET || !safeEqual(token, PROXY_SECRET)) {
    return c.json({ error: "unauthorized" }, 401);
  }
  await next();
});

app.get("/health", (c) => c.json({ ok: true }));

/**
 * GET /transactions?dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD
 * Přepošle na FIO periods endpoint a vrátí jeho JSON 1:1 (i status).
 */
app.get("/transactions", async (c) => {
  const dateFrom = c.req.query("dateFrom") ?? "";
  const dateTo = c.req.query("dateTo") ?? "";
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRe.test(dateFrom) || !dateRe.test(dateTo)) {
    return c.json({ error: "invalid_date", detail: "dateFrom/dateTo musí být YYYY-MM-DD" }, 400);
  }
  if (!FIO_API_TOKEN) {
    return c.json({ error: "fio_token_missing" }, 503);
  }

  const url = `https://fioapi.fio.cz/v1/rest/periods/${FIO_API_TOKEN}/${dateFrom}/${dateTo}/transactions.json`;

  let fioRes;
  try {
    fioRes = await fetch(url);
  } catch (err) {
    return c.json({ error: "fio_unreachable", detail: String(err?.message ?? err) }, 502);
  }

  const body = await fioRes.text();
  // Transparentní relay: vrať FIO status + tělo. Worker si chyby zparsuje sám
  // stejně jako dřív (rate_limit 409, 500 s detailem v těle, …).
  return new Response(body, {
    status: fioRes.status,
    headers: { "content-type": fioRes.headers.get("content-type") ?? "application/json" },
  });
});

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`[fio-proxy] naslouchá na portu ${info.port}`);
});
