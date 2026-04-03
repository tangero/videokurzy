import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { magicLink } from "better-auth/plugins";
import { drizzle } from "drizzle-orm/d1";
import * as authSchema from "../db/auth-schema";
import type { Env } from "../types";

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
                  Odkaz je platný 5 minut. Pokud jste o přihlášení nežádali, tento email ignorujte.
                </p>
              `,
            }),
          });
          if (!res.ok) {
            throw new Error(`Failed to send magic link: ${res.status}`);
          }
        },
        expiresIn: 300, // 5 minutes
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
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
