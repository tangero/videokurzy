import type { FC } from "hono/jsx";
import { Layout } from "./layout";
import { AdminNav } from "./admin-courses";
import { fmtDate, fmtDateTime } from "../lib/dates";

/** Jedno vydání v seznamu (odlehčený model, bez markdownu těla). */
export interface NewsletterItem {
  id: string;
  weekLabel: string | null;
  versionRange: string | null;
  status: string; // draft | approved | published
  slug: string | null;
  publishedAt: number | null; // epoch ms
  approvalEmailSentAt: number | null; // epoch ms — kdy odešel schvalovací e-mail
  newsletterSentAt: number | null; // epoch ms — kdy byl rozeslán newsletter
  hasEditorial: boolean;
}

export interface AdminNewsletterProps {
  user: { name: string | null; email: string };
  items: NewsletterItem[];
  /** Vybrané vydání (z ?item=). Null = nic nevybráno. */
  selected: {
    id: string;
    weekLabel: string | null;
    status: string;
    slug: string | null;
    editorialMarkdown: string;
    /** Má vydání uložený markdown těla (draft/published v KV)? */
    hasBody: boolean;
    newsletterSentAt: number | null; // epoch ms — kdy byl rozeslán newsletter
  } | null;
}

const statusBadge = (status: string): { label: string; cls: string } => {
  switch (status) {
    case "published":
      return { label: "publikováno", cls: "bg-green-100 text-green-800" };
    case "approved":
      return { label: "schváleno", cls: "bg-blue-100 text-blue-800" };
    default:
      return { label: "koncept", cls: "bg-gray-100 text-gray-600" };
  }
};


export const AdminNewsletterPage: FC<AdminNewsletterProps> = ({ user, items, selected }) => (
  <Layout title="Newsletter" user={user}>
    <section class="max-w-5xl mx-auto px-4 py-8">
      <h1 class="text-2xl font-bold mb-6">Admin</h1>
      <AdminNav active="/admin/newsletter" />

      <h2 class="text-lg font-semibold mb-1">Newsletter „Novinky v Claude Code"</h2>
      <p class="text-sm text-gray-500 mb-6">
        Vydání se detekují automaticky z whats-new digestu. Tady přidáš úvodník
        (jen do e-mailu), zkontroluješ náhled a publikuješ vydání na web.
      </p>

      {/* Seznam vydání */}
      <div class="bg-white rounded-lg border overflow-hidden mb-8">
        <table class="w-full text-sm">
          <thead class="bg-gray-50">
            <tr>
              <th class="px-4 py-2 text-left">Týden</th>
              <th class="px-4 py-2 text-left">Verze</th>
              <th class="px-4 py-2 text-left">Stav</th>
              <th class="px-4 py-2 text-left">Úvodník</th>
              <th class="px-4 py-2 text-left">Schvalovací e-mail</th>
              <th class="px-4 py-2 text-left">Publikováno</th>
              <th class="px-4 py-2 text-left">Rozesláno</th>
              <th class="px-4 py-2 text-right">Akce</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colspan={8} class="px-4 py-6 text-center text-gray-500">
                  Zatím žádné vydání. Vydání přibyde po detekci nového digestu
                  (cron, nebo tlačítko „Poslat ke schválení" na Přehledu).
                </td>
              </tr>
            ) : (
              items.map((it) => {
                const b = statusBadge(it.status);
                const isSel = selected?.id === it.id;
                return (
                  <tr class={isSel ? "bg-indigo-50" : ""}>
                    <td class="px-4 py-2 font-medium">{it.weekLabel ?? "—"}</td>
                    <td class="px-4 py-2 text-gray-500">{it.versionRange ?? "—"}</td>
                    <td class="px-4 py-2">
                      <span class={`px-2 py-0.5 rounded text-xs font-medium ${b.cls}`}>
                        {b.label}
                      </span>
                    </td>
                    <td class="px-4 py-2">
                      {it.hasEditorial ? (
                        <span class="text-green-700 text-xs">✓ má</span>
                      ) : (
                        <span class="text-gray-400 text-xs">—</span>
                      )}
                    </td>
                    <td class="px-4 py-2 text-xs text-gray-500">
                      {it.approvalEmailSentAt ? (
                        <span class="text-green-700">✓ {fmtDateTime(it.approvalEmailSentAt)}</span>
                      ) : (
                        <span class="text-gray-400">neodesláno</span>
                      )}
                    </td>
                    <td class="px-4 py-2 text-gray-500">{fmtDate(it.publishedAt)}</td>
                    <td class="px-4 py-2 text-xs text-gray-500">
                      {it.newsletterSentAt ? (
                        <span class="text-green-700">✓ {fmtDateTime(it.newsletterSentAt)}</span>
                      ) : (
                        <span class="text-gray-400">nerozesláno</span>
                      )}
                    </td>
                    <td class="px-4 py-2 text-right">
                      <a
                        href={`/admin/newsletter?item=${encodeURIComponent(it.id)}`}
                        class="text-indigo-600 hover:underline text-xs no-underline"
                      >
                        Otevřít →
                      </a>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Editor vybraného vydání */}
      {selected && (
        <div id="editor" class="grid gap-6 lg:grid-cols-2">
          {/* Levý sloupec: úvodník + akce */}
          <div class="space-y-6">
            <div class="bg-white border rounded-lg p-5">
              <h3 class="text-sm font-semibold text-gray-900 mb-1">
                Úvodník — {selected.weekLabel ?? "vydání"}
              </h3>
              <p class="text-xs text-gray-500 mb-3">
                Osobní komentář (markdown). Vloží se na začátek <strong>jen
                rozesílaného e-mailu</strong>, na web /novinky-cc se nezobrazí.
              </p>
              <textarea
                id="editorial-md"
                rows={10}
                class="w-full border border-gray-300 rounded px-3 py-2 font-mono text-sm"
                placeholder="Váš komentář k tomuto vydání…"
              >{selected.editorialMarkdown}</textarea>
              <div class="flex items-center gap-3 mt-3">
                <button
                  id="btn-save-editorial"
                  type="button"
                  class="text-sm bg-gray-900 text-white px-4 py-2 rounded hover:bg-gray-700"
                >
                  Uložit úvodník
                </button>
                <span id="editorial-result" class="text-sm" aria-live="polite"></span>
              </div>
            </div>

            <div class="bg-white border rounded-lg p-5">
              <h3 class="text-sm font-semibold text-gray-900 mb-3">Akce</h3>
              <div class="flex flex-wrap items-center gap-3">
                <button
                  id="btn-preview"
                  type="button"
                  class="text-sm bg-gray-600 text-white px-4 py-2 rounded hover:bg-gray-500"
                >
                  Načíst náhled e-mailu
                </button>
                {selected.status !== "published" ? (
                  <button
                    id="btn-publish"
                    type="button"
                    data-item={selected.id}
                    class="text-sm bg-emerald-700 text-white px-4 py-2 rounded hover:bg-emerald-800"
                    title="Zveřejní vydání v gated sekci /novinky-cc. Newsletter se tím nerozesílá."
                  >
                    Publikovat na web
                  </button>
                ) : selected.slug ? (
                  <a
                    href={`/novinky-cc/${encodeURIComponent(selected.slug)}`}
                    class="text-sm text-emerald-700 hover:underline no-underline"
                  >
                    Zobrazit publikované →
                  </a>
                ) : null}

                {/* Rozeslání jen pro publikované vydání (rozesíláme jen živý obsah). */}
                {selected.status === "published" && (
                  <button
                    id="btn-send"
                    type="button"
                    data-sent={selected.newsletterSentAt ? "1" : "0"}
                    class="text-sm bg-indigo-700 text-white px-4 py-2 rounded hover:bg-indigo-800"
                    title="Rozešle newsletter předplatitelům. Idempotentní — podruhé se nepošle bez vynucení."
                  >
                    Rozeslat newsletter
                  </button>
                )}
              </div>

              {selected.status === "published" && (
                <p class="text-xs text-gray-500 mt-3">
                  {selected.newsletterSentAt
                    ? `Newsletter byl rozeslán ${fmtDateTime(selected.newsletterSentAt)}. Opakované rozeslání pošle e-mail VŠEM znovu — potvrď v dialogu.`
                    : "Newsletter zatím nebyl rozeslán. Rozeslání proběhne jen jednou; reálné odeslání vyžaduje zapnuté brány (jinak dry-run)."}
                </p>
              )}
              <div id="action-result" class="mt-3 text-sm" aria-live="polite"></div>
            </div>
          </div>

          {/* Pravý sloupec: náhled e-mailu */}
          <div class="bg-white border rounded-lg p-5">
            <h3 class="text-sm font-semibold text-gray-900 mb-3">Náhled e-mailu</h3>
            {!selected.hasBody && (
              <p class="text-xs text-amber-700 mb-3">
                Toto vydání zatím nemá uložené tělo článku v úložišti — náhled
                ukáže jen úvodník. Tělo vznikne při zpracování konceptu.
              </p>
            )}
            {/* sandbox="" = žádné skripty/formuláře/navigace. Náhled je statický
                HTML newsletteru (markdown z externího digestu) — hloubková obrana
                proti případnému aktivnímu obsahu i v admin-only kontextu. */}
            <iframe
              id="preview-frame"
              title="Náhled newsletteru"
              sandbox=""
              class="w-full rounded border border-gray-200 bg-white"
              style="min-height: 520px;"
            ></iframe>
          </div>
        </div>
      )}
    </section>

    {selected && (
      <script
        dangerouslySetInnerHTML={{
          __html: `
        (function () {
          var itemId = ${JSON.stringify(selected.id)};
          var $ = function (id) { return document.getElementById(id); };

          function setText(el, color, text) {
            if (!el) return;
            el.style.color = color;
            el.textContent = text;
          }

          var saveBtn = $('btn-save-editorial');
          if (saveBtn) {
            saveBtn.addEventListener('click', function () {
              var ta = $('editorial-md');
              var res = $('editorial-result');
              saveBtn.disabled = true;
              setText(res, '#6b7280', 'Ukládám…');
              fetch('/admin/api/cc-news/editorial', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ itemId: itemId, markdown: ta.value })
              })
                .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); })
                .then(function (out) {
                  if (out.ok && out.body && out.body.ok) {
                    setText(res, '#15803d', ta.value.trim() ? 'Úvodník uložen.' : 'Úvodník smazán.');
                  } else {
                    setText(res, '#b91c1c', 'Uložení selhalo.');
                  }
                })
                .catch(function () { setText(res, '#b91c1c', 'Chyba sítě.'); })
                .finally(function () { saveBtn.disabled = false; });
            });
          }

          var previewBtn = $('btn-preview');
          if (previewBtn) {
            previewBtn.addEventListener('click', function () {
              var ta = $('editorial-md');
              var frame = $('preview-frame');
              previewBtn.disabled = true;
              previewBtn.textContent = 'Načítám…';
              fetch('/admin/api/cc-news/preview', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ itemId: itemId, markdown: ta ? ta.value : '' })
              })
                .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); })
                .then(function (out) {
                  if (out.ok && out.body && out.body.html) {
                    frame.srcdoc = out.body.html;
                  } else {
                    frame.srcdoc = '<p style="font-family:sans-serif;color:#b91c1c;padding:20px">Náhled selhal: ' + ((out.body && out.body.error) || 'neznámá chyba') + '</p>';
                  }
                })
                .catch(function () {
                  frame.srcdoc = '<p style="font-family:sans-serif;color:#b91c1c;padding:20px">Chyba sítě.</p>';
                })
                .finally(function () {
                  previewBtn.disabled = false;
                  previewBtn.textContent = 'Načíst náhled e-mailu';
                });
            });
            // Auto-načti náhled při otevření vydání.
            previewBtn.click();
          }

          var pubBtn = $('btn-publish');
          if (pubBtn) {
            pubBtn.addEventListener('click', function () {
              if (!window.confirm('Publikovat toto vydání na web /novinky-cc?')) return;
              var res = $('action-result');
              pubBtn.disabled = true;
              setText(res, '#6b7280', 'Publikuji…');
              fetch('/admin/api/cc-news/publish', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ itemId: itemId })
              })
                .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); })
                .then(function (out) {
                  if (out.ok && out.body && out.body.ok) {
                    setText(res, '#15803d', 'Publikováno. Načítám stránku…');
                    setTimeout(function () { window.location.reload(); }, 800);
                  } else {
                    setText(res, '#b91c1c', 'Publikace selhala: ' + ((out.body && out.body.error) || ''));
                    pubBtn.disabled = false;
                  }
                })
                .catch(function () {
                  setText(res, '#b91c1c', 'Chyba sítě.');
                  pubBtn.disabled = false;
                });
            });
          }

          var sendBtn = $('btn-send');
          if (sendBtn) {
            sendBtn.addEventListener('click', function () {
              var alreadySent = sendBtn.dataset.sent === '1';
              var msg = alreadySent
                ? 'Newsletter už BYL rozeslán. Opakované rozeslání pošle e-mail VŠEM předplatitelům ZNOVU. Pokračovat?'
                : 'Rozeslat newsletter všem předplatitelům?';
              if (!window.confirm(msg)) return;
              var res = $('action-result');
              sendBtn.disabled = true;
              setText(res, '#6b7280', 'Rozesílám…');
              fetch('/admin/api/cc-news/send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ itemId: itemId, force: alreadySent })
              })
                .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); })
                .then(function (out) {
                  if (out.ok && out.body && out.body.ok) {
                    var b = out.body;
                    var label = b.mode === 'dry-run'
                      ? 'Dry-run: reálně NEodesláno (' + b.recipientCount + ' příjemců). Zapni brány pro ostré odeslání.'
                      : 'Rozesláno: ' + b.delivered + '/' + b.recipientCount + ' doručeno' + (b.failed ? (', ' + b.failed + ' selhalo') : '') + '. Načítám stránku…';
                    setText(res, b.mode === 'dry-run' ? '#92400e' : '#15803d', label);
                    if (b.mode !== 'dry-run') setTimeout(function () { window.location.reload(); }, 1200);
                    else sendBtn.disabled = false;
                  } else {
                    setText(res, '#b91c1c', (out.body && out.body.message) || 'Rozeslání selhalo.');
                    sendBtn.disabled = false;
                  }
                })
                .catch(function () {
                  setText(res, '#b91c1c', 'Chyba sítě.');
                  sendBtn.disabled = false;
                });
            });
          }
        })();
        `,
        }}
      />
    )}
  </Layout>
);
