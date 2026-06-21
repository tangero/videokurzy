import { Hono } from "hono";
import type { Context } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { desc, eq } from "drizzle-orm";
import { approveItem, draftKvKey } from "../lib/cc-news/draft";
import { ccNewsItem } from "../db/schema";
import { hasAccess } from "../lib/access";
import { renderMarkdown, escapeHtml } from "../lib/markdown";
import type { Env, Variables } from "../types";

/** Slug z articlePath `src/content/novinky-cc/<slug>.md`. */
export function slugFromPath(articlePath: string | null): string | null {
  if (!articlePath) return null;
  return articlePath.replace(/^.*\//, "").replace(/\.md$/i, "") || null;
}

/**
 * Veřejné routy služby „Novinky v Claude Code", na které klikne ČLOVĚK z
 * e-mailu. NEjsou za `X-Internal-Secret` (to je service-to-service) — bezpečnost
 * nese podepsaný jednorázový HMAC token v query (viz lib/cc-news/approval.ts).
 *
 * `/internal/cc-news/approve?token=…` — schválí a publikuje článek. Idempotentní
 * vůči opakovanému kliknutí (nonce se po publikaci spotřebuje).
 */
export const ccNewsRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// Pomocná: vyžaduje přihlášeného uživatele s přístupem (R5). Nepřihlášený →
// login; přihlášený bez přístupu → ceník. Admin má přístup (bypass v hasAccess).
type Ctx = Context<{ Bindings: Env; Variables: Variables }>;

async function gateOrRedirect(c: Ctx): Promise<Response | null> {
  const user = c.get("user");
  if (!user) return c.redirect("/login");
  const db = drizzle(c.env.DB);
  const ok = await hasAccess(user, db, c.env.KV);
  if (!ok) return c.redirect("/#cenik");
  return null;
}

const pageShell = (title: string, body: string): string =>
  `<!doctype html><html lang="cs"><head><meta charset="utf-8">` +
  `<meta name="robots" content="noindex"><title>${escapeHtml(title)}</title></head>` +
  `<body><main>${body}</main></body></html>`;

// Seznam publikovaných článků „Novinky v CC" — gated.
ccNewsRoutes.get("/novinky-cc", async (c) => {
  const redirect = await gateOrRedirect(c);
  if (redirect) return redirect;

  const db = drizzle(c.env.DB);
  const rows = await db
    .select()
    .from(ccNewsItem)
    .where(eq(ccNewsItem.status, "published"))
    .orderBy(desc(ccNewsItem.publishedAt));

  const items = rows
    .map((r) => {
      const slug = slugFromPath(r.articlePath);
      const label = `${escapeHtml(r.weekLabel ?? "Novinky")}${r.versionRange ? ` (${escapeHtml(r.versionRange)})` : ""}`;
      return slug ? `<li><a href="/novinky-cc/${encodeURIComponent(slug)}">${label}</a></li>` : "";
    })
    .filter(Boolean)
    .join("");

  const body = `<h1>Novinky v Claude Code</h1>` +
    (items ? `<ul>${items}</ul>` : `<p>Zatím žádný publikovaný článek.</p>`);
  return c.html(pageShell("Novinky v Claude Code", body));
});

// Detail článku — gated.
ccNewsRoutes.get("/novinky-cc/:slug", async (c) => {
  const redirect = await gateOrRedirect(c);
  if (redirect) return redirect;

  const slug = c.req.param("slug");
  const db = drizzle(c.env.DB);
  const rows = await db
    .select()
    .from(ccNewsItem)
    .where(eq(ccNewsItem.status, "published"));

  const row = rows.find((r) => slugFromPath(r.articlePath) === slug);
  if (!row) return c.html(pageShell("Nenalezeno", "<p>Článek nenalezen.</p>"), 404);

  const markdown = await c.env.KV.get(draftKvKey(row.id));
  if (!markdown) return c.html(pageShell("Nenalezeno", "<p>Obsah článku není dostupný.</p>"), 404);

  return c.html(pageShell(row.weekLabel ?? "Novinky v Claude Code", renderMarkdown(markdown)));
});

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
