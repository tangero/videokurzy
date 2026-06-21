import type { FC } from "hono/jsx";
import { Layout } from "./layout";

interface ProfilePageProps {
  user: { name: string | null; email: string };
  /** Zda účet dostává newsletter „Novinky v Claude Code" (default true). */
  ccNewsSubscribed: boolean;
}

/**
 * Stránka nastavení účtu. Sekce: odběr newsletteru „Novinky v Claude Code"
 * (opt-in/opt-out) a GDPR „smazat účet". Je tu místo pro budoucí správu e-mailů
 * (API endpointy /api/profile/emails už existují).
 */
export const ProfilePage: FC<ProfilePageProps> = ({ user, ccNewsSubscribed }) => (
  <Layout title="Nastavení účtu" user={user}>
    <section class="max-w-2xl mx-auto px-4 py-12">
      <h1 class="text-2xl font-bold mb-2">Nastavení účtu</h1>
      <p class="text-gray-600 mb-8">Přihlášen jako <strong>{user.email}</strong></p>

      <div class="border border-gray-200 rounded-lg p-6 bg-gray-50 mb-8">
        <h2 class="text-lg font-semibold text-gray-800 mb-2">Novinky v Claude Code</h2>
        <p class="text-sm text-gray-600 mb-4">
          Týdenní přehled novinek z Claude Code pro platící uživatele. Posíláme ho
          na vaši hlavní adresu <strong>{user.email}</strong>. Odběr můžete kdykoli
          vypnout i znovu zapnout.
        </p>

        <label class="flex items-center gap-3 cursor-pointer select-none">
          <input
            type="checkbox"
            id="cc-news-toggle"
            checked={ccNewsSubscribed}
            class="h-4 w-4 text-indigo-600 rounded border-gray-300"
          />
          <span class="text-sm text-gray-800">Chci dostávat e-maily „Novinky v Claude Code“</span>
        </label>

        <div id="cc-news-result" class="mt-3 text-sm" aria-live="polite"></div>
      </div>

      <div class="border border-red-200 rounded-lg p-6 bg-red-50">
        <h2 class="text-lg font-semibold text-red-800 mb-2">Smazat účet</h2>
        <p class="text-sm text-red-700 mb-4">
          Trvale odstraníme váš profil, přihlašovací údaje a postup ve kurzech.
          Tuto akci nelze vrátit zpět. Vystavené účetní doklady zůstávají
          archivované ze zákona, ale bez vašich osobních údajů.
        </p>

        <button
          type="button"
          id="delete-account-btn"
          class="bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700 text-sm"
        >
          Smazat účet…
        </button>

        <div id="delete-account-result" class="mt-4 text-sm" aria-live="polite"></div>
      </div>
    </section>

    <script
      dangerouslySetInnerHTML={{
        __html: `
        (function () {
          var toggle = document.getElementById('cc-news-toggle');
          var ccResult = document.getElementById('cc-news-result');
          if (toggle) {
            toggle.addEventListener('change', function () {
              var subscribed = toggle.checked;
              toggle.disabled = true;
              ccResult.textContent = 'Ukládám…';
              ccResult.style.color = '#6b7280';
              fetch('/api/profile/cc-news', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ subscribed: subscribed })
              })
                .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); })
                .then(function (res) {
                  if (res.ok && res.body && res.body.ok) {
                    ccResult.style.color = '#15803d';
                    ccResult.textContent = subscribed
                      ? 'Odběr zapnut — Novinky vám budeme posílat.'
                      : 'Odběr vypnut — Novinky vám už posílat nebudeme.';
                  } else {
                    toggle.checked = !subscribed;
                    ccResult.style.color = '#b91c1c';
                    ccResult.textContent = 'Nepodařilo se uložit. Zkuste to prosím znovu.';
                  }
                })
                .catch(function () {
                  toggle.checked = !subscribed;
                  ccResult.style.color = '#b91c1c';
                  ccResult.textContent = 'Nastala chyba. Zkuste to prosím znovu.';
                })
                .finally(function () { toggle.disabled = false; });
            });
          }

          var btn = document.getElementById('delete-account-btn');
          var result = document.getElementById('delete-account-result');
          if (!btn) return;
          btn.addEventListener('click', function () {
            if (!window.confirm('Opravdu chcete trvale smazat svůj účet? Pošleme vám potvrzovací e-mail.')) return;
            btn.disabled = true;
            btn.textContent = 'Odesílám…';
            fetch('/api/profile/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' } })
              .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); })
              .then(function (res) {
                if (res.ok && res.body && res.body.pending) {
                  result.innerHTML = '<span style="color:#15803d">Poslali jsme vám potvrzovací e-mail. Klikněte v něm na odkaz pro dokončení smazání (platí 15 minut).</span>';
                } else if (res.body && res.body.error === 'admin_cannot_self_delete') {
                  result.innerHTML = '<span style="color:#b91c1c">Administrátorský účet nelze smazat samoobslužně.</span>';
                  btn.style.display = 'none';
                } else {
                  result.innerHTML = '<span style="color:#b91c1c">E-mail se nepodařilo odeslat. Zkuste to prosím znovu.</span>';
                  btn.disabled = false;
                  btn.textContent = 'Smazat účet…';
                }
              })
              .catch(function () {
                result.innerHTML = '<span style="color:#b91c1c">Nastala chyba. Zkuste to prosím znovu.</span>';
                btn.disabled = false;
                btn.textContent = 'Smazat účet…';
              });
          });
        })();
        `,
      }}
    />
  </Layout>
);
