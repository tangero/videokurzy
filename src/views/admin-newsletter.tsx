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
    /** Markdown těla publikovaného článku pro editor oprav (null = nepublikováno). */
    bodyMarkdown: string | null;
    /** Má vydání čekající re-editovanou verzi ze zdroje (pendingContentHash)? */
    hasPending: boolean;
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

      {/* Seznam vydání — na mobilu horizontálně scrollovatelný, ať je dostupný
          i sloupec „Akce" (jinak ho overflow-hidden ořízne mimo obrazovku). */}
      <div class="bg-white rounded-lg border overflow-x-auto mb-8">
        <table class="w-full text-sm whitespace-nowrap">
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
                <td colspan={8} class="px-4 py-6 text-center text-gray-500 whitespace-normal">
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
                    title="Zařadí rozeslání newsletteru předplatitelům do fronty (běží na pozadí). Idempotentní — podruhé se nepošle bez vynucení."
                  >
                    Rozeslat newsletter
                  </button>
                )}
              </div>

              {selected.status === "published" && (
                <>
                  {/* Počet příjemců se načte JS po otevření vydání (#recipient-count). */}
                  <p id="recipient-count" class="text-sm text-gray-700 mt-3" aria-live="polite">
                    Zjišťuji počet příjemců…
                  </p>
                  <p class="text-xs text-gray-500 mt-1">
                    {selected.newsletterSentAt
                      ? `Newsletter byl rozeslán ${fmtDateTime(selected.newsletterSentAt)}. Opakované rozeslání pošle e-mail VŠEM znovu — potvrď v dialogu.`
                      : "Rozeslání proběhne jen jednou. Po spuštění běží na pozadí (fronta) — stránku můžeš zavřít. Reálné odeslání vyžaduje zapnuté brány (jinak dry-run)."}
                  </p>
                </>
              )}
              <div id="action-result" class="mt-3 text-sm" aria-live="polite"></div>
            </div>

            {/* Editor TĚLA článku — jen pro publikovaná vydání (oprava chyb).
                Přepíše živou verzi na /novinky-cc bez e-mailu a bez newsletteru. */}
            {selected.status === "published" && selected.bodyMarkdown !== null && (
              <div class="bg-white border rounded-lg p-5">
                <h3 class="text-sm font-semibold text-gray-900 mb-1">
                  Oprava těla článku
                </h3>
                <p class="text-xs text-gray-500 mb-3">
                  Úprava <strong>publikovaného</strong> markdownu článku na webu
                  /novinky-cc. Uložením vystavíš novou verzi <strong>okamžitě</strong>,
                  bez e-mailu a bez rozeslání newsletteru. První řádky s <code>---</code>
                  jsou YAML front matter (title, perex) — needituj jejich strukturu.
                </p>
                {selected.hasPending && (
                  <p class="text-xs text-amber-700 mb-3">
                    Pozor: vydání má čekající novější verzi ze zdroje (ke schválení
                    přes e-mail). Schválení té verze tvoji ruční opravu těla přepíše.
                  </p>
                )}
                <textarea
                  id="article-md"
                  rows={16}
                  class="w-full border border-gray-300 rounded px-3 py-2 font-mono text-xs"
                >{selected.bodyMarkdown}</textarea>
                <div class="flex items-center gap-3 mt-3">
                  <button
                    id="btn-save-article"
                    type="button"
                    class="text-sm bg-emerald-700 text-white px-4 py-2 rounded hover:bg-emerald-800"
                  >
                    Uložit a vystavit opravu
                  </button>
                  <button
                    id="btn-preview-article"
                    type="button"
                    class="text-sm bg-gray-600 text-white px-4 py-2 rounded hover:bg-gray-500"
                  >
                    Náhled článku
                  </button>
                  <span id="article-result" class="text-sm" aria-live="polite"></span>
                </div>
                {/* sandbox="" = statický náhled, žádný aktivní obsah. Skrytý,
                    dokud admin nepožádá o náhled. */}
                <iframe
                  id="article-preview-frame"
                  title="Náhled článku"
                  sandbox=""
                  class="w-full rounded border border-gray-200 bg-white mt-3 hidden"
                  style="min-height: 400px;"
                ></iframe>
              </div>
            )}
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

          // Počet příjemců: načti hned po otevření vydání, ať admin před kliknutím
          // vidí rozsah rozeslání (kolik reálně dostane e-mail + rozpad).
          var rcEl = $('recipient-count');
          function renderCounts(c) {
            if (!rcEl) return;
            rcEl.textContent =
              'Pošle se ' + c.willSend + ' příjemcům (z ' + c.eligible +
              ' způsobilých' + (c.suppressed ? ', ' + c.suppressed + ' odhlášeno' : '') + ').';
          }
          if (rcEl) {
            fetch('/admin/api/cc-news/recipients')
              .then(function (r) { return r.json(); })
              .then(function (j) {
                if (j && j.ok) renderCounts(j);
                else setText(rcEl, '#b91c1c', 'Počet příjemců se nepodařilo zjistit.');
              })
              .catch(function () { setText(rcEl, '#b91c1c', 'Počet příjemců se nepodařilo zjistit.'); });
          }

          var sendBtn = $('btn-send');
          if (sendBtn) {
            sendBtn.addEventListener('click', function () {
              var alreadySent = sendBtn.dataset.sent === '1';
              var msg = alreadySent
                ? 'Newsletter už BYL rozeslán. Opakované rozeslání pošle e-mail VŠEM předplatitelům ZNOVU. Pokračovat?'
                : 'Zařadit rozeslání newsletteru všem předplatitelům do fronty?';
              if (!window.confirm(msg)) return;
              var res = $('action-result');
              sendBtn.disabled = true;
              setText(res, '#6b7280', 'Zařazuji do fronty…');
              fetch('/admin/api/cc-news/send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ itemId: itemId, force: alreadySent })
              })
                .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); })
                .then(function (out) {
                  if (out.ok && out.body && out.body.ok) {
                    var b = out.body;
                    setText(res, '#15803d',
                      'Rozeslání zařazeno do fronty — běží na pozadí pro ' + b.willSend +
                      ' příjemců (z ' + b.eligible + ' způsobilých' +
                      (b.suppressed ? ', ' + b.suppressed + ' odhlášeno' : '') +
                      '). Stránku můžeš zavřít; stav rozeslání se projeví po obnovení. Načítám…');
                    setTimeout(function () { window.location.reload(); }, 2500);
                  } else {
                    setText(res, '#b91c1c', (out.body && out.body.message) || 'Zařazení do fronty selhalo.');
                    sendBtn.disabled = false;
                  }
                })
                .catch(function () {
                  setText(res, '#b91c1c', 'Chyba sítě.');
                  sendBtn.disabled = false;
                });
            });
          }

          // Editor těla publikovaného článku: náhled + uložení nové verze.
          var previewArticleBtn = $('btn-preview-article');
          if (previewArticleBtn) {
            previewArticleBtn.addEventListener('click', function () {
              var ta = $('article-md');
              var frame = $('article-preview-frame');
              previewArticleBtn.disabled = true;
              previewArticleBtn.textContent = 'Načítám…';
              fetch('/admin/api/cc-news/article-preview', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ markdown: ta ? ta.value : '' })
              })
                .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); })
                .then(function (out) {
                  if (out.ok && out.body && out.body.ok) {
                    frame.srcdoc = '<div style="font-family:sans-serif;max-width:680px;margin:0 auto;padding:16px;line-height:1.6">' + out.body.html + '</div>';
                    frame.classList.remove('hidden');
                  } else {
                    frame.srcdoc = '<p style="font-family:sans-serif;color:#b91c1c;padding:20px">Náhled selhal.</p>';
                    frame.classList.remove('hidden');
                  }
                })
                .catch(function () {
                  frame.srcdoc = '<p style="font-family:sans-serif;color:#b91c1c;padding:20px">Chyba sítě.</p>';
                  frame.classList.remove('hidden');
                })
                .finally(function () {
                  previewArticleBtn.disabled = false;
                  previewArticleBtn.textContent = 'Náhled článku';
                });
            });
          }

          var saveArticleBtn = $('btn-save-article');
          if (saveArticleBtn) {
            saveArticleBtn.addEventListener('click', function () {
              var ta = $('article-md');
              var res = $('article-result');
              if (!ta || !ta.value.trim()) {
                setText(res, '#b91c1c', 'Tělo nesmí být prázdné.');
                return;
              }
              if (!window.confirm('Vystavit opravené tělo článku na web /novinky-cc? Nová verze bude vidět okamžitě. Newsletter se NErozesílá.')) return;
              saveArticleBtn.disabled = true;
              setText(res, '#6b7280', 'Ukládám…');
              fetch('/admin/api/cc-news/article-body', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ itemId: itemId, markdown: ta.value })
              })
                .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); })
                .then(function (out) {
                  if (out.ok && out.body && out.body.ok) {
                    setText(res, '#15803d', 'Opravená verze vystavena na web.');
                  } else {
                    setText(res, '#b91c1c', (out.body && out.body.message) || 'Uložení selhalo.');
                  }
                })
                .catch(function () { setText(res, '#b91c1c', 'Chyba sítě.'); })
                .finally(function () { saveArticleBtn.disabled = false; });
            });
          }
        })();
        `,
        }}
      />
    )}
  </Layout>
);
