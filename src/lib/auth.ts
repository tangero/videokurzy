import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { magicLink } from "better-auth/plugins";
import { oidcProvider } from "better-auth/plugins/oidc-provider";
import { drizzle } from "drizzle-orm/d1";
import * as authSchema from "../db/auth-schema";
import type { Env } from "../types";
import { ensureUserEmailRecord } from "./user-emails";
import { sendResendEvent } from "./resend";

export function createAuth(env: Env, ctx: ExecutionContext) {
  const db = drizzle(env.DB, { schema: authSchema });

  return betterAuth({
    appName: "Videokurzy",
    baseURL: env.BETTER_AUTH_URL,
    basePath: "/api/auth",
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db, { provider: "sqlite" }),

    emailAndPassword: {
      enabled: false,
    },

    session: {
      expiresIn: 30 * 24 * 60 * 60, // 30 days
      updateAge: 24 * 60 * 60, // refresh every 24h
    },

    user: {
      additionalFields: {
        role: {
          type: "string",
          defaultValue: "user",
        },
      },
    },

    databaseHooks: {
      user: {
        create: {
          after: async (createdUser) => {
            // ensureUserEmailRecord only touches user_emails (typed inserts via
            // drizzle with imported userEmails symbol), so no schema passing needed.
            const hookDb = drizzle(env.DB);
            await ensureUserEmailRecord(hookDb, {
              userId: createdUser.id,
              email: createdUser.email,
            });
            // U magic-link auth vzniká účet právě při prvním přihlášení →
            // tohle je čistý "first login" signál pro onboarding automation.
            await sendResendEvent(
              env.RESEND_API_KEY,
              "account.created",
              createdUser.email.toLowerCase()
            );
          },
        },
      },
    },

    plugins: [
      magicLink({
        sendMagicLink: async ({ email, url }) => {
          const res = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${env.RESEND_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              from: "Videokurzy <kurz@vibecoding.cz>",
              to: email,
              subject: "Přihlášení do kurzu",
              html: `
                <h2>Přihlášení do videokurzu</h2>
                <p>Klikněte na tlačítko níže pro přihlášení:</p>
                <a href="${url}" style="display:inline-block;padding:12px 24px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px;">
                  Přihlásit se
                </a>
                <p style="margin-top:16px;color:#666;font-size:14px;">
                  Odkaz je platný 10 minut. Pokud jste o přihlášení nežádali, tento email ignorujte.
                </p>
              `,
            }),
          });
          if (!res.ok) {
            throw new Error(`Failed to send magic link: ${res.status}`);
          }
        },
        expiresIn: 600, // 10 minutes
        // Better Auth defaultuje na allowedAttempts: 1, takže PRVNÍ GET na URL
        // token spálí — a to nemusí být klik uživatele. Odkaz běžně otevřou
        // link scannery (Microsoft Defender Safe Links, antiviry, prefetch
        // mailového klienta) dřív, než se člověk k mailu dostane; uživateli pak
        // verify vrátí ATTEMPTS_EXCEEDED, nenastaví cookie a on skončí zpátky
        // na /login. Bezpečnostní dopad zvýšení je minimální: token je náhodných
        // 32 znaků s 10min platností, proti brute-force chrání entropie a rate
        // limit, ne tenhle counter.
        allowedAttempts: 3,
      }),
      oidcProvider({
        // Task 13: minimální nasazení. Žádný registrovaný klient v MVP —
        // slouží jen k expozici discovery metadata endpointu pro budoucí
        // cross-domain SSO (např. marigold.cz). Plugin je v Better Auth
        // 1.6.5 označen jako deprecated (→ @better-auth/oauth-provider),
        // ale pro MVP stačí. Issuer defaultuje na BETTER_AUTH_URL.
        loginPage: "/login",
      }),
    ],

    rateLimit: {
      window: 60,
      max: 10,
      customStorage: {
        set: async (key: string, value: { key: string; count: number; lastRequest: number }) => {
          await env.KV.put(key, JSON.stringify(value), {
            expirationTtl: 120,
          });
        },
        get: async (key: string) => {
          const val = await env.KV.get(key);
          return val ? JSON.parse(val) : null;
        },
      },
    },

    advanced: {
      backgroundTasks: {
        handler: (p) =>
          ctx.waitUntil(
            p.catch((err) => console.warn("[auth] Background task failed:", err))
          ),
      },
      defaultCookieAttributes: {
        secure: true,
        sameSite: "lax",
        httpOnly: true,
        // COOKIE_DOMAIN is set in production (".vibecoding.cz") so the session
        // cookie is visible across subdomains. In dev/test it's unset, which
        // falls back to host-only (no Domain attribute emitted by better-call).
        ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
