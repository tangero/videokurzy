import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { approveItem } from "../lib/cc-news/draft";
import type { Env } from "../types";

/**
 * Veřejné routy služby „Novinky v Claude Code", na které klikne ČLOVĚK z
 * e-mailu. NEjsou za `X-Internal-Secret` (to je service-to-service) — bezpečnost
 * nese podepsaný jednorázový HMAC token v query (viz lib/cc-news/approval.ts).
 *
 * `/internal/cc-news/approve?token=…` — schválí a publikuje článek. Idempotentní
 * vůči opakovanému kliknutí (nonce se po publikaci spotřebuje).
 */
export const ccNewsRoutes = new Hono<{ Bindings: Env }>();

ccNewsRoutes.get("/internal/cc-news/approve", async (c) => {
  const token = c.req.query("token");
  if (!token) return c.text("Chybí token.", 400);

  const db = drizzle(c.env.DB);
  const result = await approveItem(db, c.env, token, new Date());

  if (result.ok) {
    return c.html(
      `<!doctype html><meta charset="utf-8"><title>Publikováno</title>` +
        `<p>Článek byl schválen a publikován v sekci „Novinky v CC“. Rozeslání proběhne dle nastavení (v dry-run režimu se reálně neodesílá).</p>`
    );
  }

  const status =
    result.reason === "already-published" ? 409 :
    result.reason === "invalid-token" ? 401 : 404;
  const msg =
    result.reason === "already-published" ? "Tento odkaz už byl použit — článek je publikovaný." :
    result.reason === "invalid-token" ? "Neplatný nebo prošlý odkaz." :
    result.reason === "nonce-mismatch" ? "Odkaz je zneplatněný novějším konceptem." :
    "Článek nenalezen.";
  return c.html(`<!doctype html><meta charset="utf-8"><title>Schválení</title><p>${msg}</p>`, status);
});
