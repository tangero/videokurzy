import type { FC } from "hono/jsx";
import { PRICE_INDIVIDUAL, PRICE_ORGANIZATION } from "../config/payment";

// ─── Mezistránka: výběr platební metody ────────────────────────

export interface CheckoutPrefillCompany {
  companyName?: string;
  companyIco?: string;
  companyDic?: string;
  companyAddress?: string;
  companyCity?: string;
  companyZip?: string;
  contactName?: string;
}

export const CheckoutSelect: FC<{
  type: "individual" | "organization";
  error?: string;
  prefillEmail?: string;
  prefillDomain?: string;
  prefillCode?: string;
  prefillCompany?: CheckoutPrefillCompany;
  prefillBilling?: boolean;
  priceOriginal?: number;
  priceFinal?: number;
  discountPercent?: number;
  discountLabel?: string;
  showCodeInput?: boolean;
}> = ({
  type,
  error,
  prefillEmail,
  prefillDomain,
  prefillCode,
  prefillCompany,
  prefillBilling = false,
  priceOriginal,
  priceFinal,
  discountPercent = 0,
  discountLabel,
  showCodeInput = false,
}) => {
  const isOrg = type === "organization";
  const original = priceOriginal ?? (isOrg ? PRICE_ORGANIZATION : PRICE_INDIVIDUAL);
  const final = priceFinal ?? original;
  const hasDiscount = discountPercent > 0 && final < original;
  const originalFormatted = original.toLocaleString("cs-CZ");
  const finalFormatted = final.toLocaleString("cs-CZ");
  const title = isOrg ? "Firemní licence" : "Roční přístup";
  const subtitle = isOrg
    ? "Všichni zaměstnanci s firemním emailem."
    : "Přístup ke všem kurzům pro jednu osobu.";

  return (
    <section class="max-w-md mx-auto px-4 py-16">
      <div class="bg-white border border-gray-200 rounded-xl p-8 shadow-sm">
        <h1 class="text-2xl font-bold text-gray-900 mb-1">{title}</h1>
        <p class="text-gray-600 mb-6">
          {hasDiscount ? (
            <>
              <strong>{finalFormatted} Kč</strong>
              <span class="ml-2 text-gray-400 line-through">{originalFormatted} Kč</span>
              <span class="ml-2 inline-block px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-xs font-semibold">
                {discountLabel || `Sleva ${discountPercent} %`}
              </span>
              <span class="block text-xs text-gray-500 mt-1">/ rok — {subtitle}</span>
            </>
          ) : (
            <>
              {originalFormatted} Kč / rok — {subtitle}
            </>
          )}
        </p>

        {error && (
          <div class="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 text-sm text-red-700">
            {error}
          </div>
        )}

        <form method="post" hx-boost="false" class="space-y-5">
          <div>
            <label for="email" class="block text-sm font-medium text-gray-700 mb-1">E-mail</label>
            <input
              type="email"
              id="email"
              name="email"
              required
              value={prefillEmail ?? ""}
              placeholder={isOrg ? "jan@firma.cz" : "vas@email.cz"}
              class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>

          {isOrg && (
            <div>
              <label for="domain" class="block text-sm font-medium text-gray-700 mb-1">Firemní doména</label>
              <input
                type="text"
                id="domain"
                name="domain"
                required
                value={prefillDomain ?? ""}
                placeholder="firma.cz"
                class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              />
              <p class="text-xs text-gray-500 mt-1">
                Freemailové domény (gmail.com, seznam.cz…) nelze použít.
              </p>
            </div>
          )}

          <fieldset class="space-y-3">
            <legend class="block text-sm font-medium text-gray-700 mb-2">Způsob platby</legend>

            <label class="flex items-start gap-3 p-3 border border-gray-200 rounded-lg cursor-pointer hover:border-indigo-400 has-[:checked]:border-indigo-500 has-[:checked]:bg-indigo-50">
              <input type="radio" name="paymentMethod" value="stripe" checked class="mt-1" />
              <div>
                <div class="font-medium text-gray-900">Platba kartou</div>
                <div class="text-xs text-gray-500">Okamžitá aktivace přes Stripe Checkout.</div>
              </div>
            </label>

            <label class="flex items-start gap-3 p-3 border border-gray-200 rounded-lg cursor-pointer hover:border-indigo-400 has-[:checked]:border-indigo-500 has-[:checked]:bg-indigo-50">
              <input type="radio" name="paymentMethod" value="fio" class="mt-1" />
              <div>
                <div class="font-medium text-gray-900">QR platba bankovním převodem</div>
                <div class="text-xs text-gray-500">QR kód pro Českou banku, splatnost 7 dní.</div>
              </div>
            </label>
          </fieldset>

          <label class="flex items-start gap-2 text-sm text-gray-700">
            <input type="checkbox" name="extendedDeadline" value="1" class="mt-0.5" />
            <span>
              <strong>Prodloužená splatnost</strong> (pro firemní zpracování) — 21 dní místo 7.
              <span class="block text-xs text-gray-500">Týká se pouze platby převodem.</span>
            </span>
          </label>

          <details open={prefillBilling || !!prefillCompany?.companyIco}>
            <summary class="cursor-pointer text-sm text-indigo-600 hover:underline">
              Chci fakturu na firmu (IČO)
            </summary>
            <div class="mt-3 space-y-3">
              <label class="flex items-center gap-2 text-sm">
                <input type="checkbox" id="billingEnabled" name="billingEnabled" value="1" checked={prefillBilling || !!prefillCompany?.companyIco} />
                <span>Vystavit fakturu na firmu</span>
              </label>

              <div id="billing-fields" class={prefillBilling || prefillCompany?.companyIco ? "space-y-3" : "space-y-3 hidden"}>
                <div>
                  <label for="of-ico" class="block text-xs font-medium text-gray-700 mb-1">IČO</label>
                  <div class="flex gap-2">
                    <input
                      type="text"
                      id="of-ico"
                      name="companyIco"
                      value={prefillCompany?.companyIco ?? ""}
                      placeholder="12345678"
                      autocomplete="off"
                      class="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
                    />
                    <span id="of-ares-status" class="text-xs text-gray-500 self-center"></span>
                  </div>
                </div>
                <div>
                  <label for="of-company" class="block text-xs font-medium text-gray-700 mb-1">Název firmy</label>
                  <div class="flex gap-2">
                    <input
                      type="text"
                      id="of-company"
                      name="companyName"
                      value={prefillCompany?.companyName ?? ""}
                      placeholder="Acme s.r.o."
                      autocomplete="organization"
                      class="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
                    />
                    <button type="button" id="of-name-search" class="px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">
                      Hledat v ARES
                    </button>
                  </div>
                  <div id="of-name-results" class="hidden mt-2 border border-gray-200 rounded-lg divide-y"></div>
                </div>
                <div>
                  <label for="of-dic" class="block text-xs font-medium text-gray-700 mb-1">DIČ (volitelné)</label>
                  <input
                    type="text"
                    id="of-dic"
                    name="companyDic"
                    value={prefillCompany?.companyDic ?? ""}
                    placeholder="CZ12345678"
                    class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label for="of-address" class="block text-xs font-medium text-gray-700 mb-1">Sídlo (ulice a č.p.)</label>
                  <input
                    type="text"
                    id="of-address"
                    name="companyAddress"
                    value={prefillCompany?.companyAddress ?? ""}
                    placeholder="Hlavní 123"
                    autocomplete="street-address"
                    class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div class="grid grid-cols-2 gap-3">
                  <div>
                    <label for="of-zip" class="block text-xs font-medium text-gray-700 mb-1">PSČ</label>
                    <input
                      type="text"
                      id="of-zip"
                      name="companyZip"
                      value={prefillCompany?.companyZip ?? ""}
                      placeholder="110 00"
                      autocomplete="postal-code"
                      class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  <div>
                    <label for="of-city" class="block text-xs font-medium text-gray-700 mb-1">Město</label>
                    <input
                      type="text"
                      id="of-city"
                      name="companyCity"
                      value={prefillCompany?.companyCity ?? ""}
                      placeholder="Praha"
                      autocomplete="address-level2"
                      class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                </div>
                <div>
                  <label for="of-contact" class="block text-xs font-medium text-gray-700 mb-1">Kontaktní osoba (volitelné)</label>
                  <input
                    type="text"
                    id="of-contact"
                    name="contactName"
                    value={prefillCompany?.contactName ?? ""}
                    placeholder="Jan Novák"
                    autocomplete="name"
                    class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <p class="text-xs text-gray-500">
                  Pro FIO převod vystavíme zálohový doklad ihned. Daňový doklad (fakturu) pošleme po přijetí platby.
                </p>
              </div>
            </div>
          </details>

          {showCodeInput && (
            <details open={!!prefillCode}>
              <summary class="cursor-pointer text-sm text-indigo-600 hover:underline">
                Mám zaváděcí kód
              </summary>
              <div class="mt-2">
                <input
                  type="text"
                  name="promoCode"
                  value={prefillCode ?? ""}
                  placeholder="LAUNCH2026"
                  class="w-full px-4 py-2 border border-gray-300 rounded-lg uppercase font-mono text-sm focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </details>
          )}

          <button
            type="submit"
            class={`w-full font-bold px-6 py-4 rounded-xl text-white text-lg shadow-lg transition-all active:scale-95 ${
              isOrg
                ? "bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 shadow-amber-200"
                : "bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 shadow-indigo-200"
            }`}
          >
            Objednat — {finalFormatted} Kč
          </button>
        </form>

        <p class="text-xs text-gray-400 text-center mt-4">
          Přístup na 12 měsíců ke všem kurzům na platformě.
        </p>
      </div>
      <script dangerouslySetInnerHTML={{ __html: aresScript }} />
    </section>
  );
};

// Vanilla JS pro toggle billing sekce + ARES lookup. Inlining drží UI závislosti
// nulové (žádný htmx, žádný React). Debounce 400 ms, IČO auto-lookup při 8 číslicích.
const aresScript = `
(function() {
  const billingEnabled = document.getElementById('billingEnabled');
  const billingFields = document.getElementById('billing-fields');
  const icoInput = document.getElementById('of-ico');
  const nameInput = document.getElementById('of-company');
  const nameSearchBtn = document.getElementById('of-name-search');
  const status = document.getElementById('of-ares-status');
  const results = document.getElementById('of-name-results');

  if (!billingEnabled || !billingFields) return;

  billingEnabled.addEventListener('change', () => {
    billingFields.classList.toggle('hidden', !billingEnabled.checked);
  });

  function fill(c) {
    if (c.company_name) document.getElementById('of-company').value = c.company_name;
    if (c.ico) icoInput.value = c.ico;
    if (c.dic) document.getElementById('of-dic').value = c.dic;
    if (c.address) document.getElementById('of-address').value = c.address;
    if (c.city) document.getElementById('of-city').value = c.city;
    if (c.zip) document.getElementById('of-zip').value = c.zip;
  }

  let icoTimer = null;
  icoInput && icoInput.addEventListener('input', () => {
    if (icoTimer) clearTimeout(icoTimer);
    const v = icoInput.value.trim().replace(/\\s/g, '');
    if (!/^\\d{7,8}$/.test(v)) { status.textContent = ''; return; }
    icoTimer = setTimeout(async () => {
      status.textContent = 'Načítám…';
      try {
        const r = await fetch('/api/ares-lookup?ico=' + encodeURIComponent(v));
        const data = await r.json();
        if (data.results && data.results.length === 1) {
          fill(data.results[0]);
          status.textContent = '✓ ARES';
          status.style.color = '#059669';
        } else {
          status.textContent = 'Nenalezeno';
          status.style.color = '#dc2626';
        }
      } catch (e) {
        status.textContent = 'Chyba';
        status.style.color = '#dc2626';
      }
    }, 400);
  });

  nameSearchBtn && nameSearchBtn.addEventListener('click', async () => {
    const q = nameInput.value.trim();
    if (q.length < 3) { status.textContent = 'Min. 3 znaky'; return; }
    status.textContent = 'Hledám…';
    status.style.color = '#6b7280';
    try {
      const r = await fetch('/api/ares-lookup?name=' + encodeURIComponent(q));
      const data = await r.json();
      const arr = data.results || [];
      results.innerHTML = '';
      if (arr.length === 0) { status.textContent = 'Nic'; results.classList.add('hidden'); return; }
      status.textContent = arr.length + ' výsledků';
      arr.forEach((c) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'w-full text-left px-3 py-2 hover:bg-gray-50 text-sm';
        btn.innerHTML = '<strong>' + (c.company_name || '?') + '</strong><br><span class="text-xs text-gray-500">IČO ' + (c.ico || '') + (c.city ? ', ' + c.city : '') + '</span>';
        btn.addEventListener('click', () => {
          fill(c);
          results.classList.add('hidden');
          status.textContent = '✓ Vybráno';
          status.style.color = '#059669';
        });
        results.appendChild(btn);
      });
      results.classList.remove('hidden');
    } catch (e) {
      status.textContent = 'Chyba';
      status.style.color = '#dc2626';
    }
  });
})();
`;

// ─── FIO platební stránka = živý zálohový doklad ──────────────
// Stránka /checkout/pay/:vs slouží jako "zálohový doklad pro účtárnu" + QR
// platba + tlačítko k ověření. Uživatel hned vidí firmu (dodavatele) i sebe
// (odběratele), položku, číslo dokladu. Pro tisk/PDF je k dispozici čistá
// verze na /checkout/proforma/:vs (bez navigace/tlačítek).

export interface PaymentDetailsProps {
  variableSymbol: string;
  amount: number;
  account: string;
  iban: string;
  bic: string;
  qrSvg: string;
  type: "individual" | "organization";
  email: string;
  domain?: string;
  dueDate: string;
  issueDate: string;
  isExtended: boolean;
  proformaNumber: string | null;
  // Dodavatel
  supplier: {
    name: string;
    address: string;
    city: string;
    zip: string;
    ico: string;
    email: string;
  };
  // Odběratel (volitelný)
  companyName?: string | null;
  companyIco?: string | null;
  companyDic?: string | null;
  companyAddress?: string | null;
  companyCity?: string | null;
  companyZip?: string | null;
  contactName?: string | null;
}

export const PaymentDetails: FC<PaymentDetailsProps> = (p) => {
  const formattedAmount = p.amount.toLocaleString("cs-CZ");
  const deadlineLabel = p.isExtended ? "21 dní (prodloužená splatnost)" : "7 dní";
  const itemLabel = p.type === "organization"
    ? `Roční přístup ke kurzům — firemní licence${p.domain ? ` (${p.domain})` : ""}`
    : "Roční přístup ke kurzům — osobní předplatné";
  const hasBuyer = !!(p.companyName || p.companyIco);

  return (
    <section class="max-w-3xl mx-auto px-4 py-10">
      <div class="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
        {/* Hlavička */}
        <div class="bg-indigo-50 border-b border-indigo-100 px-6 py-5 flex items-center justify-between">
          <div>
            <h1 class="text-xl font-bold text-gray-900">
              Zálohový doklad{p.proformaNumber ? ` ${p.proformaNumber}` : ""}
            </h1>
            <p class="text-xs text-gray-600 mt-0.5">
              Není daňovým dokladem. Fakturu (daňový doklad) zašleme po přijetí platby.
            </p>
          </div>
          <div class="text-right text-xs text-gray-600">
            <div>Vystaveno: <strong>{p.issueDate}</strong></div>
            <div>Splatnost: <strong>{p.dueDate}</strong></div>
          </div>
        </div>

        {/* Dodavatel + Odběratel */}
        <div class="grid md:grid-cols-2 gap-4 px-6 py-5 border-b border-gray-100">
          <div>
            <h3 class="text-[11px] uppercase tracking-wider text-gray-500 font-semibold mb-2">Dodavatel</h3>
            <p class="font-semibold text-gray-900">{p.supplier.name}</p>
            <p class="text-sm text-gray-700">{p.supplier.address}</p>
            <p class="text-sm text-gray-700">{p.supplier.zip} {p.supplier.city}</p>
            <p class="text-sm text-gray-700">IČO: {p.supplier.ico}</p>
            <p class="text-sm text-gray-700">{p.supplier.email}</p>
            <p class="text-xs text-gray-500 mt-1">Neplátce DPH.</p>
          </div>
          <div>
            <h3 class="text-[11px] uppercase tracking-wider text-gray-500 font-semibold mb-2">Odběratel</h3>
            {hasBuyer ? (
              <>
                {p.companyName && <p class="font-semibold text-gray-900">{p.companyName}</p>}
                {p.companyAddress && <p class="text-sm text-gray-700">{p.companyAddress}</p>}
                {(p.companyZip || p.companyCity) && (
                  <p class="text-sm text-gray-700">{p.companyZip ?? ""} {p.companyCity ?? ""}</p>
                )}
                {p.companyIco && <p class="text-sm text-gray-700">IČO: {p.companyIco}</p>}
                {p.companyDic && <p class="text-sm text-gray-700">DIČ: {p.companyDic}</p>}
                {p.contactName && <p class="text-sm text-gray-700 mt-1">{p.contactName}</p>}
                <p class="text-sm text-gray-700">{p.email}</p>
              </>
            ) : (
              <>
                <p class="text-sm text-gray-700">{p.email}</p>
                <p class="text-xs text-gray-500 mt-1">Fyzická osoba — nezadáno IČO.</p>
              </>
            )}
          </div>
        </div>

        {/* Položka + Celkem */}
        <div class="px-6 py-5 border-b border-gray-100">
          <div class="flex items-start justify-between gap-4">
            <div class="flex-1">
              <p class="text-sm text-gray-900">{itemLabel}</p>
              <p class="text-xs text-gray-500 mt-1">VS pro účetní párování: {p.variableSymbol}</p>
            </div>
            <div class="text-right">
              <p class="text-lg font-bold text-gray-900">{formattedAmount} Kč</p>
            </div>
          </div>
        </div>

        {/* QR + platební údaje */}
        <div class="grid md:grid-cols-2 gap-6 px-6 py-6 bg-gray-50 border-b border-gray-100">
          <div class="flex flex-col items-center justify-center">
            <div class="bg-white p-3 rounded-lg border border-gray-200" dangerouslySetInnerHTML={{ __html: p.qrSvg }} />
            <p class="text-xs text-gray-500 mt-2">Naskenujte v bankovní aplikaci</p>
          </div>
          <div class="space-y-2">
            <p class="text-sm font-semibold text-gray-900">Platba převodem</p>
            <PaymentRow label="Číslo účtu" value={p.account} />
            <PaymentRow label="IBAN" value={p.iban} />
            <PaymentRow label="BIC / SWIFT" value={p.bic} />
            <PaymentRow label="Částka" value={`${formattedAmount} Kč`} copyValue={String(p.amount)} />
            <PaymentRow label="Variabilní symbol" value={p.variableSymbol} />
          </div>
        </div>

        {/* Splatnost note */}
        <div class="px-6 py-4 bg-amber-50 border-b border-amber-100">
          <p class="text-sm text-amber-900">
            <strong>Splatnost {deadlineLabel}</strong> — uhraďte do <strong>{p.dueDate}</strong>.
            Po uplynutí lhůty bude objednávka automaticky zrušena.
          </p>
        </div>

        {/* Akce */}
        <div class="px-6 py-5">
          <div id="verify-result"></div>
          <div class="flex flex-col sm:flex-row gap-3">
            <button
              hx-post={`/api/fio/verify/${p.variableSymbol}`}
              hx-target="#verify-result"
              hx-swap="innerHTML"
              class="flex-1 bg-green-600 text-white font-semibold px-6 py-3 rounded-lg hover:bg-green-700 transition-colors"
            >
              Ověřit platbu
            </button>
            {p.proformaNumber && (
              <a
                href={`/checkout/proforma/${p.variableSymbol}`}
                target="_blank"
                rel="noopener"
                class="flex-1 text-center bg-white border border-gray-300 text-gray-800 font-semibold px-6 py-3 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Stáhnout doklad pro účtárnu
              </a>
            )}
          </div>
          <p class="text-xs text-gray-500 text-center mt-3">
            Mezibankovní převody mohou trvat až několik hodin. Po přijetí platby vám pošleme přístup do kurzů a daňový doklad e-mailem na <strong>{p.email}</strong>.
          </p>
        </div>
      </div>
    </section>
  );
};

const PaymentRow: FC<{ label: string; value: string; copyValue?: string }> = ({ label, value, copyValue }) => {
  const copy = copyValue ?? value;
  return (
    <div class="flex items-center justify-between bg-gray-50 rounded-lg px-4 py-3">
      <div>
        <p class="text-xs text-gray-500">{label}</p>
        <p class="font-mono font-semibold text-gray-900">{value}</p>
      </div>
      <button
        type="button"
        onclick={`navigator.clipboard.writeText(${JSON.stringify(copy)}).then(()=>{this.textContent='OK';setTimeout(()=>this.textContent='Kopírovat',1500)})`}
        class="text-xs text-indigo-600 hover:text-indigo-800 font-medium px-2 py-1 rounded hover:bg-indigo-50"
      >
        Kopírovat
      </button>
    </div>
  );
};

// ─── Verify partials (htmx swap targets) ───────────────────────

export const VerifySuccess: FC<{ email: string }> = ({ email }) => (
  <div class="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
    <h3 class="font-semibold text-green-800 mb-1">Platba přijata!</h3>
    <p class="text-sm text-green-700 mb-3">Roční přístup byl aktivován. Přihlaste se magic linkem.</p>
    <a href={`/login?email=${encodeURIComponent(email)}`} class="inline-block bg-green-600 text-white font-semibold px-6 py-2 rounded-lg hover:bg-green-700 text-sm">
      Přihlásit se
    </a>
  </div>
);

export const VerifyNotFound: FC = () => (
  <div class="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4">
    <h3 class="font-semibold text-amber-800 mb-1">Platba zatím nepřijata</h3>
    <p class="text-sm text-amber-700">Mezibankovní převody mohou trvat až několik hodin. Zkuste ověření později.</p>
  </div>
);

export const VerifyError: FC<{ message: string }> = ({ message }) => (
  <div class="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
    <h3 class="font-semibold text-red-800 mb-1">Chyba ověření</h3>
    <p class="text-sm text-red-700">{message}</p>
  </div>
);

export const VerifyRateLimit: FC<{ waitSeconds: number }> = ({ waitSeconds }) => (
  <div class="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
    <p class="text-sm text-blue-700">
      Ověření je možné jednou za 30 sekund. Zkuste to za {waitSeconds} s.
    </p>
  </div>
);
