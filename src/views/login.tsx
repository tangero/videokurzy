import type { FC } from "hono/jsx";
import { Layout } from "./layout";

export const LoginPage: FC = () => (
  <Layout title="Přihlášení">
    <div class="max-w-md mx-auto px-4 py-16">
      <h1 class="text-2xl font-bold mb-2">Přihlášení</h1>
      <p class="text-gray-600 mb-8">
        Zadejte svůj email a pošleme vám přihlašovací odkaz.
      </p>

      <form
        hx-post="/api/auth/magic-link/send"
        hx-target="#login-result"
        hx-swap="innerHTML"
        hx-indicator="#login-spinner"
      >
        <label for="email" class="block text-sm font-medium mb-1">
          Email
        </label>
        <input
          type="email"
          id="email"
          name="email"
          required
          placeholder="vas@email.cz"
          class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 mb-4"
        />
        <input type="hidden" name="callbackURL" value="/dashboard" />
        <button
          type="submit"
          class="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 font-medium"
        >
          Poslat přihlašovací odkaz
        </button>
        <div id="login-spinner" class="htmx-indicator text-center mt-4 text-gray-500">
          Odesílám...
        </div>
      </form>

      <div id="login-result" class="mt-4"></div>
    </div>
  </Layout>
);

export const MagicLinkSentPage: FC = () => (
  <Layout title="Odkaz odeslán">
    <div class="max-w-md mx-auto px-4 py-16 text-center">
      <div class="text-4xl mb-4">&#9993;</div>
      <h1 class="text-2xl font-bold mb-2">Zkontrolujte svůj email</h1>
      <p class="text-gray-600">
        Poslali jsme vám přihlašovací odkaz. Klikněte na něj a budete přihlášeni.
        Odkaz je platný 5 minut.
      </p>
      <a href="/login" class="inline-block mt-6 text-blue-600 hover:underline">
        Zpět na přihlášení
      </a>
    </div>
  </Layout>
);
