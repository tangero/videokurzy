import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { authMiddleware, requireAuth } from "../middleware/auth";
import {
  listUserEmails,
  promotePrimary,
  removeUserEmail,
  normalizeEmail,
} from "../lib/user-emails";
import { logIdentityEvent } from "../lib/audit";
import { logServerError, maskEmail } from "../lib/errors";
import { createAuth } from "../lib/auth";
import { isAllowedCallback } from "../lib/callback-allowlist";
import { user as userTable } from "../db/auth-schema";
import { signAddEmailIntent } from "./internal";
import {
  signDeletionIntent,
  verifyDeletionIntent,
  DELETION_TOKEN_TTL_MS,
} from "../lib/account-deletion";
import { anonymizeAndDeleteUser } from "../lib/admin-users";
import { invalidateAccessCache } from "../lib/access";
import { sendEmail, accountDeletionConfirmHtml } from "../lib/email";
import { Layout } from "../views/layout";
import { ProfilePage } from "../views/profile";
import type { Env, Variables } from "../types";

/**
 * User-facing profile endpoints for managing the email addresses associated
 * with the signed-in account. Session-auth protected (Better Auth cookie).
 *
 * - GET    /api/profile/emails            — list emails
 * - POST   /api/profile/emails            — start verify-add flow (magic link)
 * - PATCH  /api/profile/emails            — promote an email to primary
 * - DELETE /api/profile/emails            — remove a secondary email
 *
 * POST sends a magic link to the new email; the link, once clicked, hits the
 * consumer Worker which calls back into `/internal/auth/verify-add-email` to
 * attach the (now-verified) email to the ORIGINAL user.
 */
const profile = new Hono<{ Bindings: Env; Variables: Variables }>();

profile.use("/api/profile/*", authMiddleware, requireAuth);

profile.get("/api/profile/emails", async (c) => {
  const user = c.get("user")!;
  const db = drizzle(c.env.DB);
  const emails = await listUserEmails(db, user.id);
  return c.json({ emails });
});

profile.post("/api/profile/emails", async (c) => {
  const user = c.get("user")!;
  const body = await c.req
    .json<{ email?: string; callbackUrl?: string }>()
    .catch(() => ({}) as { email?: string; callbackUrl?: string });
  const email = body.email ? normalizeEmail(body.email) : "";
  const callbackUrl = body.callbackUrl;
  if (!email) return c.json({ error: "email required" }, 400);
  if (!callbackUrl || !isAllowedCallback(callbackUrl)) {
    return c.json({ error: "callbackUrl not allowed" }, 400);
  }

  const auth = createAuth(c.env, c.executionCtx);
  // Bake a signed add-email intent into the callback. The internal verify
  // endpoint uses it as the server-side authorization source for target user.
  const verifyCallback = new URL(callbackUrl);
  verifyCallback.searchParams.set("intent", "add-email");
  verifyCallback.searchParams.set("userId", user.id);
  verifyCallback.searchParams.set("addEmailIntent", await signAddEmailIntent(c.env, {
    userId: user.id,
    email,
    expiresAt: Date.now() + 15 * 60 * 1000,
  }));

  try {
    await auth.api.signInMagicLink({
      body: { email, callbackURL: verifyCallback.toString() },
      headers: new Headers(),
    });
  } catch (err) {
    const correlationId = crypto.randomUUID();
    console.warn(JSON.stringify({
      scope: "profile/emails/add",
      event: "magic_link_failed",
      correlationId,
      email: maskEmail(email),
      message: (err as Error)?.message,
    }));
    return c.json({ error: "send_failed", correlationId }, 502);
  }
  return c.json({ ok: true, pending: true });
});

profile.patch("/api/profile/emails", async (c) => {
  const user = c.get("user")!;
  const body = await c.req
    .json<{ email?: string; promote?: boolean }>()
    .catch(() => ({}) as { email?: string; promote?: boolean });
  if (!body.email || !body.promote) {
    return c.json({ error: "email and promote:true required" }, 400);
  }
  const db = drizzle(c.env.DB);
  try {
    await promotePrimary(db, { userId: user.id, email: body.email });
    await logIdentityEvent(db, {
      userId: user.id,
      action: "email_promoted_primary",
      actor: "self",
      details: { email: normalizeEmail(body.email) },
    });
  } catch (err) {
    // Neleakovat interní message (může nést email/stav) — zaloguj a vrať obecný kód.
    logServerError("profile/emails", "promote_failed", {
      userId: user.id,
      message: (err as Error)?.message,
    });
    return c.json({ error: "promote_failed" }, 400);
  }
  return c.json({ ok: true });
});

profile.delete("/api/profile/emails", async (c) => {
  const user = c.get("user")!;
  const body = await c.req
    .json<{ email?: string }>()
    .catch(() => ({}) as { email?: string });
  if (!body.email) return c.json({ error: "email required" }, 400);
  const db = drizzle(c.env.DB);
  try {
    await removeUserEmail(db, { userId: user.id, email: body.email });
    await logIdentityEvent(db, {
      userId: user.id,
      action: "email_removed",
      actor: "self",
      details: { email: normalizeEmail(body.email) },
    });
  } catch (err) {
    // Neleakovat interní message (může nést email/stav) — zaloguj a vrať obecný kód.
    logServerError("profile/emails", "remove_failed", {
      userId: user.id,
      message: (err as Error)?.message,
    });
    return c.json({ error: "remove_failed" }, 400);
  }
  return c.json({ ok: true });
});

profile.post("/api/profile/recovery-banner/dismiss", async (c) => {
  const u = c.get("user")!;
  const db = drizzle(c.env.DB);
  const until = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await db
    .update(userTable)
    .set({ recoveryBannerDismissedUntil: until })
    .where(eq(userTable.id, u.id));
  await logIdentityEvent(db, {
    userId: u.id,
    action: "recovery_banner_dismissed",
    actor: "self",
    details: { until: until.toISOString() },
  });
  return c.json({ ok: true, until });
});

// Stránka nastavení účtu. Není pod /api/profile/* guardem, proto si auth
// hlídá sama (přesměruje nepřihlášeného na login).
profile.get("/profile", (c) => {
  const user = c.get("user");
  if (!user) return c.redirect("/login");
  return c.html(<ProfilePage user={{ name: user.name ?? null, email: user.email }} />);
});

// ─── Self-service výmaz účtu (GDPR čl. 17) ──────────────────────────
//
// Dvoukrokově: POST vyžádá výmaz a pošle potvrzovací e-mail s podepsaným
// tokenem; GET /profile/delete/confirm token ověří a teprve pak výmaz provede.
// Druhý kanál (e-mail) brání omylu i cizímu zásahu přes session.

profile.post("/api/profile/delete", async (c) => {
  const user = c.get("user")!;

  // Admin se přes self-service nesmaže — chrání to před ztrátou jediného
  // admin účtu omylem. Admina řeší jiný admin přes /admin.
  if (user.role === "admin") {
    return c.json({ error: "admin_cannot_self_delete" }, 403);
  }

  const confirmUrl = new URL("/profile/delete/confirm", c.env.BETTER_AUTH_URL);
  confirmUrl.searchParams.set(
    "token",
    await signDeletionIntent(c.env, {
      userId: user.id,
      email: user.email,
      expiresAt: Date.now() + DELETION_TOKEN_TTL_MS,
    }),
  );

  const sent = await sendEmail(c.env, {
    to: user.email,
    subject: "Potvrďte smazání účtu — kurzy.vibecoding.cz",
    html: accountDeletionConfirmHtml(confirmUrl.toString()),
  });
  if (!sent) {
    return c.json({ error: "send_failed" }, 502);
  }
  return c.json({ ok: true, pending: true });
});

profile.get("/profile/delete/confirm", async (c) => {
  const token = c.req.query("token") ?? "";
  const intent = await verifyDeletionIntent(c.env, token);

  // Neplatný / prošlý / pozměněný token — nic nemažeme.
  if (!intent) {
    return c.html(
      <Layout title="Odkaz neplatný">
        <section class="max-w-md mx-auto px-4 py-16 text-center">
          <h1 class="text-2xl font-bold mb-4">Odkaz vypršel nebo je neplatný</h1>
          <p class="text-gray-600 mb-6">
            Potvrzovací odkaz platí 15 minut. Vyžádejte smazání účtu znovu z nastavení profilu.
          </p>
          <a href="/dashboard" class="text-indigo-600 hover:underline">Zpět na přehled</a>
        </section>
      </Layout>,
      400,
    );
  }

  const db = drizzle(c.env.DB);

  // Audit zapiš PŘED smazáním — userIdentityAudit nemá FK na user (záměrně,
  // kvůli forensice), takže záznam výmaz přežije.
  await logIdentityEvent(db, {
    userId: intent.userId,
    action: "account_deleted",
    actor: "self",
    details: { email: maskEmail(intent.email) },
  });

  let anonymizedPurchases = 0;
  try {
    anonymizedPurchases = await anonymizeAndDeleteUser(db, intent.userId);
  } catch (err) {
    logServerError("profile/delete", "delete_failed", {
      userId: intent.userId,
      message: (err as Error)?.message,
    });
    return c.html(
      <Layout title="Smazání selhalo">
        <section class="max-w-md mx-auto px-4 py-16 text-center">
          <h1 class="text-2xl font-bold mb-4">Smazání se nezdařilo</h1>
          <p class="text-gray-600 mb-6">
            Zkuste to prosím znovu, nebo nás kontaktujte na andrea@vibecoding.cz.
          </p>
        </section>
      </Layout>,
      500,
    );
  }

  // Přístupová cache + session padají s uživatelem; cache invaliduj explicitně.
  await invalidateAccessCache(c.env.KV, intent.userId);

  // Odhlásit (smazat session cookie) — session řádky už kaskádově zmizely,
  // ale prohlížeč drží cookie, dokud ji nepřepíšeme.
  try {
    const auth = createAuth(c.env, c.executionCtx);
    await auth.api.signOut({ headers: c.req.raw.headers });
  } catch {
    // Best-effort — uživatel už v DB neexistuje, signOut může selhat.
  }

  return c.html(
    <Layout title="Účet smazán">
      <section class="max-w-md mx-auto px-4 py-16 text-center">
        <h1 class="text-2xl font-bold mb-4">Váš účet byl smazán</h1>
        <p class="text-gray-600 mb-6">
          Profil, přihlašovací údaje i postup ve kurzech jsme trvale odstranili
          {anonymizedPurchases > 0
            ? ". Vystavené účetní doklady zůstávají z důvodu zákonné archivační povinnosti, ale bez vašich osobních údajů."
            : "."}
        </p>
        <a href="/" class="text-indigo-600 hover:underline">Zpět na hlavní stránku</a>
      </section>
    </Layout>,
  );
});

export default profile;
