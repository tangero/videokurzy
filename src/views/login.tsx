import type { FC } from "hono/jsx";
import { Layout } from "./layout";

const MailIcon = () => (
  <svg aria-hidden="true" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <polyline points="3 7 12 13 21 7" />
  </svg>
);

const ArrowIcon = () => (
  <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <line x1="5" y1="12" x2="19" y2="12" />
    <polyline points="12 5 19 12 12 19" />
  </svg>
);

export const LoginPage: FC = () => (
  <Layout title="Přihlášení">
    <div class="container-narrow" style="margin-top:40px">
      <div class="card" style="padding:36px">
        <div class="eyebrow">// přihlášení</div>
        <h2 style="font-family:var(--font-head);font-size:1.8rem;font-weight:700;margin:0 0 8px;letter-spacing:-0.01em">
          Přihlášení bez&nbsp;hesla.
        </h2>
        <p style="color:var(--muted);margin:0 0 24px">
          Napište email, pošleme vám jednorázový odkaz. Funguje i&nbsp;pro&nbsp;firemní licence
          — stačí email na&nbsp;firemní doméně.
        </p>
        <form
          hx-post="/api/auth/sign-in/magic-link"
          hx-target="#login-result"
          hx-swap="innerHTML"
          hx-indicator="#login-spinner"
          class="vstack"
          style="gap:14px"
        >
          <div>
            <label class="label" for="email">emailová adresa</label>
            <input
              type="email"
              id="email"
              name="email"
              required
              placeholder="jmeno@firma.cz"
              class="input"
              autocomplete="email"
            />
          </div>
          <input type="hidden" name="callbackURL" value="/dashboard" />
          <button type="submit" class="btn btn-lg btn-block">
            poslat magický odkaz{" "}
            <span class="arrow">
              <ArrowIcon />
            </span>
          </button>
          <div id="login-spinner" class="htmx-indicator" style="text-align:center;color:var(--muted);font-family:var(--font-mono);font-size:0.85rem">
            odesílám...
          </div>
        </form>
        <div
          style="margin-top:20px;padding-top:20px;border-top:1px solid var(--border);text-align:center;font-size:0.9rem;color:var(--muted)"
        >
          Ještě nemáte kurz?{" "}
          <a href="/#cenik">Podívejte se na&nbsp;ceník</a>.
        </div>
      </div>
      <div id="login-result" style="margin-top:16px"></div>
    </div>
  </Layout>
);

export const MagicLinkSentPage: FC = () => (
  <Layout title="Odkaz odeslán">
    <div class="container-narrow" style="margin-top:40px">
      <div class="card" style="padding:40px;text-align:center">
        <div
          style="width:64px;height:64px;border-radius:16px;background:var(--accent-light);color:var(--accent-2);display:inline-flex;align-items:center;justify-content:center;margin-bottom:18px"
        >
          <MailIcon />
        </div>
        <h2 style="font-family:var(--font-head);font-size:1.7rem;font-weight:700;margin:0 0 8px;letter-spacing:-0.01em">
          Zkontrolujte schránku.
        </h2>
        <p style="color:var(--muted);margin:0 0 6px">Poslali jsme magický odkaz na váš email.</p>
        <div
          style="padding:16px;border-radius:12px;background:var(--accent-subtle);border:1px solid var(--accent-border);text-align:left;margin:20px 0 24px"
        >
          <div class="mono" style="font-size:0.8rem;color:var(--accent-2);margin-bottom:6px">
            // tip
          </div>
          <div style="font-size:0.95rem">
            Odkaz platí 15 minut. Otevřete ho na&nbsp;stejném zařízení, abyste zůstali přihlášeni.
          </div>
        </div>
        <a class="btn btn-ghost btn-sm" href="/login">
          zpět na přihlášení
        </a>
      </div>
    </div>
  </Layout>
);
