import { Hono } from "hono";
import type { Context } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { approveItem, articleRepoPath, draftKvKey, publishedKvKey } from "../lib/cc-news/draft";
import { fixDocLinksInMarkdown } from "../lib/cc-news/editor";
import { ccNewsItem } from "../db/schema";
import { hasAccess } from "../lib/access";
import { renderMarkdown, escapeHtml } from "../lib/markdown";
import { CcNewsListPage, CcNewsArticlePage, CcTopicsPage, CcTopicPage } from "../views/cc-news";
import type { Env, Variables } from "../types";

/** Slug z articlePath `src/content/novinky-cc/<slug>.md`. */
export function slugFromPath(articlePath: string | null): string | null {
  if (!articlePath) return null;
  return articlePath.replace(/^.*\//, "").replace(/\.md$/i, "") || null;
}

/**
 * Porovnatelný klíč pro řazení vydání podle STÁŘÍ OBSAHU (ne podle `publishedAt`,
 * který odráží jen kdy se článek vygeneroval — backfill starších týdnů má novější
 * publishedAt než aktuální týden a rozhodil by pořadí).
 *
 * Klíč se odvozuje z kanonického `sourceId` `…/whats-new/<rok>-w<týden>`:
 * `rok * 100 + týden`. Tím je řazení odolné vůči (a) zero-paddingu — `w9` < `w24`
 * číselně, kdežto lexikograficky by „9" > „2"; (b) přechodu roku — `2026-w01` >
 * `2025-w52`. Vyšší klíč = novější vydání. Neparsovatelný sourceId → -1 (spadne
 * na konec, sekundární řazení dle publishedAt to dořeší).
 */
export function weekSortKey(sourceId: string | null): number {
  const m = sourceId?.match(/(\d{4})-w(\d{1,2})$/i);
  if (!m) return -1;
  return parseInt(m[1], 10) * 100 + parseInt(m[2], 10);
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
 * Vytáhne `title` a `post_excerpt` z YAML front matteru (pokud je). Hodnota může
 * být v uvozovkách (`title: "…"`) i bez. Bez front matteru / klíče → null.
 * Lehký parser jen na tyhle dva skalární klíče — ne plný YAML (Workers runtime,
 * žádná závislost). Title je skutečný český nadpis článku, post_excerpt perex.
 */
export function parseFrontMatter(md: string): { title: string | null; excerpt: string | null } {
  const fm = md.match(/^﻿?\s*---\n([\s\S]*?)\n---/)?.[1];
  if (!fm) return { title: null, excerpt: null };

  // Klíče jsou fixní (žádná interpolace uživatelského vstupu do regexu).
  const pick = (key: string): string | null => {
    // Klíč na začátku řádku, hodnota do konce řádku.
    const m = fm.match(new RegExp(`^${key}:[ \\t]*(.+?)[ \\t]*$`, "m"));
    if (!m) return null;
    const raw = m[1].trim();
    // Dvojité uvozovky: strhni obal a unescapuj YAML `\"` a `\\` (jinak by se
    // hodnota s vnitřními uvozovkami zmršila). Jednoduché uvozovky: jen obal.
    if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
      const inner = raw.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
      return inner.trim() || null;
    }
    if (raw.length >= 2 && raw.startsWith("'") && raw.endsWith("'")) {
      return raw.slice(1, -1).trim() || null;
    }
    return raw || null;
  };

  return { title: pick("title"), excerpt: pick("post_excerpt") };
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

/** Recenzní údaje konceptu ze changelogu: co se vybralo, opravilo, vynechalo a co hlídat. */
function reviewHtml(r: import("../lib/cc-news/weekly").WeeklyReview): string {
  const li = (xs: string[]) => (xs.length ? `<ul>${xs.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul>` : "<p>—</p>");
  const warn = [
    ...r.editorNotes.map((n) => `Poznámka editoru: ${n}`),
    ...r.versionIssues.map((v) => `Verze ${v} v textu nesedí s žádnou citovanou položkou`),
    ...r.dropped.map((d) => `Vyřazeno kontrolou faktů: ${d.title} (${d.problem})`),
  ];
  return (
    `<section style="border:1px solid #e5e7eb;border-radius:8px;padding:12px 16px;margin:12px 0 24px;font-size:14px">` +
    `<p><strong>Ke kontrole:</strong> ${escapeHtml(r.weekLabel)}, ${escapeHtml(r.versionRange)} · ${r.entries} položek changelogu · ${r.docsChanges} změn v dokumentaci</p>` +
    (warn.length ? `<p style="color:#b45309"><strong>Pozor:</strong></p>${li(warn)}` : "") +
    `<p><strong>Signály z dokumentace:</strong></p>${li(r.signals.map((s) => `${s.page}: ${s.kind === "new-page" ? "nová stránka" : "velký nový oddíl"} (${s.words} slov)`))}` +
    `<p><strong>Hlavní novinky a zdroje:</strong></p>${li(r.features.map((f) => `${f.title} (${f.version}) ← ${f.sourceIds.join(", ")}`))}` +
    (r.fixed.length ? `<p><strong>Opraveno kontrolou faktů:</strong></p>${li(r.fixed.map((f) => `${f.title}: ${f.problem}`))}` : "") +
    `<details><summary>Vynechané zásadní změny (${r.skipped.length})</summary>${li(r.skipped.map((k) => `${k.id}: ${k.reason}`))}</details>` +
    (r.strippedLinks.length ? `<p>Odstraněné odkazy mimo dokumentaci: ${r.strippedLinks.map(escapeHtml).join(", ")}</p>` : "") +
    `</section>`
  );
}

// Seznam publikovaných článků „Novinky v CC" — gated, v designu serveru.
ccNewsRoutes.get("/novinky-cc", async (c) => {
  const redirect = await gateOrRedirect(c);
  if (redirect) return redirect;

  const db = drizzle(c.env.DB);
  const published = await db
    .select()
    .from(ccNewsItem)
    .where(eq(ccNewsItem.status, "published"))
    .orderBy(desc(ccNewsItem.publishedAt));

  // Řazení podle STÁŘÍ OBSAHU (rok+týden ze sourceId), ne podle publishedAt:
  // backfill starších týdnů má novější publishedAt, takže by je vystrčil nahoru.
  // publishedAt zůstává sekundárním kritériem (stabilní pořadí při shodě / když
  // sourceId nejde naparsovat — viz weekSortKey). Nejnovější týden = nahoře.
  const rows = [...published].sort((a, b) => {
    const byWeek = weekSortKey(b.sourceId) - weekSortKey(a.sourceId);
    if (byWeek !== 0) return byWeek;
    return (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0);
  });

  // Skutečný nadpis/perex jsou ve front matteru markdownu (KV), ne v DB. Načteme
  // je per vydání PARALELNĚ (Promise.all, ne sériově). Selhání JEDNOHO KV čtení
  // (transientní chyba) NESMÍ shodit celou stránku — odchytíme ho per-item a
  // degradujeme na weekLabel; ostatní vydání se zobrazí normálně.
  // (TODO: při růstu počtu vydání denormalizovat title/excerpt do cc_news_item
  // při publikaci a vyhnout se KV čtení na seznamu úplně.)
  const items = (
    await Promise.all(
      rows.map(async (r) => {
        const slug = slugFromPath(r.articlePath);
        if (!slug) return null;
        let fm: { title: string | null; excerpt: string | null } = { title: null, excerpt: null };
        try {
          const md = await c.env.KV.get(publishedKvKey(r.id));
          if (md) fm = parseFrontMatter(md);
        } catch (err) {
          console.error(`[cc-news] KV čtení selhalo pro ${r.id}, fallback na weekLabel:`, (err as Error)?.message);
        }
        return {
          slug,
          title: fm.title ?? r.weekLabel ?? "Novinky",
          excerpt: fm.excerpt,
          versionRange: r.versionRange,
          publishedAt: r.publishedAt ? r.publishedAt.getTime() : null,
        };
      }),
    )
  ).filter((x): x is NonNullable<typeof x> => x !== null);

  const user = c.get("user")!;
  return c.html(
    <CcNewsListPage
      user={{ name: user.name ?? null, email: user.email }}
      items={items}
    />,
  );
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

// Vývoj témat changelogu — gated. MUSÍ být PŘED /novinky-cc/:slug.
ccNewsRoutes.get("/novinky-cc/temata", async (c) => {
  const redirect = await gateOrRedirect(c);
  if (redirect) return redirect;
  const { TOPICS } = await import("../lib/cc-news/taxonomy");
  const { ccChangeItem } = await import("../db/schema");
  const db = drizzle(c.env.DB);
  const stats = await db
    .select({ topic: ccChangeItem.topic, n: sql<number>`count(*)`, last: sql<number>`max(${ccChangeItem.publishedAt})` })
    .from(ccChangeItem)
    .where(gte(ccChangeItem.significance, 2))
    .groupBy(ccChangeItem.topic);
  const byTopic = new Map(stats.map((s) => [s.topic, s]));
  const topics = TOPICS.filter((t) => t.key !== "other")
    .map((t) => ({
      key: t.key, label: t.label, description: t.description,
      count: Number(byTopic.get(t.key)?.n ?? 0),
      lastAt: byTopic.get(t.key)?.last ? Number(byTopic.get(t.key)!.last) * 1000 : null,
    }))
    .sort((a, b) => b.count - a.count);
  const user = c.get("user")!;
  return c.html(<CcTopicsPage user={{ name: user.name ?? null, email: user.email }} topics={topics} />);
});

ccNewsRoutes.get("/novinky-cc/temata/:topic", async (c) => {
  const redirect = await gateOrRedirect(c);
  if (redirect) return redirect;
  const { TOPICS } = await import("../lib/cc-news/taxonomy");
  const { ccChangeItem } = await import("../db/schema");
  const t = TOPICS.find((x) => x.key === c.req.param("topic") && x.key !== "other");
  if (!t) return c.html(pageShell("Nenalezeno", "<p>Téma nenalezeno.</p>"), 404);
  const db = drizzle(c.env.DB);
  const rows = await db
    .select()
    .from(ccChangeItem)
    .where(and(eq(ccChangeItem.topic, t.key), gte(ccChangeItem.significance, 2)))
    .orderBy(desc(ccChangeItem.publishedAt), desc(ccChangeItem.ord));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const entries = rows.map((r) => {
    const f = r.followsId ? byId.get(r.followsId) : undefined;
    return {
      id: r.id, version: r.version, publishedAt: r.publishedAt.getTime(), significance: r.significance ?? 2,
      text: r.text, reason: r.reason,
      follows: f ? { id: f.id, version: f.version, relation: r.relation, reason: r.followReason } : null,
    };
  });
  const user = c.get("user")!;
  return c.html(
    <CcTopicPage
      user={{ name: user.name ?? null, email: user.email }}
      topic={{ key: t.key, label: t.label, description: t.description, count: entries.length, lastAt: entries[0]?.publishedAt ?? null }}
      entries={entries}
    />,
  );
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

  // Skutečný český nadpis je v front matteru (title), ne weekLabel. Tělo už
  // začíná perexem, takže perex zvlášť nevykreslujeme (byl by duplicitní).
  const { title } = parseFrontMatter(markdown);
  const user = c.get("user")!;
  return c.html(
    <CcNewsArticlePage
      user={{ name: user.name ?? null, email: user.email }}
      title={title ?? row.weekLabel ?? "Novinky v Claude Code"}
      articleHtml={renderMarkdown(fixDocLinksInMarkdown(stripFrontMatter(markdown)))}
    />,
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
  // Vydání ze changelogu nesou recenzní údaje (výběr, kontrola faktů, poznámky editoru).
  const { reviewKvKey } = await import("../lib/cc-news/weekly");
  const review = await c.env.KV.get<import("../lib/cc-news/weekly").WeeklyReview>(reviewKvKey(id), "json");

  return c.html(
    pageShell(
      "Náhled konceptu — Novinky v Claude Code",
      `<p style="color:#b45309"><strong>Koncept (zatím nepublikováno).</strong> Úpravy se dělají na GitHubu; po schválení se publikuje.</p>` +
        (review ? reviewHtml(review) : "") +
        renderMarkdown(fixDocLinksInMarkdown(stripFrontMatter(draft)))
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
