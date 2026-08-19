import { Hono } from "hono";
import type { Env, Variables } from "../types";
import { createAuth } from "../lib/auth";
import { LoginPage } from "../views/login";
import { MagicLinkSentPage } from "../views/login";

const auth = new Hono<{ Bindings: Env; Variables: Variables }>();

// Better Auth handler — handles all /api/auth/* routes
auth.all("/api/auth/*", async (c) => {
  const authInstance = createAuth(c.env, c.executionCtx);
  return authInstance.handler(c.req.raw);
});

/**
 * Chybové kódy, se kterými Better Auth redirectuje na errorCallbackURL
 * (viz magicLinkVerify v better-auth/plugins/magic-link). Bez překladu by
 * uživatel viděl jen holý přihlašovací formulář a netušil, proč ho odkaz
 * z mailu nepřihlásil.
 */
const MAGIC_LINK_ERRORS: Record<string, string> = {
  EXPIRED_TOKEN:
    "Platnost odkazu vypršela (odkaz platí 10 minut). Nechte si prosím poslat nový.",
  ATTEMPTS_EXCEEDED:
    "Tento odkaz už byl použit. Nechte si prosím poslat nový.",
  INVALID_TOKEN:
    "Odkaz je neplatný nebo už byl použit. Nechte si prosím poslat nový.",
};

const magicLinkErrorMessage = (code: string | undefined): string | undefined => {
  if (!code) return undefined;
  return (
    MAGIC_LINK_ERRORS[code] ??
    "Přihlášení odkazem se nezdařilo. Nechte si prosím poslat nový odkaz."
  );
};

// Login page
auth.get("/login", (c) => {
  const user = c.get("user");
  if (user) {
    return c.redirect("/dashboard");
  }
  const email = c.req.query("email") ?? "";
  const error = magicLinkErrorMessage(c.req.query("error"));
  return c.html(<LoginPage prefillEmail={email} error={error} />);
});

/**
 * Form-encoded proxy pro magic-link odeslání.
 *
 * Proč vlastní route místo přímého postu na /api/auth/sign-in/magic-link:
 * - Better Auth API přijímá pouze JSON, form elementy posílají application/x-www-form-urlencoded
 * - htmx bez extensions také form-encoded; json-enc extension přidává JS závislost a CDN riziko
 * - Vlastní route oddělí UX vrstvu (validace v CZ, brand consistency, htmx partial) od API vrstvy
 *
 * Progressive enhancement: form má jak `method="post" action="/login/send"` (no-JS fallback
 * přes native submit + 303 redirect), tak htmx atributy (partial swap bez reloadu).
 * Handler rozlišuje podle HX-Request hlavičky.
 */
auth.post("/login/send", async (c) => {
  const form = await c.req.formData();
  const email = String(form.get("email") ?? "").toLowerCase().trim();
  const callbackURL = String(form.get("callbackURL") ?? "/dashboard");
  const isHtmx = c.req.header("HX-Request") === "true";

  if (!email || !email.includes("@")) {
    const msg = "Zadejte platný email.";
    if (isHtmx) {
      return c.html(
        <div style="background:var(--error-bg);color:var(--error-text);padding:12px;border-radius:8px;border:1px solid var(--error-border);font-size:0.95rem">
          {msg}
        </div>,
        400
      );
    }
    return c.html(<LoginPage prefillEmail={email} error={msg} />, 400);
  }

  // Per-email throttle (Finding 8): /login/send proxuje na better-auth, ale
  // nepatří do jeho route namespace, takže nedědí jeho per-IP rate limit. Email
  // je už znormalizovaný (lowercase+trim výše), takže klíč nelze obejít změnou
  // velikosti písmen. Povol 3 odeslání, 4. zablokuj (120s okno) — to brání spamu
  // magic-linků (DoS doručitelnosti / obtěžování uživatele).
  const loginKey = `login_send:${email}`;
  const sentCount = Number((await c.env.KV.get(loginKey)) ?? "0");
  if (sentCount >= 3) {
    const msg = "Odkaz už byl odeslán. Zkuste to prosím za chvíli znovu.";
    if (isHtmx) {
      return c.html(
        <div style="background:var(--error-bg);color:var(--error-text);padding:12px;border-radius:8px;border:1px solid var(--error-border);font-size:0.95rem">
          {msg}
        </div>,
        429
      );
    }
    return c.html(<LoginPage prefillEmail={email} error={msg} />, 429);
  }
  await c.env.KV.put(loginKey, String(sentCount + 1), { expirationTtl: 120 });

  const authInstance = createAuth(c.env, c.executionCtx);
  const res = await authInstance.handler(
    new Request(new URL("/api/auth/sign-in/magic-link", c.req.url).toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // errorCallbackURL: bez něj Better Auth při neplatném/vypršelém/použitém
      // tokenu redirectuje na callbackURL (/dashboard) s ?error=..., tam
      // requireAuth uvidí prázdnou session a mlčky přesměruje na /login —
      // uživatel skončí na přihlašovacím formuláři bez vysvětlení. Míříme
      // chybu rovnou na /login, kde ji umíme zobrazit.
      body: JSON.stringify({ email, callbackURL, errorCallbackURL: "/login" }),
    })
  );

  if (!res.ok) {
    const body = await res.text();
    console.error("[login/send] Better Auth returned", res.status, body);
    const msg = "Nepodařilo se odeslat magický odkaz. Zkuste to prosím znovu.";
    if (isHtmx) {
      return c.html(
        <div style="background:var(--error-bg);color:var(--error-text);padding:12px;border-radius:8px;border:1px solid var(--error-border);font-size:0.95rem">
          {msg}
        </div>,
        502
      );
    }
    return c.html(<LoginPage prefillEmail={email} error={msg} />, 502);
  }

  if (isHtmx) {
    return c.html(
      <div style="background:var(--accent-subtle);color:var(--accent-2);padding:16px;border-radius:8px;border:1px solid var(--accent-border);font-size:0.95rem;text-align:center">
        <strong>Magický odkaz odeslán na {email}.</strong>
        <div style="margin-top:6px;color:var(--muted);font-size:0.9rem">
          Zkontrolujte emailovou schránku (včetně spam složky). Odkaz platí 10 minut.
        </div>
      </div>
    );
  }

  return c.redirect(`/login/sent?email=${encodeURIComponent(email)}`, 303);
});

// Magic link sent confirmation
auth.get("/login/sent", (c) => {
  return c.html(<MagicLinkSentPage />);
});

// Logout
auth.post("/logout", async (c) => {
  const authInstance = c.get("auth");
  await authInstance.api.signOut({
    headers: c.req.raw.headers,
  });
  return c.redirect("/");
});

export { auth as authRoutes };
