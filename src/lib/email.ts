// Email helper — odesílání brandovaných emailů přes Resend API.
// Odesílatel: Andrea Maloveczká <andrea@vibecoding.cz> (viz config/admin.ts)

import { EMAIL_FROM, EMAIL_REPLY_TO } from "../config/admin";
import type { Env } from "../types";
import { TermsContent, TERMS_EFFECTIVE_DATE } from "../views/terms";

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
export async function sendEmail(
  env: Pick<Env, "RESEND_API_KEY">,
  opts: SendEmailOptions,
): Promise<boolean> {
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
/**
 * Potvrzení nákupu. `isConsumer` rozhoduje, zda se přiloží poučení o odstoupení —
 * NEODVOZUJ ho z `type`: to je typ licence, ne postavení kupujícího. Jednotlivec
 * nakupující na IČO je podnikatel a spotřebitelské poučení mu nepřísluší,
 * zatímco individuální licence bez IČO je spotřebitelský nákup. Volající proto
 * předává příznak odvozený z toho, zda objednávka nese firemní údaje.
 */
export async function purchaseConfirmedHtml(
  loginUrl: string,
  type: "individual" | "organization",
  isConsumer: boolean,
): Promise<string> {
  const typeLabel = type === "organization" ? "firemní licence" : "roční přístup";
  // VOP přikládáme VŽDY, i firemnímu kupujícímu: § 1824a se váže na uzavření
  // smlouvy, ne na postavení spotřebitele. `isConsumer` řídí jen poučení výše.
  const terms = await termsBlock();
  return emailWrapper(`
    <p style="font-size: 16px; line-height: 1.5;">Platba přijata — ${typeLabel} je aktivní!</p>
    <p style="font-size: 16px; line-height: 1.5;">Přístup ke všem kurzům máte na 12 měsíců.</p>
    ${primaryButton(loginUrl, "Přihlásit se do kurzu")}
    <p style="font-size: 14px; color: #4b5563; line-height: 1.5;">
      Dotazy? Odpovězte na tento email — píše vám Andrea Maloveczká.
    </p>
    ${isConsumer ? withdrawalNoticeBlock() : ""}
    ${terms}`);
}

/**
 * Kupuje zákazník jako spotřebitel? Rozhoduje, zda objednávka nese IČO — nákup
 * na firmu není spotřebitelská smlouva a § 1829 se na něj nevztahuje. Shodné
 * kritérium používá čl. 4 obchodních podmínek ("rozhoduje postavení kupujícího,
 * ne typ licence").
 */
export function isConsumerPurchase(p: { companyIco?: string | null }): boolean {
  return !p.companyIco;
}

/**
 * Plné znění obchodních podmínek pro vložení do potvrzovacího e-mailu.
 *
 * § 1824a odst. 1 obč. zák. vyžaduje potvrzení smlouvy **včetně VOP** na trvalém
 * nosiči, a to u KAŽDÉ spotřebitelské smlouvy uzavřené distančně — nezávisle na
 * tom, zda u ní vzniká právo na odstoupení. Odkaz na web nestačí, protože web lze
 * kdykoli změnit; e-mail zůstává zákazníkovi v podobě, kterou nezměníme.
 *
 * Text se renderuje ze sdílené `TermsContent`, takže se znění v e-mailu nemůže
 * rozejít se zněním na `/terms`. Stránkové třídy (Tailwind) v e-mailu neplatí,
 * proto se doplní inline styly pro nadpisy, odstavce a tabulku.
 */
async function termsBlock(): Promise<string> {
  const raw = String(await TermsContent({}));
  const styled = raw
    // <h1> stránky je duplicitní k nadpisu sekce v e-mailu — zahodíme ho.
    .replace(/<h1[^>]*>.*?<\/h1>/s, "")
    .replace(/<h2/g, `<h2 style="font-size: 14px; font-weight: 600; margin: 20px 0 6px;"`)
    .replace(/<h3/g, `<h3 style="font-size: 13px; font-weight: 600; margin: 14px 0 4px;"`)
    .replace(/<p>/g, `<p style="font-size: 12px; line-height: 1.6; margin: 0 0 8px;">`)
    .replace(/<li>/g, `<li style="font-size: 12px; line-height: 1.6;">`)
    .replace(/<table>/g, `<table style="font-size: 12px; border-collapse: collapse; width: 100%;">`)
    .replace(/<t([dh])>/g, `<t$1 style="border: 1px solid ${DIVIDER}; padding: 6px 8px; text-align: left;">`)
    .replace(
      /<blockquote/g,
      `<blockquote style="border-left: 3px solid ${DIVIDER}; background: #f9fafb; padding: 10px 14px; margin: 12px 0; font-size: 12px; line-height: 1.7;"`,
    );

  return `
    <hr style="border: none; border-top: 1px solid ${DIVIDER}; margin: 32px 0;">
    <h2 style="font-size: 15px; font-weight: 600; margin: 0 0 4px;">Obchodní podmínky</h2>
    <p style="font-size: 12px; color: ${TEXT_MUTED}; margin: 0 0 12px;">
      Znění účinné ke dni ${TERMS_EFFECTIVE_DATE}, které se vztahuje na vaši objednávku.
      Přikládáme je v souladu s § 1824a odst. 1 občanského zákoníku.
    </p>
    <div style="color: ${TEXT_MUTED};">${styled}</div>`;
}

/**
 * Poučení o právu na odstoupení + vzorový formulář, přikládané k potvrzení
 * nákupu. § 1824a odst. 1 obč. zák. vyžaduje předání na TRVALÉM NOSIČI — web
 * s podmínkami ho nesplňuje, protože ho lze kdykoli změnit; e-mail ano.
 * Vzorový formulář předepisuje nařízení vlády č. 29/2023 Sb. (nahradilo zrušené
 * 363/2013 Sb. k 18. 2. 2023).
 *
 * Jen pro B2C: § 1829 svědčí spotřebiteli, ne firmě nakupující na IČO.
 */
function withdrawalNoticeBlock(): string {
  return `
    <hr style="border: none; border-top: 1px solid ${DIVIDER}; margin: 32px 0;">
    <h2 style="font-size: 15px; font-weight: 600; margin: 0 0 8px;">Poučení o právu na odstoupení od smlouvy</h2>
    <p style="font-size: 13px; color: #4b5563; line-height: 1.6; margin: 0 0 8px;">
      Máte právo odstoupit od smlouvy do 14 dnů ode dne jejího uzavření, a to bez
      udání důvodu. Toto právo vám zůstává i poté, co jste si kurzy zpřístupnil(a)
      nebo zhlédl(a) — zákonnou výjimku pro digitální obsah neuplatňujeme.
    </p>
    <p style="font-size: 13px; color: #4b5563; line-height: 1.6; margin: 0 0 8px;">
      Odstoupení stačí odeslat před uplynutím lhůty e-mailem na
      <a href="mailto:patrick@vibecoding.cz">patrick@vibecoding.cz</a> nebo poštou
      na adresu Patrick Zandl, U Přelízky 1126/6, 250 01 Brandýs nad Labem-Stará
      Boleslav. Postačí jakékoli jednoznačné prohlášení; formulář níže je jen
      pomůcka a jeho použití není povinné. Peníze vrátíme do 14 dnů od doručení
      odstoupení stejným způsobem, jakým jsme je přijali.
    </p>
    <div style="font-size: 13px; color: #4b5563; line-height: 1.7; background: #f9fafb; border-left: 3px solid ${DIVIDER}; padding: 12px 16px; margin: 12px 0;">
      <strong>Vzorový formulář pro odstoupení od smlouvy</strong><br><br>
      Adresát: Patrick Zandl, U Přelízky 1126/6, 250 01 Brandýs nad Labem-Stará Boleslav, patrick@vibecoding.cz<br><br>
      Oznamuji, že tímto odstupuji od smlouvy o poskytnutí přístupu k videokurzům na kurzy.vibecoding.cz.<br><br>
      Datum objednání: …<br>
      Jméno a příjmení spotřebitele: …<br>
      Adresa spotřebitele: …<br>
      E-mail použitý při objednávce: …<br>
      Variabilní symbol nebo číslo dokladu: …<br>
      Podpis spotřebitele (pouze pokud je formulář zasílán v listinné podobě): …<br>
      Datum: …
    </div>`;
}

/**
 * Schvalovací e-mail pro článek „Novinky v Claude Code" (W-005). Míří adminovi;
 * klik na link = jednorázové schválení a publikace. Odesílá se jen po lidském
 * potvrzení (mantinel) a v dry-run režimu se NEodesílá vůbec.
 */
export function ccNewsApprovalHtml(opts: {
  weekLabel: string;
  versionRange: string | null;
  approveUrl: string;
  editUrl: string | null;
}): string {
  const versions = opts.versionRange ? ` (${opts.versionRange})` : "";
  return emailWrapper(`
    <p style="font-size: 16px; line-height: 1.5;">Nový koncept článku <strong>Novinky v Claude Code — ${opts.weekLabel}</strong>${versions} čeká na schválení.</p>
    <p style="font-size: 16px; line-height: 1.5;">Po kliknutí se článek publikuje v gated sekci „Novinky v CC" a připraví k rozeslání. Odkaz je jednorázový.</p>
    ${primaryButton(opts.approveUrl, "Schválit a publikovat")}
    ${opts.editUrl ? `<p style="font-size: 14px; color: #4b5563; line-height: 1.5;">Chcete nejdřív upravit? <a href="${opts.editUrl}">Otevřít koncept k editaci</a>.</p>` : ""}
    <p style="font-size: 14px; color: #4b5563; line-height: 1.5;">
      Odkaz je platný 7 dní a lze ho použít jen jednou. Pokud článek publikovat nechcete, e-mail ignorujte.
    </p>`);
}

/**
 * HTML rozesílaného newsletteru „Novinky v Claude Code". Skládá volitelný
 * úvodník (osobní komentář redaktora, jen do e-mailu — ne na web) NAD vlastní
 * článek a obojí vloží do brandového wrapperu. `introHtml` i `articleHtml` jsou
 * UŽ vyrenderované z markdownu (volající používá sdílený renderMarkdown), proto
 * je sem vkládáme přímo. `unsubscribeUrl` je per-příjemce odhlašovací odkaz.
 */
export function ccNewsNewsletterHtml(opts: {
  introHtml: string | null;
  articleHtml: string;
  unsubscribeUrl: string;
}): string {
  const intro = opts.introHtml
    ? `<div style="margin: 0 0 24px; font-size: 16px; line-height: 1.6; color: ${TEXT};">${opts.introHtml}</div>
       <hr style="border: none; border-top: 1px solid ${DIVIDER}; margin: 24px 0;">`
    : "";
  return emailWrapper(`
    ${intro}
    <div style="font-size: 15px; line-height: 1.6; color: ${TEXT};">${opts.articleHtml}</div>
    <p style="font-size: 12px; color: ${TEXT_MUTED}; text-align: center; margin-top: 24px;">
      Newsletter dostáváte jako platící uživatel kurzy.vibecoding.cz.
      <a href="${opts.unsubscribeUrl}" style="color: ${TEXT_MUTED};">Odhlásit odběr</a>.
    </p>`);
}

/** Potvrzení self-service výmazu účtu (GDPR). Odkaz platí 15 minut. */
export function accountDeletionConfirmHtml(confirmUrl: string): string {
  return emailWrapper(`
    <p style="font-size: 16px; line-height: 1.5;">Požádali jste o <strong>trvalé smazání svého účtu</strong> na kurzy.vibecoding.cz.</p>
    <p style="font-size: 16px; line-height: 1.5;">Po potvrzení se smaže váš profil, přihlašovací údaje a postup ve kurzech. Tuto akci nelze vrátit zpět.</p>
    ${primaryButton(confirmUrl, "Potvrdit smazání účtu")}
    <p style="font-size: 14px; color: #4b5563; line-height: 1.5;">
      Odkaz je platný 15 minut. Pokud jste o smazání nežádali, tento email ignorujte — nic se nestane.
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
