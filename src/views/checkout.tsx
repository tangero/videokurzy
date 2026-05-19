import type { FC } from "hono/jsx";
import { PRICE_INDIVIDUAL, PRICE_ORGANIZATION } from "../config/payment";

// ─── Mezistránka: výběr platební metody ────────────────────────

export const CheckoutSelect: FC<{
  type: "individual" | "organization";
  error?: string;
  prefillEmail?: string;
  prefillDomain?: string;
  prefillCode?: string;
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

        <form method="post" class="space-y-5">
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
            class={`w-full font-semibold px-6 py-3 rounded-lg text-white transition-colors ${
              isOrg ? "bg-amber-600 hover:bg-amber-700" : "bg-indigo-600 hover:bg-indigo-700"
            }`}
          >
            Pokračovat — {finalFormatted} Kč
          </button>
        </form>

        <p class="text-xs text-gray-400 text-center mt-4">
          Přístup na 12 měsíců ke všem kurzům na platformě.
        </p>
      </div>
    </section>
  );
};

// ─── FIO platební stránka s QR kódem ───────────────────────────

export const PaymentDetails: FC<{
  variableSymbol: string;
  amount: number;
  account: string;
  qrSvg: string;
  type: "individual" | "organization";
  email: string;
  domain?: string;
  dueDate: string; // „19. 4. 2026"
  isExtended: boolean;
}> = ({ variableSymbol, amount, account, qrSvg, type, email: _email, domain, dueDate, isExtended }) => {
  const formattedAmount = amount.toLocaleString("cs-CZ");
  const deadlineLabel = isExtended ? "21 dní (prodloužená splatnost)" : "7 dní";

  return (
    <section class="max-w-md mx-auto px-4 py-16">
      <div class="bg-white border border-gray-200 rounded-xl p-8 shadow-sm">
        <h1 class="text-2xl font-bold text-gray-900 mb-2 text-center">Platba bankovním převodem</h1>
        <p class="text-gray-600 text-center mb-6">
          {type === "organization" ? `Firemní licence pro doménu ${domain}` : "Roční přístup ke všem kurzům"}
        </p>

        <div class="flex justify-center mb-4">
          <div class="bg-white p-4 rounded-lg border border-gray-100 shadow-inner" dangerouslySetInnerHTML={{ __html: qrSvg }} />
        </div>
        <p class="text-center text-sm text-gray-500 mb-6">
          Naskenujte QR kód v mobilní aplikaci vaší banky
        </p>

        <div class="border-t border-gray-200 pt-6 space-y-3">
          <p class="text-center text-sm font-medium text-gray-700 mb-4">Nebo zadejte údaje ručně:</p>
          <PaymentRow label="Číslo účtu" value={account} />
          <PaymentRow label="Částka" value={`${formattedAmount} Kč`} copyValue={String(amount)} />
          <PaymentRow label="Variabilní symbol" value={variableSymbol} />
        </div>

        <div class="bg-amber-50 border border-amber-200 rounded-lg p-4 mt-6">
          <p class="text-sm text-amber-800">
            <strong>Splatnost {deadlineLabel}</strong> — platbu proveďte do <strong>{dueDate}</strong>.
            Po uplynutí lhůty bude objednávka automaticky zrušena.
          </p>
          <p class="text-xs text-amber-700 mt-2">
            Pro správné přiřazení platby pečlivě vyplňte variabilní symbol.
          </p>
        </div>

        <div class="mt-8 border-t border-gray-200 pt-6">
          <div id="verify-result"></div>
          <button
            hx-post={`/api/fio/verify/${variableSymbol}`}
            hx-target="#verify-result"
            hx-swap="innerHTML"
            class="w-full bg-green-600 text-white font-semibold px-6 py-3 rounded-lg hover:bg-green-700 transition-colors"
          >
            Ověřit platbu
          </button>
          <p class="text-xs text-gray-400 text-center mt-2">
            Mezibankovní převody mohou trvat až několik hodin.
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
