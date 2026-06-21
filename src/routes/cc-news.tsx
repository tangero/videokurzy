import { Hono } from "hono";
import type { Context } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { and, desc, eq } from "drizzle-orm";
import { approveItem, articleRepoPath, draftKvKey, publishedKvKey } from "../lib/cc-news/draft";
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
 * Odstraní YAML front matter (`---\n…\n---`) ze začátku markdownu. Front matter
 * patří do .md souboru v repu, ne do HTML zobrazení — bez stripnutí by se
 * čtenáři na detailu zobrazil syrový YAML blok jako text.
 */
export function stripFrontMatter(md: string): string {
  return md.replace(/^﻿?\s*---\n[\s\S]*?\n---\s*\n?/, "").trimStart();
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

// Odhlášení z newsletteru (GDPR, W-007). Veřejné — chráněné jen podepsaným
// unsub tokenem (oddělený účel od schválení). Vloží suppression (emailHash).
// MUSÍ být registrováno PŘED /novinky-cc/:slug, jinak by ho :slug zachytilo.
ccNewsRoutes.get("/novinky-cc/unsubscribe", async (c) => {
  const token = c.req.query("token");
  if (!token) return c.html(pageShell("Odhlášení", "<p>Chybí token.</p>"), 400);

  const { verifyUnsubToken } = await import("../lib/cc-news/approval");
  const email = await verifyUnsubToken(c.env, token);
  if (!email) return c.html(pageShell("Odhlášení", "<p>Neplatný odhlašovací odkaz.</p>"), 401);

  const { recordUnsubscribe } = await import("../lib/cc-news/newsletter");
  const db = drizzle(c.env.DB);
  const { alreadyOptedOut } = await recordUnsubscribe(
    db,
    c.env.AUTH_INTERNAL_SECRET,
    email,
    new Date(),
    { source: "unsubscribe-link" }
  );
  const msg = alreadyOptedOut
    ? "Tato adresa už je odhlášená. Newsletter „Novinky v Claude Code“ vám nebudeme posílat."
    : "Odhlášení proběhlo. Newsletter „Novinky v Claude Code“ vám už nebudeme posílat.";
  return c.html(pageShell("Odhlášení", `<p>${msg}</p>`));
});

// Detail článku — gated.
ccNewsRoutes.get("/novinky-cc/:slug", async (c) => {
  const redirect = await gateOrRedirect(c);
  if (redirect) return redirect;

  const slug = c.req.param("slug");
  const db = drizzle(c.env.DB);
  // Cílený lookup přes articlePath odvozenou ze slugu (ne full-table scan).
  const rows = await db
    .select()
    .from(ccNewsItem)
    .where(and(eq(ccNewsItem.status, "published"), eq(ccNewsItem.articlePath, articleRepoPath(slug))))
    .limit(1);

  const row = rows[0];
  if (!row) return c.html(pageShell("Nenalezeno", "<p>Článek nenalezen.</p>"), 404);

  // Živá publikovaná verze (ne rozpracovaný draft) + strip YAML front matteru.
  const markdown = await c.env.KV.get(publishedKvKey(row.id));
  if (!markdown) return c.html(pageShell("Nenalezeno", "<p>Obsah článku není dostupný.</p>"), 404);

  return c.html(
    pageShell(row.weekLabel ?? "Novinky v Claude Code", renderMarkdown(stripFrontMatter(markdown)))
  );
});

// Náhled rozpracovaného konceptu pro admina ze schvalovacího e-mailu
// (odkaz „Otevřít koncept k editaci"). ADMIN-only: koncept ještě není
// publikovaný. Registrováno PŘED internalRoutes, aby ji nezachytil
// requireInternalSecret (lidský klik z e-mailu nemá service secret).
ccNewsRoutes.get("/internal/cc-news/draft/:id", async (c) => {
  const user = c.get("user");
  if (!user) return c.redirect("/login");
  if (user.role !== "admin") return c.html(pageShell("Náhled konceptu", "<p>Jen pro administrátory.</p>"), 403);

  const id = c.req.param("id");
  const draft = await c.env.KV.get(draftKvKey(id));
  if (!draft) return c.html(pageShell("Náhled konceptu", "<p>Koncept nenalezen.</p>"), 404);

  return c.html(
    pageShell(
      "Náhled konceptu — Novinky v Claude Code",
      `<p style="color:#b45309"><strong>Koncept (zatím nepublikováno).</strong> Úpravy se dělají na GitHubu; po schválení se publikuje.</p>` +
        renderMarkdown(stripFrontMatter(draft))
    )
  );
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
    result.reason === "nonce-mismatch" ? 409 :
    result.reason === "invalid-token" ? 401 : 404;
  const msg =
    result.reason === "already-published" ? "Tento odkaz už byl použit — článek je publikovaný." :
    result.reason === "invalid-token" ? "Neplatný nebo prošlý odkaz." :
    result.reason === "nonce-mismatch" ? "Odkaz je zneplatněný novějším konceptem." :
    "Článek nenalezen.";
  return c.html(`<!doctype html><meta charset="utf-8"><title>Schválení</title><p>${msg}</p>`, status);
});
