import type { FC, PropsWithChildren } from "hono/jsx";

interface LayoutProps {
  title?: string;
  description?: string;
  user?: { name: string | null; email: string } | null;
}

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
      <title>{title} | kurz.vibecoding.cz</title>
      <meta name="description" content={description} />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:type" content="website" />
      <meta property="og:url" content="https://kurz.vibecoding.cz" />
      <script src="https://cdn.tailwindcss.com"></script>
      <script
        src="https://unpkg.com/htmx.org@2.0.4"
        integrity="sha384-HGfztofotfshcF7+8n44JQL2oJmowVChPTg48S+jvZoztPfvwD79OC/LTtG6dMp+"
        crossorigin="anonymous"
      ></script>
    </head>
    <body class="bg-gray-50 text-gray-900 min-h-screen flex flex-col" hx-boost="true">
      <header class="bg-white border-b border-gray-200">
        <nav class="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <a href="/" class="font-bold text-lg">
            kurz.vibecoding.cz
          </a>
          <div class="flex items-center gap-4">
            {user ? (
              <>
                <a href="/dashboard" class="text-sm hover:underline">
                  Můj kurz
                </a>
                <form method="post" action="/logout">
                  <button type="submit" class="text-sm text-gray-500 hover:underline">
                    Odhlásit
                  </button>
                </form>
              </>
            ) : (
              <a
                href="/login"
                class="text-sm bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700"
              >
                Přihlásit se
              </a>
            )}
          </div>
        </nav>
      </header>

      <main class="flex-1">{children}</main>

      <footer class="border-t border-gray-200 py-6 text-center text-sm text-gray-500">
        <p>
          &copy; {new Date().getFullYear()}{" "}
          <a href="https://vibecoding.cz" class="hover:underline">
            vibecoding.cz
          </a>
        </p>
      </footer>
    </body>
  </html>
);
