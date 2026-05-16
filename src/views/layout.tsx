import type { FC, PropsWithChildren } from "hono/jsx";

interface LayoutProps {
  title?: string;
  description?: string;
  user?: { name: string | null; email: string } | null;
}

// Design tokens a komponentní CSS jsou v src/styles/input.css a minifikovány
// do public/styles.css přes Tailwind CLI (scripts: dev:css / build:css).
// Servírováno Cloudflare Workers assets bindingem (wrangler.toml [assets]).

const HamburgerIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
    <line x1="3" y1="6" x2="21" y2="6" />
    <line x1="3" y1="12" x2="21" y2="12" />
    <line x1="3" y1="18" x2="21" y2="18" />
  </svg>
);

export const Layout: FC<PropsWithChildren<LayoutProps>> = ({
  title = "Videokurz Claude Code s Patrickem",
  description = "Naučte se vibe coding s Claude Code. 10 epizod, od nápadu po deployment.",
  user,
  children,
}) => (
  <html lang="cs">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>{title} | kurzy.vibecoding.cz</title>
      <meta name="description" content={description} />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:type" content="website" />
      <meta property="og:url" content="https://kurzy.vibecoding.cz" />
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
      <link
        href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap"
        rel="stylesheet"
      />
      <link rel="stylesheet" href="/styles.css" />
      <script
        src="https://unpkg.com/htmx.org@2.0.4"
        integrity="sha384-HGfztofotfshcF7+8n44JQL2oJmowVChPTg48S+jvZoztPfvwD79OC/LTtG6dMp+"
        crossorigin="anonymous"
      ></script>
    </head>
    <body class="page" hx-boost="true">
      <a class="skip-link" href="#main-content">přeskočit na obsah</a>
      <header class="site-header">
        <div class="container header-inner">
          <a class="brand" href="/">
            <div class="avatar">kz</div>
            <div>
              <div class="brand-title">kurzy.vibecoding.cz</div>
              <div class="brand-subtitle">videokurzy vibe codingu</div>
            </div>
          </a>
          <nav class="nav" aria-label="Hlavní navigace">
            <a href="/#obsah">obsah</a>
            <a href="/#cenik">ceník</a>
            <a href="/#reference">reference</a>
            <a href="/#faq">faq</a>
          </nav>
          <div class="header-actions">
            {user ? (
              <>
                <a class="btn btn-ghost btn-sm" href="/dashboard">
                  můj kurz
                </a>
                <form method="post" action="/logout" style="margin:0;display:inline">
                  <button type="submit" class="btn btn-ghost btn-sm">
                    odhlásit
                  </button>
                </form>
              </>
            ) : (
              <>
                <a class="btn btn-ghost btn-sm" href="/login">
                  přihlásit
                </a>
                <a class="btn btn-sm" href="/#cenik">
                  koupit kurz
                </a>
              </>
            )}
          </div>

          <details class="mobile-menu">
            <summary aria-label="Otevřít navigaci">
              <HamburgerIcon /> menu
            </summary>
            <div class="mobile-menu-panel">
              <a class="mobile-menu-link" href="/#obsah" onclick="this.closest('details').open=false">obsah</a>
              <a class="mobile-menu-link" href="/#cenik" onclick="this.closest('details').open=false">ceník</a>
              <a class="mobile-menu-link" href="/#reference" onclick="this.closest('details').open=false">reference</a>
              <a class="mobile-menu-link" href="/#faq" onclick="this.closest('details').open=false">faq</a>
              <div class="mobile-menu-divider"></div>
              {user ? (
                <>
                  <a class="mobile-menu-link" href="/dashboard">můj kurz</a>
                  <form method="post" action="/logout" style="margin:0">
                    <button type="submit" class="mobile-menu-link">odhlásit</button>
                  </form>
                </>
              ) : (
                <>
                  <a class="mobile-menu-link" href="/login">přihlásit</a>
                  <a class="mobile-menu-link" href="/#cenik" onclick="this.closest('details').open=false">koupit kurz</a>
                </>
              )}
            </div>
          </details>
        </div>
      </header>

      <main class="main" id="main-content">{children}</main>

      <footer class="site-footer">
        <div class="container footer-inner">
          <div>
            &copy; 2026{" "}
            <a href="https://vibecoding.cz" target="_blank" rel="noreferrer">
              vibecoding.cz
            </a>
            {" "}&mdash; projekt Patricka Zandla
          </div>
          <div class="footer-links">
            <a href="/privacy">ochrana osobních údajů</a>
            <a href="/terms">obchodní podmínky</a>
            <a href="mailto:patrick@vibecoding.cz">kontakt</a>
          </div>
        </div>
      </footer>
    </body>
  </html>
);
