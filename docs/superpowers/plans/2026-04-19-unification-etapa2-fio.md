# Etapa 2: FIO Bank Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Přidat FIO Bank jako alternativní platební metodu vedle Stripe. Zákazník si na nové mezistránce vybere mezi kartou (Stripe) a QR převodem (FIO). B2C i B2B. FIO má 7denní splatnost (21 den s „prodlouženou splatností"). Renewal reminders 21/14/7/1 den před expirací.

**Architecture:** Nová vrstva `lib/fio.ts` + `lib/qr.ts` pro FIO API a QR generování. Nová `lib/email.ts` s brandovanými šablonami (odesílatel Andrea Maloveczká). Nové routes `checkout.tsx` (mezistránky + FIO payment page + verify endpoint) a `dev.tsx` (mock pro lokální testy). Rozšíření `scheduled.ts` o renewal reminder logiku. Migrace landing CTA z POST `/api/checkout/*` (staré Stripe-only) na GET `/checkout/*` (výběr metody).

**Tech Stack:** Cloudflare Workers + Hono + Drizzle + D1 + Better Auth + Tailwind v4 + uqr (QR) + Resend (email) + FIO Bank API (polling).

**Spec:** [2026-04-18-unification-design.md](../specs/2026-04-18-unification-design.md) §§ 3, 4, 5, 7, 8, 13
**Předchozí plán:** [Etapa 1 Foundation](./2026-04-18-unification-etapa1-foundation.md) — dokončen, mergnut do main.

---

## File Structure

### Nové soubory

| Cesta | Účel |
|---|---|
| `src/lib/fio.ts` | FIO API klient (matchPayment, generateVariableSymbol s prefixem "33", fetchFioTransactions, generateSPD) |
| `src/lib/qr.ts` | Server-side QR SVG generation přes `uqr` |
| `src/lib/email.ts` | Resend klient + brandované HTML šablony (purchase pending/confirmed, admin notification, B2B approved, renewal reminders ×4) |
| `src/lib/renewal-reminders.ts` | Logika cron jobu pro odeslání renewal reminderů 21/14/7/1 den před expirací |
| `src/views/checkout.tsx` | CheckoutSelect (mezistránka + radio + prodloužená splatnost), PaymentDetails (QR + splatnost warning), Verify partials |
| `src/routes/checkout.tsx` | GET/POST `/checkout/individual`, `/checkout/organization`, `/checkout/pay/:vs`, `POST /api/fio/verify/:vs` |
| `src/routes/dev.tsx` | `GET /dev/fio/pay/:vs` — dev mock pro simulaci přijaté FIO platby (podmíněno `env.FIO_API_TOKEN === "dev"`) |

### Modifikované soubory

| Cesta | Změna |
|---|---|
| `src/scheduled.ts` | Přidat volání `sendRenewalReminders` |
| `src/routes/admin.tsx` | Po approve organization poslat email kupujícímu |
| `src/routes/landing.tsx` | CTA buttony: form POST `/api/checkout/*` → odkazy GET `/checkout/*` |
| `src/views/landing.tsx` | Stejné — pokud HTML formuláře jsou v layoutu |
| `src/index.tsx` | Registrovat `checkoutRoutes`, `devRoutes` (v dev) |

---

## Task 1: `src/lib/fio.ts` + `src/lib/qr.ts`

**Files:**
- Create: `src/lib/fio.ts`
- Create: `src/lib/qr.ts`

**Context:** Porty z `videokurz-demo` s adaptací: `generateVariableSymbol` musí používat prefix `"33"` (z `config/payment.ts` `FIO_VS_PREFIX`). Ostatní kód se nemění — matching logic (VS + exact amount + CZK) a SPAYD generator.

- [ ] **Step 1: Vytvořit `src/lib/fio.ts`**

```typescript
// FIO Bank API utilities pro parování plateb videokurzy objednávek.
// Prefix VS = "33" (odlišeno od donations "11" a workshops "22" ve vibecoding-site).

import { FIO_VS_PREFIX } from "../config/payment";

export interface FioTransaction {
  column0: { value: string; name: string; id: number } | null;  // Datum
  column1: { value: number; name: string; id: number } | null;  // Objem
  column2: { value: string; name: string; id: number } | null;  // Protiucet
  column5: { value: string; name: string; id: number } | null;  // Variabilní symbol
  column10: { value: string; name: string; id: number } | null; // Název protiuctu
  column14: { value: string; name: string; id: number } | null; // Měna
  column16: { value: string; name: string; id: number } | null; // Zpráva pro přijemce
  column22: { value: number; name: string; id: number } | null; // ID pohybu
}

export interface FioApiResponse {
  accountStatement: {
    info: {
      accountId: string;
      bankId: string;
      currency: string;
      iban: string;
    };
    transactionList: {
      transaction: FioTransaction[];
    } | null;
  };
}

export interface PaymentMatchResult {
  found: boolean;
  transaction?: {
    id: number;
    date: string;
    amount: number;
    senderName: string | null;
  };
}

/**
 * Generuje variabilní symbol s prefixem "33" (videokurzy).
 * Výsledek je 8místný: "33" + 6 náhodných číslic (100000–999999).
 */
export function generateVariableSymbol(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  const num = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
  const tail = String(100000 + (num % 900000));
  return `${FIO_VS_PREFIX}${tail}`;
}

/** Vrací datumový rozsah pro dotaz na FIO API (dateFrom..dateTo inkluzivně). */
export function getFioDateRange(daysBack: number): { dateFrom: string; dateTo: string } {
  const now = new Date();
  const from = new Date(now.getTime() - daysBack * 86400000);
  return {
    dateFrom: from.toISOString().split("T")[0],
    dateTo: now.toISOString().split("T")[0],
  };
}

/**
 * Hledá odpovídající příchozí platbu v seznamu FIO transakcí.
 * Paruje podle: VS (bez leading zeros) + přesná částka + CZK + kladný objem.
 */
export function matchPayment(
  transactions: FioTransaction[],
  expectedVS: string,
  expectedAmount: number,
  excludeTransactionIds: Set<number> = new Set(),
): PaymentMatchResult {
  const normalizedExpectedVS = expectedVS.replace(/^0+/, "");

  for (const tx of transactions) {
    const amount = tx.column1?.value;
    const vs = tx.column5?.value?.replace(/^0+/, "") ?? "";
    const currency = tx.column14?.value;
    const txId = tx.column22?.value;

    if (!amount || amount <= 0) continue;
    if (txId == null) continue;
    if (excludeTransactionIds.has(txId)) continue;

    if (vs === normalizedExpectedVS && amount === expectedAmount && currency === "CZK") {
      return {
        found: true,
        transaction: {
          id: txId,
          date: tx.column0?.value ?? new Date().toISOString(),
          amount,
          senderName: tx.column10?.value ?? null,
        },
      };
    }
  }

  return { found: false };
}

/** Generuje český QR platební řetězec (SPD/SPAYD standard). */
export function generateSPD(
  iban: string,
  amount: number,
  vs: string,
  message: string = "Videokurz vibecoding",
): string {
  return `SPD*1.0*ACC:${iban}*AM:${amount.toFixed(2)}*CC:CZK*X-VS:${vs}*MSG:${message}`;
}

/**
 * Volá FIO API a vrací seznam transakcí.
 * V dev režimu (token === "dev") vrací prázdný seznam (platbu simuluj přes /dev/fio/pay).
 */
export async function fetchFioTransactions(
  token: string,
  daysBack: number,
): Promise<
  | { ok: true; transactions: FioTransaction[] }
  | { ok: false; error: string; status: number }
> {
  if (token === "dev") {
    return { ok: true, transactions: [] };
  }

  const { dateFrom, dateTo } = getFioDateRange(daysBack);
  const url = `https://fioapi.fio.cz/v1/rest/periods/${token}/${dateFrom}/${dateTo}/transactions.json`;

  const response = await fetch(url);

  if (response.status === 409) {
    return { ok: false, error: "rate_limit", status: 429 };
  }

  if (!response.ok) {
    return { ok: false, error: `FIO API error: ${response.status}`, status: 502 };
  }

  const data = (await response.json()) as FioApiResponse;
  const transactions = data.accountStatement?.transactionList?.transaction ?? [];
  return { ok: true, transactions };
}
```

- [ ] **Step 2: Vytvořit `src/lib/qr.ts`**

```typescript
// Server-side QR code SVG generation přes uqr (pure JS, edge-compatible).

import { encode } from "uqr";

/**
 * Generuje QR kód jako inline SVG řetězec.
 * ECC level "M" (Medium) — vyvážení robustnosti a velikosti.
 */
export function generateQRSvg(data: string, size: number = 240): string {
  const result = encode(data, { ecc: "M" });
  const modules = result.data;
  const moduleCount = modules.length;
  const cellSize = size / moduleCount;

  let paths = "";
  for (let row = 0; row < moduleCount; row++) {
    for (let col = 0; col < moduleCount; col++) {
      if (modules[row][col]) {
        const x = (col * cellSize).toFixed(2);
        const y = (row * cellSize).toFixed(2);
        const s = cellSize.toFixed(2);
        paths += `M${x},${y}h${s}v${s}h-${s}z`;
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}"><path d="${paths}" fill="#000"/></svg>`;
}
```

- [ ] **Step 3: Typecheck + commit**

```bash
cd /Users/patrickzandl/GitHub/videokurzy
npm run typecheck
git add src/lib/fio.ts src/lib/qr.ts
git commit -m "feat(fio): add FIO API client and QR code generator

- fio.ts: generateVariableSymbol (prefix 33), matchPayment, fetchFioTransactions, generateSPD
- qr.ts: server-side QR SVG via uqr (edge-compatible)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 2: `src/lib/email.ts` — základ + Resend klient

**Files:**
- Create: `src/lib/email.ts`

- [ ] **Step 1: Vytvořit `src/lib/email.ts` s Resend klientem + wrapper**

```typescript
// Email helper — odesílání brandovaných emailů přes Resend API.
// Odesílatel: Andrea Maloveczká <andrea@vibecoding.cz> (viz config/admin.ts)

import { EMAIL_FROM, EMAIL_REPLY_TO } from "../config/admin";
import type { Env } from "../types";

interface SendEmailOptions {
  to: string | string[];
  subject: string;
  html: string;
}

/** Odešle email přes Resend. Vrací true při úspěchu. */
export async function sendEmail(env: Env, opts: SendEmailOptions): Promise<boolean> {
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: EMAIL_FROM,
        reply_to: EMAIL_REPLY_TO,
        to: Array.isArray(opts.to) ? opts.to : [opts.to],
        subject: opts.subject,
        html: opts.html,
      }),
    });
    if (!res.ok) {
      console.error(`[email] Resend ${res.status}: ${await res.text()}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[email] sendEmail failed:", err);
    return false;
  }
}

/** Sdílený HTML wrapper s brandingem kurz.vibecoding.cz. */
function emailWrapper(content: string): string {
  return `<!DOCTYPE html>
<html lang="cs">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 520px; margin: 0 auto; padding: 40px 20px; color: #1a1a1a; background: #ffffff;">
  <div style="text-align: center; margin-bottom: 32px;">
    <h1 style="font-size: 20px; font-weight: 600; margin: 0;">kurz.vibecoding.cz</h1>
  </div>
  ${content}
  <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 32px 0;">
  <p style="font-size: 12px; color: #999; text-align: center;">
    kurz.vibecoding.cz &middot; Andrea Maloveczká &middot; Vibecoding.cz
  </p>
</body>
</html>`;
}

/** CTA tlačítko s primary barvou (indigo-600). */
function primaryButton(href: string, label: string): string {
  return `<div style="text-align: center; margin: 32px 0;">
    <a href="${href}" style="display: inline-block; background: #4f46e5; color: white; font-weight: 600; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-size: 16px;">
      ${label}
    </a>
  </div>`;
}

// ─── Šablony: purchase flow ─────────────────────────────────────

/** Po vytvoření pending FIO objednávky — instrukce k platbě. */
export function fioPendingHtml(payUrl: string, amount: number, dueDate: string): string {
  const formattedAmount = amount.toLocaleString("cs-CZ");
  return emailWrapper(`
    <p style="font-size: 16px; line-height: 1.5;">Děkujeme za objednávku!</p>
    <p style="font-size: 16px; line-height: 1.5;">Pro aktivaci přístupu uhraďte <strong>${formattedAmount} Kč</strong> bankovním převodem do <strong>${dueDate}</strong>.</p>
    ${primaryButton(payUrl, "Zobrazit platební údaje a QR kód")}
    <p style="font-size: 14px; color: #666; line-height: 1.5;">
      Po připsání platby na účet vám pošleme přihlašovací odkaz. Mezibankovní převody obvykle trvají 1 pracovní den.
    </p>`);
}

/** Po potvrzení platby — magic link k přihlášení. */
export function purchaseConfirmedHtml(loginUrl: string, type: "individual" | "organization"): string {
  const typeLabel = type === "organization" ? "firemní licence" : "roční přístup";
  return emailWrapper(`
    <p style="font-size: 16px; line-height: 1.5;">Platba přijata — ${typeLabel} je aktivní!</p>
    <p style="font-size: 16px; line-height: 1.5;">Přístup ke všem kurzům máte na 12 měsíců.</p>
    ${primaryButton(loginUrl, "Přihlásit se do kurzu")}
    <p style="font-size: 14px; color: #666; line-height: 1.5;">
      Dotazy? Odpovězte na tento email — píše vám Andrea Maloveczká.
    </p>`);
}

/** B2B — info o schválení domény adminem. */
export function organizationApprovedHtml(domain: string, loginUrl: string): string {
  return emailWrapper(`
    <p style="font-size: 16px; line-height: 1.5;">Firemní licence pro doménu <strong>${domain}</strong> byla schválena.</p>
    <p style="font-size: 16px; line-height: 1.5;">Kdokoliv s emailem na této doméně se nyní může přihlásit a získat přístup ke všem kurzům.</p>
    ${primaryButton(loginUrl, "Přihlásit se")}`);
}

/** Admin — notifikace o nové B2B objednávce. */
export function adminNewOrgHtml(domain: string, buyerEmail: string, paymentMethod: "stripe" | "fio", adminUrl: string): string {
  const paymentLabel = paymentMethod === "stripe" ? "Stripe (karta)" : "FIO (bankovní převod)";
  return emailWrapper(`
    <p style="font-size: 16px; line-height: 1.5;"><strong>Nová firemní objednávka</strong></p>
    <div style="background: #f9fafb; border-radius: 8px; padding: 16px; margin: 16px 0;">
      <p style="margin: 4px 0; font-size: 14px;"><strong>Doména:</strong> ${domain}</p>
      <p style="margin: 4px 0; font-size: 14px;"><strong>Email kupujícího:</strong> ${buyerEmail}</p>
      <p style="margin: 4px 0; font-size: 14px;"><strong>Způsob platby:</strong> ${paymentLabel}</p>
      <p style="margin: 4px 0; font-size: 14px;"><strong>Stav:</strong> Čeká na schválení</p>
    </div>
    ${primaryButton(adminUrl, "Otevřít administraci")}`);
}

// ─── Šablony: renewal reminders (21/14/7/1 den) ─────────────────

function renewalReminderHtml(daysLeft: number, renewUrl: string): string {
  const heading = daysLeft === 1
    ? "Poslední den k prodloužení přístupu"
    : `Váš přístup ke kurzům končí za ${daysLeft} ${daysLeft >= 5 ? "dní" : "dny"}`;
  const body = daysLeft === 1
    ? "Pokud dnes neuhradíte novou objednávku, zítra ztratíte přístup ke kurzům. Obnovte přístup během několika minut."
    : "Abyste si zachovali kontinuální přístup, vytvořte novou objednávku na další rok.";
  return emailWrapper(`
    <p style="font-size: 16px; line-height: 1.5;"><strong>${heading}</strong></p>
    <p style="font-size: 16px; line-height: 1.5;">${body}</p>
    ${primaryButton(renewUrl, "Obnovit přístup")}`);
}

export const renewal21Html = (renewUrl: string) => renewalReminderHtml(21, renewUrl);
export const renewal14Html = (renewUrl: string) => renewalReminderHtml(14, renewUrl);
export const renewal7Html = (renewUrl: string) => renewalReminderHtml(7, renewUrl);
export const renewal1Html = (renewUrl: string) => renewalReminderHtml(1, renewUrl);
```

- [ ] **Step 2: Typecheck + commit**

```bash
cd /Users/patrickzandl/GitHub/videokurzy
npm run typecheck
git add src/lib/email.ts
git commit -m "feat(email): add Resend client with branded templates

Templates: FIO pending, purchase confirmed, B2B organization approved,
admin notification, renewal reminders (21/14/7/1 day).
Sender: Andrea Maloveczká <andrea@vibecoding.cz>.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 3: `src/views/checkout.tsx` — mezistránka + payment page + verify partials

**Files:**
- Create: `src/views/checkout.tsx`

**Goal:** Tři komponenty v Tailwindu (přizpůsobené z demo):
1. `CheckoutSelect` — formulář mezistránky: email, (B2B doména), radio karta/převod, checkbox „Prodloužená splatnost", submit
2. `PaymentDetails` — FIO platební stránka: QR kód, platební údaje, upozornění na splatnost, tlačítko „Ověřit platbu" (htmx)
3. `VerifySuccess` / `VerifyNotFound` / `VerifyError` / `VerifyRateLimit` — htmx partials po kliknutí na ověření

- [ ] **Step 1: Vytvořit `src/views/checkout.tsx`**

```tsx
import type { FC } from "hono/jsx";
import { PRICE_INDIVIDUAL, PRICE_ORGANIZATION } from "../config/payment";

// ─── Mezistránka: výběr platební metody ────────────────────────

export const CheckoutSelect: FC<{
  type: "individual" | "organization";
  error?: string;
  prefillEmail?: string;
  prefillDomain?: string;
}> = ({ type, error, prefillEmail, prefillDomain }) => {
  const isOrg = type === "organization";
  const price = isOrg ? PRICE_ORGANIZATION : PRICE_INDIVIDUAL;
  const priceFormatted = price.toLocaleString("cs-CZ");
  const title = isOrg ? "Firemní licence" : "Roční přístup";
  const subtitle = isOrg
    ? "Všichni zaměstnanci s firemním emailem."
    : "Přístup ke všem kurzům pro jednu osobu.";

  return (
    <section class="max-w-md mx-auto px-4 py-16">
      <div class="bg-white border border-gray-200 rounded-xl p-8 shadow-sm">
        <h1 class="text-2xl font-bold text-gray-900 mb-1">{title}</h1>
        <p class="text-gray-600 mb-6">{priceFormatted} Kč / rok — {subtitle}</p>

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

          <button
            type="submit"
            class={`w-full font-semibold px-6 py-3 rounded-lg text-white transition-colors ${
              isOrg ? "bg-amber-600 hover:bg-amber-700" : "bg-indigo-600 hover:bg-indigo-700"
            }`}
          >
            Pokračovat — {priceFormatted} Kč
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
```

- [ ] **Step 2: Typecheck + commit**

```bash
cd /Users/patrickzandl/GitHub/videokurzy
npm run typecheck
git add src/views/checkout.tsx
git commit -m "feat(checkout): add Tailwind checkout views (select, payment, verify)

- CheckoutSelect: mezistránka s volbou platby + prodloužená splatnost
- PaymentDetails: FIO page s QR kódem, splatnost warning
- Verify*: htmx partials pro výsledek ověření

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 4: `src/routes/checkout.tsx` — mezistránky a Stripe/FIO dispatcher

**Files:**
- Create: `src/routes/checkout.tsx`

**Pattern:**
- `GET /checkout/individual` → render `<CheckoutSelect type="individual" />`
- `POST /checkout/individual` → parse form; if `paymentMethod=stripe` → Stripe Checkout session (stejný kód jako v `routes/stripe.tsx` ale přesunout sem); if `paymentMethod=fio` → vytvořit pending purchase, odeslat fioPending email, redirect na `/checkout/pay/:vs`
- Stejně pro `/checkout/organization` s tím, že před vytvořením pending se validuje doména proti freemail blacklistu. Navíc posílá admin notifikační email.
- Pro FIO po vytvoření pending purchase se vypočítá `expiresAt = now + (extended ? 21 : 7) days` a uloží se do purchase row.

- [ ] **Step 1: Vytvořit `src/routes/checkout.tsx`**

```tsx
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import Stripe from "stripe";
import type { Env, Variables } from "../types";
import { purchase, organization } from "../db/schema";
import {
  PAYMENT_ACCOUNT,
  PAYMENT_IBAN,
  PAYMENT_RECIPIENT,
  PRICE_INDIVIDUAL,
  PRICE_ORGANIZATION,
  FIO_DEFAULT_DUE_DAYS,
  FIO_EXTENDED_DUE_DAYS,
  FIO_RATE_LIMIT_MS,
  FIO_LOOKBACK_DAYS,
  ACCESS_DURATION_DAYS,
} from "../config/payment";
import { isFreemailDomain, FREEMAIL_REJECTION_MESSAGE } from "../config/freemail-domains";
import { ADMIN_EMAILS } from "../config/admin";
import {
  generateVariableSymbol,
  generateSPD,
  fetchFioTransactions,
  matchPayment,
} from "../lib/fio";
import { generateQRSvg } from "../lib/qr";
import { sendEmail, fioPendingHtml, purchaseConfirmedHtml, adminNewOrgHtml } from "../lib/email";
import { Layout } from "../views/layout";
import {
  CheckoutSelect,
  PaymentDetails,
  VerifySuccess,
  VerifyNotFound,
  VerifyError,
  VerifyRateLimit,
} from "../views/checkout";

const checkoutRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// ─── Helpers ─────────────────────────────────────────────────────

function getStripe(secretKey: string) {
  return new Stripe(secretKey, { apiVersion: "2026-03-25.dahlia" });
}

function formatDueDate(d: Date): string {
  return d.toLocaleDateString("cs-CZ", { day: "numeric", month: "long", year: "numeric" });
}

function emailDomain(email: string): string {
  return email.toLowerCase().split("@")[1] ?? "";
}

// ─── B2C: /checkout/individual ───────────────────────────────────

checkoutRoutes.get("/checkout/individual", (c) => {
  return c.html(
    <Layout title="Roční přístup — kurz.vibecoding.cz">
      <CheckoutSelect type="individual" />
    </Layout>
  );
});

checkoutRoutes.post("/checkout/individual", async (c) => {
  const form = await c.req.formData();
  const email = String(form.get("email") ?? "").toLowerCase().trim();
  const paymentMethod = String(form.get("paymentMethod") ?? "stripe");
  const extendedDeadline = form.get("extendedDeadline") === "1";

  if (!email || !email.includes("@")) {
    return c.html(
      <Layout title="Roční přístup">
        <CheckoutSelect type="individual" error="Zadejte platný email." prefillEmail={email} />
      </Layout>,
      400
    );
  }

  if (paymentMethod === "stripe") {
    return await startStripeCheckout(c, "individual", email, undefined);
  } else if (paymentMethod === "fio") {
    return await startFioCheckout(c, "individual", email, undefined, extendedDeadline);
  }

  return c.text("Neznámý způsob platby.", 400);
});

// ─── B2B: /checkout/organization ─────────────────────────────────

checkoutRoutes.get("/checkout/organization", (c) => {
  return c.html(
    <Layout title="Firemní licence — kurz.vibecoding.cz">
      <CheckoutSelect type="organization" />
    </Layout>
  );
});

checkoutRoutes.post("/checkout/organization", async (c) => {
  const form = await c.req.formData();
  const email = String(form.get("email") ?? "").toLowerCase().trim();
  const domainRaw = String(form.get("domain") ?? "").toLowerCase().trim();
  const paymentMethod = String(form.get("paymentMethod") ?? "stripe");
  const extendedDeadline = form.get("extendedDeadline") === "1";

  if (!email || !email.includes("@")) {
    return c.html(
      <Layout title="Firemní licence">
        <CheckoutSelect type="organization" error="Zadejte platný email." prefillEmail={email} prefillDomain={domainRaw} />
      </Layout>,
      400
    );
  }

  if (!domainRaw || !domainRaw.includes(".")) {
    return c.html(
      <Layout title="Firemní licence">
        <CheckoutSelect type="organization" error="Zadejte platnou firemní doménu (např. firma.cz)." prefillEmail={email} prefillDomain={domainRaw} />
      </Layout>,
      400
    );
  }

  if (isFreemailDomain(domainRaw)) {
    return c.html(
      <Layout title="Firemní licence">
        <CheckoutSelect type="organization" error={FREEMAIL_REJECTION_MESSAGE} prefillEmail={email} prefillDomain={domainRaw} />
      </Layout>,
      400
    );
  }

  if (paymentMethod === "stripe") {
    return await startStripeCheckout(c, "organization", email, domainRaw);
  } else if (paymentMethod === "fio") {
    return await startFioCheckout(c, "organization", email, domainRaw, extendedDeadline);
  }

  return c.text("Neznámý způsob platby.", 400);
});

// ─── Stripe startér (unified pro B2C + B2B) ─────────────────────

async function startStripeCheckout(
  c: Parameters<Parameters<typeof checkoutRoutes.post>[1]>[0],
  type: "individual" | "organization",
  email: string,
  domain: string | undefined
) {
  const stripe = getStripe(c.env.STRIPE_SECRET_KEY);
  const isOrg = type === "organization";
  const price = isOrg ? PRICE_ORGANIZATION : PRICE_INDIVIDUAL;
  const productName = isOrg
    ? "Videokurz Claude Code — Firemní licence"
    : "Videokurz Claude Code — Jednotlivec";

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    payment_method_types: ["card"],
    customer_email: email,
    line_items: [
      {
        price_data: {
          currency: "czk",
          product_data: { name: productName },
          unit_amount: price * 100, // CZK → haléře
          recurring: { interval: "year" },
        },
        quantity: 1,
      },
    ],
    ...(isOrg
      ? {
          custom_fields: [
            {
              key: "domain",
              label: { type: "custom", custom: "Emailová doména firmy (např. firma.cz)" },
              type: "text",
            },
          ],
        }
      : {}),
    success_url: `${c.env.BETTER_AUTH_URL}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${c.env.BETTER_AUTH_URL}/#cenik`,
    metadata: {
      type,
      ...(domain ? { prefillDomain: domain } : {}),
    },
  });

  return c.redirect(session.url!, 303);
}

// ─── FIO startér ─────────────────────────────────────────────────

async function startFioCheckout(
  c: Parameters<Parameters<typeof checkoutRoutes.post>[1]>[0],
  type: "individual" | "organization",
  email: string,
  domain: string | undefined,
  extendedDeadline: boolean
) {
  const db = drizzle(c.env.DB);
  const price = type === "organization" ? PRICE_ORGANIZATION : PRICE_INDIVIDUAL;
  const dueDays = extendedDeadline ? FIO_EXTENDED_DUE_DAYS : FIO_DEFAULT_DUE_DAYS;
  const expiresAt = new Date(Date.now() + dueDays * 86400 * 1000);
  const createdAt = new Date();

  // Generate unique VS (retry až 5× při kolizi unique constraint)
  let vs: string | null = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = generateVariableSymbol();
    const existing = await db
      .select({ id: purchase.id })
      .from(purchase)
      .where(eq(purchase.variableSymbol, candidate))
      .limit(1);
    if (existing.length === 0) {
      vs = candidate;
      break;
    }
  }
  if (!vs) {
    console.error("[fio] Failed to generate unique VS after 5 attempts");
    return c.text("Chyba při vytváření objednávky. Zkuste to prosím znovu.", 500);
  }

  // Pro B2B vytvoř organization (pending) pokud neexistuje
  if (type === "organization" && domain) {
    const existing = await db
      .select({ id: organization.id })
      .from(organization)
      .where(eq(organization.domain, domain))
      .limit(1);
    if (existing.length === 0) {
      const { nanoid } = await import("nanoid");
      await db.insert(organization).values({
        publicId: nanoid(),
        domain,
        stripeSubscriptionId: null,
        status: "pending",
        createdAt,
      });
    }
  }

  // Vytvoř pending purchase
  await db.insert(purchase).values({
    email,
    userId: null,
    type,
    paymentMethod: "fio",
    variableSymbol: vs,
    fioTransactionId: null,
    stripePaymentId: null,
    stripeSubscriptionId: null,
    status: "pending",
    expiresAt,
    createdAt,
  });

  // Odeslat pending email
  const payUrl = `${c.env.BETTER_AUTH_URL}/checkout/pay/${vs}`;
  c.executionCtx.waitUntil(
    sendEmail(c.env, {
      to: email,
      subject: "Potvrzení objednávky — kurz.vibecoding.cz",
      html: fioPendingHtml(payUrl, price, formatDueDate(expiresAt)),
    })
  );

  // Pro B2B — admin notifikace
  if (type === "organization" && domain) {
    c.executionCtx.waitUntil(
      sendEmail(c.env, {
        to: [...ADMIN_EMAILS],
        subject: "Nová firemní objednávka (FIO)",
        html: adminNewOrgHtml(domain, email, "fio", `${c.env.BETTER_AUTH_URL}/admin`),
      })
    );
  }

  return c.redirect(`/checkout/pay/${vs}`, 303);
}

// ─── FIO platební stránka ────────────────────────────────────────

checkoutRoutes.get("/checkout/pay/:vs", async (c) => {
  const vs = c.req.param("vs");
  const db = drizzle(c.env.DB);

  const rows = await db
    .select()
    .from(purchase)
    .where(eq(purchase.variableSymbol, vs))
    .limit(1);

  if (rows.length === 0) {
    return c.html(
      <Layout title="Objednávka nenalezena">
        <section class="max-w-md mx-auto px-4 py-16 text-center">
          <h1 class="text-2xl font-bold mb-4">Objednávka nenalezena</h1>
          <p class="text-gray-600">Zkontrolujte odkaz z emailu nebo vytvořte novou objednávku.</p>
          <a href="/" class="mt-6 inline-block text-indigo-600 hover:underline">Zpět na hlavní stránku</a>
        </section>
      </Layout>,
      404
    );
  }

  const p = rows[0];

  if (p.status === "active") {
    return c.redirect(`/login?email=${encodeURIComponent(p.email)}`, 303);
  }
  if (p.status === "expired" || p.status === "refunded") {
    return c.html(
      <Layout title="Objednávka již není aktivní">
        <section class="max-w-md mx-auto px-4 py-16 text-center">
          <h1 class="text-2xl font-bold mb-4">Objednávka již není aktivní</h1>
          <p class="text-gray-600 mb-6">Stav: {p.status === "expired" ? "propadla" : "refundována"}. Vytvořte novou objednávku.</p>
          <a href={p.type === "organization" ? "/checkout/organization" : "/checkout/individual"} class="inline-block bg-indigo-600 text-white px-6 py-3 rounded-lg">Nová objednávka</a>
        </section>
      </Layout>,
      410
    );
  }

  const price = p.type === "organization" ? PRICE_ORGANIZATION : PRICE_INDIVIDUAL;
  const dueDays = Math.round((p.expiresAt.getTime() - p.createdAt.getTime()) / 86400000);
  const isExtended = dueDays > FIO_DEFAULT_DUE_DAYS;
  const spd = generateSPD(PAYMENT_IBAN, price, p.variableSymbol!, `Videokurz ${p.email}`);
  const qrSvg = generateQRSvg(spd);

  let domain: string | undefined;
  if (p.type === "organization") {
    domain = emailDomain(p.email);
  }

  return c.html(
    <Layout title="Platba bankovním převodem">
      <PaymentDetails
        variableSymbol={p.variableSymbol!}
        amount={price}
        account={PAYMENT_ACCOUNT}
        qrSvg={qrSvg}
        type={p.type as "individual" | "organization"}
        email={p.email}
        domain={domain}
        dueDate={formatDueDate(p.expiresAt)}
        isExtended={isExtended}
      />
    </Layout>
  );
});

// ─── Verify endpoint (htmx) ──────────────────────────────────────

checkoutRoutes.post("/api/fio/verify/:vs", async (c) => {
  const vs = c.req.param("vs");
  const db = drizzle(c.env.DB);

  // KV rate limit (FIO API má limit 30s, používáme 35s buffer)
  const rateLimitKey = `fio_rate_limit:${vs}`;
  const lastCheck = await c.env.KV.get(rateLimitKey);
  if (lastCheck) {
    const waitMs = FIO_RATE_LIMIT_MS - (Date.now() - Number(lastCheck));
    if (waitMs > 0) {
      return c.html(<VerifyRateLimit waitSeconds={Math.ceil(waitMs / 1000)} />);
    }
  }
  await c.env.KV.put(rateLimitKey, String(Date.now()), { expirationTtl: 60 });

  const rows = await db
    .select()
    .from(purchase)
    .where(eq(purchase.variableSymbol, vs))
    .limit(1);

  if (rows.length === 0) {
    return c.html(<VerifyError message="Objednávka nenalezena." />);
  }
  const p = rows[0];

  if (p.status === "active") {
    return c.html(<VerifySuccess email={p.email} />);
  }
  if (p.status !== "pending") {
    return c.html(<VerifyError message="Objednávka již není aktivní." />);
  }

  // Zavolat FIO API
  const fioRes = await fetchFioTransactions(c.env.FIO_API_TOKEN, FIO_LOOKBACK_DAYS);
  if (!fioRes.ok) {
    if (fioRes.status === 429) {
      return c.html(<VerifyRateLimit waitSeconds={30} />);
    }
    return c.html(<VerifyError message="Dočasně nelze ověřit. Zkuste to za chvíli." />);
  }

  const expectedAmount = p.type === "organization" ? PRICE_ORGANIZATION : PRICE_INDIVIDUAL;
  const match = matchPayment(fioRes.transactions, p.variableSymbol!, expectedAmount);

  if (!match.found || !match.transaction) {
    return c.html(<VerifyNotFound />);
  }

  // Platba spárována — aktivovat purchase
  const now = new Date();
  const newExpiresAt = new Date(now.getTime() + ACCESS_DURATION_DAYS * 86400 * 1000);
  await db
    .update(purchase)
    .set({
      status: "active",
      expiresAt: newExpiresAt,
      fioTransactionId: String(match.transaction.id),
    })
    .where(eq(purchase.id, p.id));

  // Confirm email
  c.executionCtx.waitUntil(
    sendEmail(c.env, {
      to: p.email,
      subject: "Platba přijata — přihlaste se do kurzu",
      html: purchaseConfirmedHtml(`${c.env.BETTER_AUTH_URL}/login?email=${encodeURIComponent(p.email)}`, p.type as "individual" | "organization"),
    })
  );

  return c.html(<VerifySuccess email={p.email} />);
});

// ─── Stripe success page (sloučit ze starého routes/stripe.tsx) ─────
// Pozn.: Stripe webhook zůstává v routes/stripe.tsx, ale success stránka může být tady.
// Po Etapě 4 (Tailwind migrace) přepsat Stripe success na čistý Layout + Tailwind.

export { checkoutRoutes };
```

- [ ] **Step 2: Typecheck + commit**

```bash
cd /Users/patrickzandl/GitHub/videokurzy
npm run typecheck
git add src/routes/checkout.tsx
git commit -m "feat(checkout): add checkout routes with Stripe/FIO selection

- GET /checkout/individual, /checkout/organization: mezistránky s radio platby
- POST endpointy: dispatch Stripe Checkout nebo FIO pending purchase
- GET /checkout/pay/:vs: FIO payment page (QR + splatnost + htmx verify)
- POST /api/fio/verify/:vs: polling FIO API + rate limit přes KV

B2B flow: validace freemail domén, admin notification, org (pending) creation.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 5: `src/routes/dev.tsx` — dev mock pro FIO platbu

**Files:**
- Create: `src/routes/dev.tsx`

**Goal:** Simulace přijaté platby v lokálním vývoji — protože FIO API v dev módu vrací prázdný seznam, potřebujeme způsob, jak bez reálné platby označit pending purchase jako active.

- [ ] **Step 1: Vytvořit `src/routes/dev.tsx`**

```tsx
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import type { Env, Variables } from "../types";
import { purchase } from "../db/schema";
import { ACCESS_DURATION_DAYS } from "../config/payment";
import { sendEmail, purchaseConfirmedHtml } from "../lib/email";
import { Layout } from "../views/layout";

const devRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

/** Guard: pouze když FIO_API_TOKEN === "dev". Nikdy neběhá v produkci. */
devRoutes.use("/dev/*", async (c, next) => {
  if (c.env.FIO_API_TOKEN !== "dev") {
    return c.text("Not available in production.", 404);
  }
  await next();
});

devRoutes.get("/dev/fio/pay/:vs", async (c) => {
  const vs = c.req.param("vs");
  const db = drizzle(c.env.DB);

  const rows = await db.select().from(purchase).where(eq(purchase.variableSymbol, vs)).limit(1);
  if (rows.length === 0) return c.text("Purchase not found.", 404);

  const p = rows[0];
  if (p.status !== "pending") return c.text(`Purchase already ${p.status}.`, 409);

  const now = new Date();
  const newExpiresAt = new Date(now.getTime() + ACCESS_DURATION_DAYS * 86400 * 1000);
  await db
    .update(purchase)
    .set({ status: "active", expiresAt: newExpiresAt, fioTransactionId: `dev-${Date.now()}` })
    .where(eq(purchase.id, p.id));

  c.executionCtx.waitUntil(
    sendEmail(c.env, {
      to: p.email,
      subject: "Platba přijata — přihlaste se do kurzu (DEV)",
      html: purchaseConfirmedHtml(`${c.env.BETTER_AUTH_URL}/login?email=${encodeURIComponent(p.email)}`, p.type as "individual" | "organization"),
    })
  );

  return c.html(
    <Layout title="DEV mock — platba označena jako přijatá">
      <section class="max-w-md mx-auto px-4 py-16 text-center">
        <h1 class="text-2xl font-bold mb-4">[DEV] Platba přijata</h1>
        <p class="text-gray-600 mb-6">Purchase {vs} je nyní active. Přístup končí {newExpiresAt.toLocaleDateString("cs-CZ")}.</p>
        <a href={`/login?email=${encodeURIComponent(p.email)}`} class="inline-block bg-green-600 text-white px-6 py-3 rounded-lg">
          Přihlásit se
        </a>
      </section>
    </Layout>
  );
});

export { devRoutes };
```

- [ ] **Step 2: Typecheck + commit**

```bash
cd /Users/patrickzandl/GitHub/videokurzy
npm run typecheck
git add src/routes/dev.tsx
git commit -m "feat(dev): add /dev/fio/pay/:vs mock endpoint

Simulates FIO payment arrival in local dev (gated on FIO_API_TOKEN === 'dev').
Converts pending purchase to active + sends confirmation email.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 6: `src/routes/admin.tsx` — email po schválení organizace

**Files:**
- Modify: `src/routes/admin.tsx`

**Goal:** Když admin klikne „Schválit" u organization row, po UPDATE status='active' musí odletět email uživateli (na jeho objednávkový email) + info adminovi.

- [ ] **Step 1: Přečíst současný `src/routes/admin.tsx`**

```bash
cat /Users/patrickzandl/GitHub/videokurzy/src/routes/admin.tsx
```

Najít místo, kde se volá `db.update(organization).set({ status: 'active' }).where(...)`. Po tomto update:
1. Získat email nejnovější purchase pro tuto organizaci (JOIN nebo zvlášť SELECT na purchase.email WHERE type='organization' ORDER BY createdAt DESC LIMIT 1 — ale purchase nemá organizationId, takže matchnout přes doménu).
2. Odeslat `organizationApprovedHtml` email.

**Alternativa (jednodušší):** Zjistit všechny purchase emails pro danou doménu (pending nebo active FIO nebo Stripe) a vyrozumět všechny. Lepší je vybrat jen nejnovější pending/active purchase pro doménu.

- [ ] **Step 2: Upravit approve handler**

Do `src/routes/admin.tsx` najít handler (typicky `admin.post('/admin/api/organizations/:id/approve', ...)`) a doplnit email send po DB update:

```typescript
import { organizationApprovedHtml, sendEmail } from "../lib/email";

// V approve handleru po:
// await db.update(organization).set({ status: 'active' }).where(eq(organization.id, orgId));

// Dostat email posledního kupujícího pro tuto doménu:
const orgRow = await db.select({ domain: organization.domain }).from(organization).where(eq(organization.id, orgId)).limit(1);
if (orgRow.length > 0) {
  const domain = orgRow[0].domain;
  // Nejnovější pending/active purchase typu organization pro tuto doménu
  const recent = await db
    .select({ email: purchase.email })
    .from(purchase)
    .where(
      and(
        eq(purchase.type, "organization"),
        or(eq(purchase.status, "pending"), eq(purchase.status, "active"))
      )
    )
    .orderBy(desc(purchase.createdAt))
    .limit(10);
  // Filtrovat podle domény
  const buyerEmail = recent.find((r) => r.email.toLowerCase().endsWith(`@${domain}`))?.email;
  if (buyerEmail) {
    c.executionCtx.waitUntil(
      sendEmail(c.env, {
        to: buyerEmail,
        subject: `Firemní licence pro ${domain} aktivována`,
        html: organizationApprovedHtml(domain, `${c.env.BETTER_AUTH_URL}/login?email=${encodeURIComponent(buyerEmail)}`),
      })
    );
  }
}
```

Poznámka: přesná struktura závisí na aktuálním tvaru `admin.tsx`. Cíl: po úspěšném approve odpálit `organizationApprovedHtml` email. Zachovat stávající htmx response pro admin UI.

- [ ] **Step 3: Typecheck + commit**

```bash
cd /Users/patrickzandl/GitHub/videokurzy
npm run typecheck
git add src/routes/admin.tsx
git commit -m "feat(admin): send organization approval email

After admin approves B2B org domain, send confirmation email to the
most recent buyer on that domain.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 7: `src/lib/renewal-reminders.ts` + `src/scheduled.ts` wiring

**Files:**
- Create: `src/lib/renewal-reminders.ts`
- Modify: `src/scheduled.ts`

**Goal:** Cron job (denně 03:00 UTC) projede všechny `active` FIO purchases a pokud `expiresAt` je přesně 21/14/7/1 den od teď (±12h window), pošle odpovídající renewal reminder.

Idempotence: každý den se spouští jednou, a reminder se pošle jen pokud `now` leží v okně [targetDate - 12h, targetDate + 12h] kolem `expiresAt - daysLeft`. Pokud cron jednou selže, na další den se reminder pošle s 1denním zpožděním — akceptovatelné.

Lepší varianta: přidat `lastReminderSentDay` sloupec do purchase tabulky, aby se vyloučily duplikáty. Ale to by vyžadovalo migraci. Pro MVP stačí window logic — duplicity jsou 12h window → prakticky 0.

- [ ] **Step 1: Vytvořit `src/lib/renewal-reminders.ts`**

```typescript
import { and, eq, gt, lt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { purchase } from "../db/schema";
import { FIO_RENEWAL_REMINDER_DAYS } from "../config/payment";
import { sendEmail, renewal21Html, renewal14Html, renewal7Html, renewal1Html } from "./email";
import type { Env } from "../types";

const DAY_MS = 86400 * 1000;
const WINDOW_MS = 12 * 3600 * 1000; // ±12h

const TEMPLATE_BY_DAYS: Record<number, (url: string) => string> = {
  21: renewal21Html,
  14: renewal14Html,
  7: renewal7Html,
  1: renewal1Html,
};

/**
 * Najde aktivní FIO purchases, jejichž expiresAt spadá do okna
 * [now + daysLeft - 12h, now + daysLeft + 12h] pro některé z daysLeft hodnot (21,14,7,1).
 * Pro každou odešle odpovídající renewal reminder email.
 */
export async function sendRenewalReminders(
  db: ReturnType<typeof drizzle>,
  env: Env,
  now: Date
): Promise<{ sent: number; errors: number }> {
  let sent = 0;
  let errors = 0;

  for (const daysLeft of FIO_RENEWAL_REMINDER_DAYS) {
    const targetTime = now.getTime() + daysLeft * DAY_MS;
    const windowStart = new Date(targetTime - WINDOW_MS);
    const windowEnd = new Date(targetTime + WINDOW_MS);

    const rows = await db
      .select({ id: purchase.id, email: purchase.email })
      .from(purchase)
      .where(
        and(
          eq(purchase.status, "active"),
          eq(purchase.paymentMethod, "fio"),
          gt(purchase.expiresAt, windowStart),
          lt(purchase.expiresAt, windowEnd)
        )
      );

    const template = TEMPLATE_BY_DAYS[daysLeft];
    if (!template) continue;

    for (const r of rows) {
      const renewUrl = `${env.BETTER_AUTH_URL}/checkout/individual`;
      const subject = daysLeft === 1
        ? "Poslední den k prodloužení přístupu ke kurzu"
        : `Váš přístup ke kurzu končí za ${daysLeft} dní`;
      const ok = await sendEmail(env, {
        to: r.email,
        subject,
        html: template(renewUrl),
      });
      if (ok) sent++;
      else errors++;
    }
  }

  return { sent, errors };
}
```

- [ ] **Step 2: Propojit do `src/scheduled.ts`**

```typescript
import { drizzle } from "drizzle-orm/d1";
import { and, eq, lt } from "drizzle-orm";
import { purchase } from "./db/schema";
import { sendRenewalReminders } from "./lib/renewal-reminders";
import type { Env } from "./types";

export async function handleScheduled(
  event: ScheduledEvent,
  env: Env,
  _ctx: ExecutionContext
): Promise<void> {
  const db = drizzle(env.DB);
  const now = new Date();

  try {
    const expiredCount = await expirePendingFioOrders(db, now);
    console.log(`[cron] expired ${expiredCount} pending FIO orders at ${event.scheduledTime}`);
  } catch (err) {
    console.error("[cron] expirePendingFioOrders failed:", err);
  }

  try {
    const { sent, errors } = await sendRenewalReminders(db, env, now);
    console.log(`[cron] renewal reminders: sent=${sent}, errors=${errors}`);
  } catch (err) {
    console.error("[cron] sendRenewalReminders failed:", err);
  }
}

async function expirePendingFioOrders(
  db: ReturnType<typeof drizzle>,
  now: Date
): Promise<number> {
  const result = await db
    .update(purchase)
    .set({ status: "expired" })
    .where(
      and(
        eq(purchase.status, "pending"),
        eq(purchase.paymentMethod, "fio"),
        lt(purchase.expiresAt, now)
      )
    )
    .returning({ id: purchase.id });
  return result.length;
}
```

- [ ] **Step 3: Typecheck + commit**

```bash
cd /Users/patrickzandl/GitHub/videokurzy
npm run typecheck
git add src/lib/renewal-reminders.ts src/scheduled.ts
git commit -m "feat(cron): send FIO renewal reminders at 21/14/7/1 days

Cron checks each day for active FIO purchases with expiresAt in window
[now+daysLeft-12h, now+daysLeft+12h] and sends the appropriate reminder.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 8: `src/routes/landing.tsx` — CTA migrace

**Files:**
- Modify: `src/routes/landing.tsx` (a/nebo `src/views/landing.tsx` — dle aktuální struktury)

**Goal:** Landing page má formuláře/buttony které postují rovnou na `/api/checkout/individual` a `/api/checkout/organization` (staré Stripe-only endpointy). Přepnout na odkazy/GET na `/checkout/individual` a `/checkout/organization` (nové mezistránky).

Staré endpointy `/api/checkout/*` v `src/routes/stripe.tsx` NECHAT — jsou sice nenavigované z landing, ale nic je nestopí + bezpečnostní fallback. Alternativně je smazat — rozhodnutí při implementaci.

- [ ] **Step 1: Přečíst landing kód a najít CTA**

```bash
grep -rn "api/checkout" /Users/patrickzandl/GitHub/videokurzy/src/
```

Pro každou instanci: nahradit `<form method="post" action="/api/checkout/individual"><button>...</button></form>` za `<a href="/checkout/individual" class="...stejné styly...">...</a>`.

- [ ] **Step 2: Po úpravě typecheck + commit**

```bash
cd /Users/patrickzandl/GitHub/videokurzy
npm run typecheck
git add src/routes/landing.tsx src/views/landing.tsx
git commit -m "refactor(landing): CTA links to /checkout/* mezistranka instead of /api/checkout/*

Users now see a payment-method selection page with Stripe/FIO radio
before redirect.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 9: `src/index.tsx` — registrace nových routes

**Files:**
- Modify: `src/index.tsx`

**Goal:** Zaregistrovat `checkoutRoutes` a `devRoutes`. `devRoutes` jen pokud dev (ale je to samo guardnuté middleware, takže můžeme registrovat vždy).

- [ ] **Step 1: Upravit `src/index.tsx`**

Přidat importy:
```typescript
import { checkoutRoutes } from "./routes/checkout";
import { devRoutes } from "./routes/dev";
```

Přidat route registration (před `app.route("/", adminRoutes);`):
```typescript
app.route("/", checkoutRoutes);
app.route("/", devRoutes);
```

- [ ] **Step 2: Typecheck + commit**

```bash
cd /Users/patrickzandl/GitHub/videokurzy
npm run typecheck
git add src/index.tsx
git commit -m "feat(routes): register checkout and dev routes in main app

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 10: End-to-end FIO smoke test v dev módu

**Files:** (none, manuální test)

- [ ] **Step 1: Ověřit, že `.dev.vars` má `FIO_API_TOKEN=dev`**

```bash
grep FIO_API_TOKEN /Users/patrickzandl/GitHub/videokurzy/.dev.vars
```

Pokud chybí, přidat `FIO_API_TOKEN=dev`.

- [ ] **Step 2: Spustit dev server**

```bash
cd /Users/patrickzandl/GitHub/videokurzy
npm run dev
```

Čekat na „Ready on http://localhost:8787".

- [ ] **Step 3: Otestovat B2C FIO flow**

V prohlížeči:
1. Otevřít `http://localhost:8787/checkout/individual`
2. Vyplnit email `test@example.com`, vybrat „QR platba převodem", zaškrtnout „Prodloužená splatnost" (21d)
3. Submit → redirect na `/checkout/pay/33xxxxxx`
4. Ověřit: QR kód se zobrazí, splatnost uvádí 21 dní, částka 2 000 Kč
5. Otevřít v nové záložce `http://localhost:8787/dev/fio/pay/33xxxxxx` → potvrzení platby
6. Vrátit se na `/checkout/pay/33xxxxxx` → stránka buď redirect na /login, nebo kliknutím „Ověřit platbu" vidíme `VerifySuccess`
7. V DB ověřit: `wrangler d1 execute videokurzy-db --local --command="SELECT email, status, paymentMethod, variableSymbol FROM purchase WHERE variableSymbol LIKE '33%';"`

- [ ] **Step 4: Otestovat B2B FIO flow**

1. `/checkout/organization`, email `jan@firma.cz`, doména `firma.cz`
2. Zkusit doménu `gmail.com` → očekávat error zprávu z freemail blacklistu
3. Zvolit `firma.cz`, submit → `/checkout/pay/33yyyyyy`
4. `/dev/fio/pay/33yyyyyy` → potvrzení
5. V DB: purchase je `active`, organization je `pending` (admin ještě neschválil)

- [ ] **Step 5: Otestovat cron manuálně**

```bash
curl "http://localhost:8787/__scheduled?cron=0+3+*+*+*"
```

V log: `[cron] expired N pending FIO orders` + `[cron] renewal reminders: sent=X, errors=Y`.

- [ ] **Step 6: Stop dev server, zachytit findings**

Pokud něco selhalo, vytvořit follow-up commit s fixem. Jinak: Etapa 2 je hotová.

---

## Hotovo — Etapa 2 complete

Po dokončení máme:
- ✅ FIO payment flow (B2C + B2B) s mezistránkou, QR kódem, splatnost 7/21d
- ✅ Stripe flow zachován (stále dostupný z nové mezistránky)
- ✅ FIO verify endpoint s KV rate limitingem
- ✅ Dev mock pro lokální testování platby
- ✅ Admin approval email po schválení organizace
- ✅ Cron expirace pending objednávek + renewal reminders 21/14/7/1 den
- ✅ Freemail blacklist pro B2B domény
- ✅ Brandované emaily od Andrea Maloveczká

**Pokračuje:** Etapa 3 (Admin CRUD pro kurzy/moduly/lekce) a Etapa 4 (kompletní Tailwind migrace stávajících views — `landing.tsx`, `dashboard.tsx`, `watch.tsx`, `login.tsx`, `privacy.tsx`, Stripe success).
