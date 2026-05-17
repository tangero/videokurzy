// Email helper — odesílání brandovaných emailů přes Resend API.
// Odesílatel: Andrea Maloveczká <andrea@vibecoding.cz> (viz config/admin.ts)

import { EMAIL_FROM, EMAIL_REPLY_TO } from "../config/admin";
import type { Env } from "../types";

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
      console.error(`[email] Resend ${res.status}: ${await res.text()}`);
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
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 520px; margin: 0 auto; padding: 40px 20px; color: #1a1a1a; background: #ffffff;">
  <div style="text-align: center; margin-bottom: 32px;">
    <h1 style="font-size: 20px; font-weight: 600; margin: 0;">kurzy.vibecoding.cz</h1>
  </div>
  ${content}
  <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 32px 0;">
  <p style="font-size: 12px; color: #999; text-align: center;">
    kurzy.vibecoding.cz &middot; Andrea Maloveczká &middot; Vibecoding.cz
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
