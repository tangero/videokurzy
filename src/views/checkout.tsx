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
              <span class="ml-2 text-gray-500 line-through" aria-hidden="true">{originalFormatted} Kč</span>
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

          <details open={prefillBilling || !!prefillCompany?.companyIco} class="border border-gray-200 rounded-lg">
            <summary data-chevron class="cursor-pointer text-sm font-medium text-gray-900 hover:bg-gray-50 px-4 py-3 list-none flex items-center gap-2 select-none">
              <span data-chevron-icon class="inline-block transition-transform duration-150" aria-hidden="true">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><path d="M3 1l5 5-5 5V1z"/></svg>
              </span>
              <span>Chci fakturu na firmu (IČO)</span>
            </summary>
            <div class="px-4 pb-4 pt-1 space-y-3">
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
                      inputmode="numeric"
                      class="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
                    />
                    <span id="of-ares-status" role="status" aria-live="polite" class="text-xs text-gray-700 self-center min-w-[64px]"></span>
                  </div>
                </div>
                <div>
                  <label for="of-company" class="block text-xs font-medium text-gray-700 mb-1">Název firmy</label>
                  <div class="flex flex-col sm:flex-row gap-2">
                    <input
                      type="text"
                      id="of-company"
                      name="companyName"
                      value={prefillCompany?.companyName ?? ""}
                      placeholder="Acme s.r.o."
                      autocomplete="organization"
                      class="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
                    />
                    <button type="button" id="of-name-search" class="px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 min-h-[44px] sm:min-h-0 sm:py-2">
                      Hledat v ARES
                    </button>
                  </div>
                  <div id="of-name-results" class="hidden mt-2 border border-gray-200 rounded-lg divide-y" role="listbox"></div>
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
                <p class="text-xs text-gray-700">
                  Pro FIO převod vystavíme zálohový doklad ihned. Daňový doklad (fakturu) pošleme po přijetí platby.
                </p>
              </div>
            </div>
          </details>

          {showCodeInput && (
            <details open={!!prefillCode} class="border border-gray-200 rounded-lg">
              <summary data-chevron class="cursor-pointer text-sm font-medium text-gray-900 hover:bg-gray-50 px-4 py-3 list-none flex items-center gap-2 select-none">
                <span data-chevron-icon class="inline-block transition-transform duration-150" aria-hidden="true">
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><path d="M3 1l5 5-5 5V1z"/></svg>
                </span>
                <span>Mám zaváděcí kód</span>
              </summary>
              <div class="px-4 pb-4">
                <input
                  type="text"
                  name="promoCode"
                  value={prefillCode ?? ""}
                  placeholder="LAUNCH2026"
                  class="w-full px-4 py-2 border border-gray-300 rounded-lg uppercase text-sm focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </details>
          )}

          <button
            type="submit"
            class={`btn btn-lg btn-block group text-lg shadow-lg transition-all duration-200 active:scale-[0.985] focus:outline-none focus:ring-2 focus:ring-offset-2 ${
              isOrg
                ? "bg-amber-600 hover:bg-amber-700 focus:ring-amber-500 shadow-amber-900/30"
                : "focus:ring-[color:var(--accent)] hover:shadow-xl"
            }`}
          >
            <span>Objednat — {finalFormatted} Kč</span>
            <span class="inline-flex items-center transition-transform duration-200 group-hover:translate-x-0.5">
              <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M14 5l7 7-7 7" />
              </svg>
            </span>
          </button>
        </form>

        <p class="text-xs text-gray-600 text-center mt-4">
          Přístup na 12 měsíců ke všem kurzům na platformě.
        </p>
      </div>
      <script src="/js/checkout.js" defer></script>
    </section>
  );
};

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
      <article class="bg-white border border-gray-200 rounded-xl overflow-hidden">
        {/* Hlavička */}
        <header class="px-6 py-5 flex flex-wrap items-baseline justify-between gap-4 border-b border-gray-100">
          <div>
            <h1 class="text-xl font-semibold text-gray-900">
              Zálohový doklad{p.proformaNumber ? ` ${p.proformaNumber}` : ""}
            </h1>
            <p class="text-xs text-gray-600 mt-1">
              Není daňovým dokladem. Fakturu pošleme po přijetí platby.
            </p>
          </div>
          <dl class="text-xs text-gray-700 grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5">
            <dt class="text-gray-600">Vystaveno</dt><dd class="font-medium">{p.issueDate}</dd>
            <dt class="text-gray-600">Splatnost</dt><dd class="font-medium">{p.dueDate}</dd>
          </dl>
        </header>

        {/* Dodavatel + Odběratel */}
        <section class="grid md:grid-cols-2 gap-x-8 gap-y-6 px-6 py-6 border-b border-gray-100">
          <div>
            <h3 class="text-[11px] uppercase tracking-wider text-gray-600 font-semibold mb-2">Dodavatel</h3>
            <p class="font-semibold text-gray-900">{p.supplier.name}</p>
            <p class="text-sm text-gray-700">{p.supplier.address}</p>
            <p class="text-sm text-gray-700">{p.supplier.zip} {p.supplier.city}</p>
            <p class="text-sm text-gray-700">IČO: <span class="font-mono">{p.supplier.ico}</span></p>
            <p class="text-sm text-gray-700">{p.supplier.email}</p>
            <p class="text-xs text-gray-600 mt-1">Neplátce DPH.</p>
          </div>
          <div>
            <h3 class="text-[11px] uppercase tracking-wider text-gray-600 font-semibold mb-2">Odběratel</h3>
            {hasBuyer ? (
              <>
                {p.companyName && <p class="font-semibold text-gray-900">{p.companyName}</p>}
                {p.companyAddress && <p class="text-sm text-gray-700">{p.companyAddress}</p>}
                {(p.companyZip || p.companyCity) && (
                  <p class="text-sm text-gray-700">{p.companyZip ?? ""} {p.companyCity ?? ""}</p>
                )}
                {p.companyIco && <p class="text-sm text-gray-700">IČO: <span class="font-mono">{p.companyIco}</span></p>}
                {p.companyDic && <p class="text-sm text-gray-700">DIČ: <span class="font-mono">{p.companyDic}</span></p>}
                {p.contactName && <p class="text-sm text-gray-700 mt-1">{p.contactName}</p>}
                <p class="text-sm text-gray-700">{p.email}</p>
              </>
            ) : (
              <>
                <p class="text-sm text-gray-700">{p.email}</p>
                <p class="text-xs text-gray-600 mt-1">Fyzická osoba — nezadáno IČO.</p>
              </>
            )}
          </div>
        </section>

        {/* Položka + Celkem */}
        <section class="px-6 py-5 border-b border-gray-100">
          <div class="flex items-start justify-between gap-4">
            <div class="flex-1">
              <p class="text-sm text-gray-900">{itemLabel}</p>
              <p class="text-xs text-gray-700 mt-1">
                VS pro účetní párování: <span class="font-mono">{p.variableSymbol}</span>
              </p>
            </div>
            <p class="text-lg font-semibold text-gray-900 whitespace-nowrap">{formattedAmount} Kč</p>
          </div>
        </section>

        {/* QR + platební údaje — plochá hierarchie, žádný vnitřní box */}
        <section class="grid md:grid-cols-[auto_1fr] gap-x-8 gap-y-5 px-6 py-6 border-b border-gray-100">
          <div class="flex flex-col items-center">
            <div dangerouslySetInnerHTML={{ __html: p.qrSvg }} />
            <p class="text-xs text-gray-700 mt-2">Naskenujte v bankovní aplikaci</p>
          </div>
          <dl class="divide-y divide-gray-100">
            <PaymentRow label="Číslo účtu" value={p.account} />
            <PaymentRow label="IBAN" value={p.iban} />
            <PaymentRow label="BIC / SWIFT" value={p.bic} />
            <PaymentRow label="Částka" value={`${formattedAmount} Kč`} copyValue={String(p.amount)} />
            <PaymentRow label="Variabilní symbol" value={p.variableSymbol} />
          </dl>
        </section>

        {/* Splatnost */}
        <aside class="px-6 py-4 bg-amber-50 border-b border-amber-100">
          <p class="text-sm text-amber-900">
            <strong>Splatnost {deadlineLabel}</strong> — uhraďte do <strong>{p.dueDate}</strong>.
            Po uplynutí lhůty bude objednávka automaticky zrušena.
          </p>
        </aside>

        {/* Akce */}
        <div class="px-6 py-5">
          <div id="verify-result"></div>
          <div class="flex flex-col sm:flex-row gap-3">
            <button
              hx-post={`/api/fio/verify/${p.variableSymbol}`}
              hx-target="#verify-result"
              hx-swap="innerHTML"
              class="flex-1 bg-emerald-700 text-white font-semibold px-6 py-3 rounded-lg hover:bg-emerald-800 transition-colors min-h-[44px]"
            >
              Ověřit platbu
            </button>
            {p.proformaNumber && (
              <a
                href={`/checkout/proforma/${p.variableSymbol}`}
                target="_blank"
                rel="noopener"
                class="flex-1 text-center bg-white border border-gray-300 text-gray-900 font-semibold px-6 py-3 rounded-lg hover:bg-gray-50 transition-colors min-h-[44px]"
              >
                Stáhnout doklad pro účtárnu
              </a>
            )}
          </div>
          <p class="text-xs text-gray-700 text-center mt-3">
            Mezibankovní převody mohou trvat až několik hodin. Po přijetí platby vám pošleme přístup do kurzů a daňový doklad e-mailem na <strong>{p.email}</strong>.
          </p>
        </div>
      </article>
      <script src="/js/checkout.js" defer></script>
    </section>
  );
};

const PaymentRow: FC<{ label: string; value: string; copyValue?: string }> = ({ label, value, copyValue }) => {
  const copy = copyValue ?? value;
  return (
    <div class="flex items-baseline justify-between gap-3 py-2.5">
      <dt class="text-xs text-gray-700 shrink-0">{label}</dt>
      <dd class="flex items-baseline gap-2 min-w-0">
        <span class="font-mono text-sm font-medium text-gray-900 truncate">{value}</span>
        <button
          type="button"
          data-copy={copy}
          class="text-xs text-indigo-700 hover:text-indigo-900 font-medium px-2 py-1 rounded hover:bg-indigo-50 min-h-[28px] shrink-0"
        >
          Kopírovat
        </button>
      </dd>
    </div>
  );
};

// ─── Verify partials (htmx swap targets) ───────────────────────

export const VerifySuccess: FC<{ email: string }> = ({ email }) => (
  <div class="bg-emerald-50 border border-emerald-200 rounded-lg p-4 mb-4" role="status" aria-live="polite">
    <h3 class="font-semibold text-emerald-900 mb-1">Platba přijata!</h3>
    <p class="text-sm text-emerald-900 mb-3">Roční přístup byl aktivován. Přihlaste se magic linkem.</p>
    <a href={`/login?email=${encodeURIComponent(email)}`} class="inline-block bg-emerald-700 text-white font-semibold px-6 py-2 rounded-lg hover:bg-emerald-800 text-sm min-h-[44px]">
      Přihlásit se
    </a>
  </div>
);

export const VerifyNotFound: FC = () => (
  <div class="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4" role="status" aria-live="polite">
    <h3 class="font-semibold text-amber-900 mb-1">Platba zatím nepřijata</h3>
    <p class="text-sm text-amber-900">Mezibankovní převody mohou trvat až několik hodin. Zkuste ověření později.</p>
  </div>
);

export const VerifyError: FC<{ message: string }> = ({ message }) => (
  <div class="bg-red-50 border border-red-200 rounded-lg p-4 mb-4" role="alert">
    <h3 class="font-semibold text-red-900 mb-1">Chyba ověření</h3>
    <p class="text-sm text-red-900">{message}</p>
  </div>
);

export const VerifyRateLimit: FC<{ waitSeconds: number }> = ({ waitSeconds }) => (
  <div class="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4" role="status" aria-live="polite">
    <p class="text-sm text-amber-900">
      Ověření je možné jednou za 30 sekund. Zkuste to za {waitSeconds} s.
    </p>
  </div>
);
