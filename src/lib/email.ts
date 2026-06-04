// Email helper — odesílání brandovaných emailů přes Resend API.
// Odesílatel: Andrea Maloveczká <andrea@vibecoding.cz> (viz config/admin.ts)

import { EMAIL_FROM, EMAIL_REPLY_TO } from "../config/admin";
import type { Env } from "../types";

// Brand barvy pro emailové šablony. Inline CSS je nutnost (klienti CSS ignorují),
// ale konstanty drží konzistenci, ať změna brand barvy je jednomístná.
const BRAND = "#4f46e5";        // indigo-600 — primární akce
const BRAND_DARK = "#3730a3";   // indigo-800 — důraz, nadpisy v callout
const BRAND_MID = "#4338ca";    // indigo-700 — odstavce v callout
const BRAND_LIGHT = "#eef2ff";  // indigo-50 — pozadí callout
const BRAND_BORDER = "#c7d2fe"; // indigo-200 — border callout
const TEXT = "#1f2937";         // gray-800 — tělo
const TEXT_MUTED = "#4b5563";   // gray-600 — patička, hint (≥4.5:1 na bílé)
const DIVIDER = "#e5e7eb";      // gray-200 — separátor

interface SendEmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  from?: string;
  replyTo?: string;
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
        from: opts.from ?? EMAIL_FROM,
        reply_to: opts.replyTo ?? EMAIL_REPLY_TO,
        to: Array.isArray(opts.to) ? opts.to : [opts.to],
        subject: opts.subject,
        html: opts.html,
      }),
    });
    if (!res.ok) {
      console.error("[email] Resend API error:", res.status);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[email] sendEmail failed:", err);
    return false;
  }
}

/** Sdílený HTML wrapper s brandingem kurzy.vibecoding.cz. */
function emailWrapper(content: string): string {
  return `<!DOCTYPE html>
<html lang="cs">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 520px; margin: 0 auto; padding: 40px 20px; color: ${TEXT}; background: #ffffff;">
  <div style="text-align: center; margin-bottom: 32px;">
    <h1 style="font-size: 20px; font-weight: 600; margin: 0;">kurzy.vibecoding.cz</h1>
  </div>
  ${content}
  <hr style="border: none; border-top: 1px solid ${DIVIDER}; margin: 32px 0;">
  <p style="font-size: 12px; color: ${TEXT_MUTED}; text-align: center;">
    kurzy.vibecoding.cz &middot; Andrea Maloveczká &middot; Vibecoding.cz
  </p>
</body>
</html>`;
}

/** CTA tlačítko s primary brand barvou. */
function primaryButton(href: string, label: string): string {
  return `<div style="text-align: center; margin: 32px 0;">
    <a href="${href}" style="display: inline-block; background: ${BRAND}; color: white; font-weight: 600; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-size: 16px;">
      ${label}
    </a>
  </div>`;
}

// ─── Šablony: purchase flow ─────────────────────────────────────

/** Po vytvoření pending FIO objednávky — instrukce k platbě + odkaz na ZD. */
export function fioPendingHtml(
  payUrl: string,
  amount: number,
  dueDate: string,
  proformaUrl?: string | null,
  proformaNumber?: string | null,
): string {
  const formattedAmount = amount.toLocaleString("cs-CZ");
  const proformaBlock = proformaUrl && proformaNumber
    ? `<div style="background: ${BRAND_LIGHT}; border: 1px solid ${BRAND_BORDER}; border-radius: 8px; padding: 16px; margin: 24px 0;">
        <p style="margin: 0 0 8px; font-size: 14px; color: ${BRAND_DARK};">
          <strong>Zálohový doklad pro účtárnu</strong>
        </p>
        <p style="margin: 0 0 12px; font-size: 14px; color: ${BRAND_MID};">
          Číslo dokladu: <strong>${proformaNumber}</strong>. Doklad můžete předat účtárně ke schválení platby —
          najdete ho na stejném odkazu jako platební údaje, nebo přímo zde:
        </p>
        <p style="margin: 0;">
          <a href="${proformaUrl}" style="color: ${BRAND}; font-weight: 600;">Otevřít zálohový doklad ${proformaNumber} →</a>
        </p>
        <p style="margin: 12px 0 0; font-size: 12px; color: ${BRAND_MID};">
          Daňový doklad (fakturu v PDF) zašleme automaticky po přijetí platby.
        </p>
      </div>`
    : "";
  return emailWrapper(`
    <p style="font-size: 16px; line-height: 1.5;">Děkujeme za objednávku!</p>
    <p style="font-size: 16px; line-height: 1.5;">Pro aktivaci přístupu uhraďte <strong>${formattedAmount} Kč</strong> bankovním převodem do <strong>${dueDate}</strong>.</p>
    ${primaryButton(payUrl, "Zobrazit platební údaje, QR kód a doklad")}
    ${proformaBlock}
    <p style="font-size: 14px; color: #4b5563; line-height: 1.5;">
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
    <p style="font-size: 14px; color: #4b5563; line-height: 1.5;">
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
export function adminNewOrgHtml(domain: string, buyerEmail: string, paymentMethod: "stripe" | "fio" | "creditas", adminUrl: string): string {
  const paymentLabel =
    paymentMethod === "stripe"
      ? "Stripe (karta)"
      : paymentMethod === "creditas"
        ? "Creditas (bankovní převod)"
        : "FIO (bankovní převod)";
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

// ─── Šablona: admin uvítací email ──────────────────────────────

const ACCESS_LABEL: Record<"free" | "individual" | "organization", string> = {
  free: "bezplatný účet (přístup jen k volně dostupným lekcím)",
  individual: "soukromá licence — plný přístup ke všem kurzům",
  organization: "firemní licence — plný přístup ke všem kurzům",
};

/** Email od Patricka novému uživateli zřízenému adminem. */
export function adminWelcomeUserHtml(opts: {
  personalMessage: string;
  email: string;
  access: "free" | "individual" | "organization";
  expiresAt: Date | null;
  loginUrl: string;
}): string {
  const expiryLine = opts.access === "free" || !opts.expiresAt
    ? "Účet je bez časového omezení."
    : `Přístup je platný do <strong>${opts.expiresAt.toLocaleDateString("cs-CZ")}</strong>.`;
  const escapedMessage = opts.personalMessage
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");
  return emailWrapper(`
    <div style="font-size: 16px; line-height: 1.5; white-space: pre-wrap;">${escapedMessage}</div>
    <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 24px 0;">
    <p style="font-size: 14px; color: #444; line-height: 1.5;"><strong>Informace o tvém účtu</strong></p>
    <div style="background: #f9fafb; border-radius: 8px; padding: 16px; margin: 12px 0; font-size: 14px; line-height: 1.6;">
      <p style="margin: 0;"><strong>Platforma:</strong> kurzy.vibecoding.cz</p>
      <p style="margin: 4px 0 0;"><strong>Přihlašovací e-mail:</strong> ${opts.email}</p>
      <p style="margin: 4px 0 0;"><strong>Typ přístupu:</strong> ${ACCESS_LABEL[opts.access]}</p>
      <p style="margin: 4px 0 0;">${expiryLine}</p>
    </div>
    <p style="font-size: 14px; color: #444; line-height: 1.5;">
      Přihlášení probíhá bez hesla — na přihlašovací stránce zadáš svůj e-mail a obratem dostaneš
      jednorázový odkaz ke vstupu.
    </p>
    ${primaryButton(opts.loginUrl, "Přihlásit se do kurzu")}`);
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

// ─── Šablony: payment reminders (pending FIO objednávky) ──────────

export interface PaymentReminderOpts {
  /** Variabilní symbol */
  vs: string;
  /** Částka v Kč */
  amount: number;
  /** Číslo účtu pro zobrazení (např. 2403461724/2010) */
  accountNumber: string;
  /** Splatnost — datum konce platnosti pending objednávky */
  dueDate: string;
  /** SPD/SPAYD řetězec pro QR platbu (z `generateSPD`) */
  spd: string;
  /** Odkaz na celou platební stránku s QR a údaji (`/checkout/pay/<vs>`) */
  payUrl: string;
  /** Odkaz na novou objednávku s možností platby kartou (`/checkout/individual`) */
  cardUrl: string;
}

/** PNG QR kód vygenerovaný přes api.qrserver.com — žádná závislost ani build krok. */
function qrImageTag(spd: string, size = 220): string {
  const url = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&margin=8&data=${encodeURIComponent(spd)}`;
  return `<img src="${url}" width="${size}" height="${size}" alt="QR platba" style="display:block;margin:0 auto;border:1px solid #e5e7eb;border-radius:8px;background:white;">`;
}

function paymentBox(opts: PaymentReminderOpts): string {
  const amount = opts.amount.toLocaleString("cs-CZ");
  return `<div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:20px;margin:20px 0;text-align:center;">
    ${qrImageTag(opts.spd)}
    <p style="font-size:14px;color:#4b5563;margin:14px 0 4px;">Naskenujte QR v bankovní aplikaci nebo zadejte ručně:</p>
    <table style="margin:8px auto 0;font-size:14px;color:#111827;line-height:1.7;">
      <tr><td style="text-align:right;padding-right:10px;color:#6b7280;">Účet:</td><td><strong>${opts.accountNumber}</strong></td></tr>
      <tr><td style="text-align:right;padding-right:10px;color:#6b7280;">Částka:</td><td><strong>${amount} Kč</strong></td></tr>
      <tr><td style="text-align:right;padding-right:10px;color:#6b7280;">Variabilní symbol:</td><td><strong>${opts.vs}</strong></td></tr>
      <tr><td style="text-align:right;padding-right:10px;color:#6b7280;">Splatnost do:</td><td><strong>${opts.dueDate}</strong></td></tr>
    </table>
  </div>`;
}

/** Upomínka 2 dny po vytvoření objednávky — jemné připomenutí. */
export function paymentReminder2dHtml(opts: PaymentReminderOpts): string {
  return emailWrapper(`
    <p style="font-size:16px;line-height:1.5;">Dobrý den,</p>
    <p style="font-size:16px;line-height:1.5;">připomínáme, že na vaši objednávku kurzu zatím nedorazila platba. Tady jsou opět platební údaje:</p>
    ${paymentBox(opts)}
    ${primaryButton(opts.payUrl, "Otevřít platební stránku")}
    <p style="font-size:14px;color:#6b7280;line-height:1.6;">
      Chcete raději platit kartou? <a href="${opts.cardUrl}" style="color:#4f46e5;">Klikněte sem</a> — vytvoříte novou objednávku přes Stripe a přístup máte hned po zaplacení.
    </p>
    <p style="font-size:14px;color:#6b7280;line-height:1.6;">
      Pokud už jste zaplatili v posledních hodinách, tento email klidně ignorujte — bankovní převod může trvat 1 pracovní den, než dorazí na účet.
    </p>`);
}

/** Upomínka 5 dní po vytvoření — urgence před auto-stornem v den 7. */
export function paymentReminder5dHtml(opts: PaymentReminderOpts): string {
  return emailWrapper(`
    <p style="font-size:16px;line-height:1.5;"><strong>Platba kurzu — poslední dny do splatnosti</strong></p>
    <p style="font-size:16px;line-height:1.5;">
      Vaše objednávka má splatnost do <strong>${opts.dueDate}</strong>. Pokud do té doby platba nedorazí, objednávka se automaticky stornuje a budete muset objednat znovu.
    </p>
    ${paymentBox(opts)}
    ${primaryButton(opts.payUrl, "Otevřít platební stránku")}
    <p style="font-size:14px;color:#6b7280;line-height:1.6;">
      Chcete raději platit kartou s okamžitou aktivací? <a href="${opts.cardUrl}" style="color:#4f46e5;">Klikněte sem</a>.
    </p>
    <p style="font-size:14px;color:#6b7280;line-height:1.6;">
      Dotazy? Odpovězte na tento email — píše vám Patrick Zandl.
    </p>`);
}

/** Po auto-stornu (den 7+) — info, že objednávka byla zrušena, a odkaz na novou. */
export function paymentCancelledHtml(opts: { reorderUrl: string; vs: string }): string {
  return emailWrapper(`
    <p style="font-size:16px;line-height:1.5;">Dobrý den,</p>
    <p style="font-size:16px;line-height:1.5;">
      vaši objednávku s variabilním symbolem <strong>${opts.vs}</strong> jsme po uplynutí splatnosti automaticky stornovali — platba nedorazila.
    </p>
    <p style="font-size:16px;line-height:1.5;">
      Pokud máte o kurz stále zájem, vytvořte si prosím novou objednávku. Můžete platit kartou nebo bankovním převodem:
    </p>
    ${primaryButton(opts.reorderUrl, "Vytvořit novou objednávku")}
    <p style="font-size:14px;color:#6b7280;line-height:1.6;">
      Pokud jste platbu provedli těsně před stornem a peníze dorazí dodatečně, automaticky vám obnovíme přístup a pošleme přihlašovací odkaz.
    </p>`);
}
