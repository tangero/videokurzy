#!/usr/bin/env node
// Rozešle předplatitelům videokurzů osobní kódy na akci (vstup zdarma + sleva pro kamarády).
//
// Použití:
//   RESEND_API_KEY=re_xxx node scripts/event-invites/send.mjs \
//     --csv scripts/event-invites/out/recipients.csv \
//     --url https://www.vibecoding.cz/akce/ai-asistenti-grokbot-muse-dots/2026-10-12/ \
//     [--dry-run] [--limit 5] [--only patrick@zandl.cz]
//
// Text e-mailu je v htmlBody() níže, uprav ho pro další akce.
// Tvar volání Resend API odpovídá src/lib/email.ts a scripts/discount-invites/send.mjs.

import { readFileSync } from "node:fs";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : fallback;
}

const csvPath = arg("csv", "scripts/event-invites/out/recipients.csv");
const eventUrl = arg("url");
// Jméno v uvozovkách: závorky jsou v hlavičce From jinak komentář (RFC 5322).
const from = arg("from", '"Patrick Zandl (Vibecoding.cz)" <patrick@vibecoding.cz>');
const subject = arg("subject", "Webinář o osobních AI asistentech máte jako předplatitel zdarma");
const only = arg("only", null);
const dryRun = process.argv.includes("--dry-run") || process.argv.includes("--preview");
const limit = Number(arg("limit", Infinity));

// Klíč se bere z prostředí, případně z .env.local (gitignorovaný).
if (!process.env.RESEND_API_KEY) {
  try {
    const m = readFileSync(".env.local", "utf8").match(/^\s*RESEND_API_KEY\s*=\s*["']?([^"'\s]+)/m);
    if (m) process.env.RESEND_API_KEY = m[1];
  } catch {}
}
const apiKey = process.env.RESEND_API_KEY;
if (!dryRun && !apiKey) {
  console.error("Chybí RESEND_API_KEY (spusť: RESEND_API_KEY=re_... node ...).");
  process.exit(1);
}
if (!eventUrl) {
  console.error("Chybí --url na termín akce.");
  process.exit(1);
}

const lines = readFileSync(csvPath, "utf8").split(/\r?\n/).filter(Boolean);
if (lines.shift() !== "email,free_code,friend_code") {
  console.error("CSV musí mít hlavičku: email,free_code,friend_code");
  process.exit(1);
}

const INFO_URL = arg("info-url", "https://www.vibecoding.cz/akce/ai-asistenti-grokbot-muse-dots");
// UTM: zdroj kurzy (předplatitelé videokurzů), kampaň podle akce, utm_content rozliší odkaz.
// Odkaz pro kamarády se přeposílá dál, proto medium=referral.
const UTM_CAMPAIGN = arg("utm-campaign", "grokbot-predplatitele");
function utm(url, content, medium = "email") {
  const u = new URL(url);
  u.searchParams.set("utm_source", "kurzy");
  u.searchParams.set("utm_medium", medium);
  u.searchParams.set("utm_campaign", UTM_CAMPAIGN);
  u.searchParams.set("utm_content", content);
  return u.toString();
}
const promoUrl = (code) => `${eventUrl}?promo=${encodeURIComponent(code)}`;
const link = (code, content = "vstup-zdarma", medium = "email") => utm(promoUrl(code), content, medium);
const btn = "display:inline-block;background:#4f46e5;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none";

function htmlBody(freeCode, friendCode) {
  return `<!doctype html><html lang="cs"><body style="font-family:system-ui,sans-serif;line-height:1.6;color:#1f2937">
  <p>Dobrý den,</p>
  <p>v pondělí 12. října pořádám webinář <strong>Osobní AI asistenti: Grok Bot, Meta Muse a OpenAI Dots a jak je využít</strong>.
  Jako předplatitel videokurzů na kurzy.vibecoding.cz ho máte <strong>zdarma</strong>.</p>
  <p>Agenti, kteří pracují nepřetržitě na vlastním cloudovém počítači, jsou nejvíc diskutovanou novinkou podzimu.
  Na Grok Bota jsem převedl provoz projektu prijimackynaskolu.cz včetně komunikace se školami a rodiči
  a agenty používám i na běžné věci, například prodej nepotřebných věcí z garáže.</p>
  <p>Ukážeme si, jak postavit vlastní skill na hlídání cen na Bazoši a Aukru, jak agenta nechat prodávat
  na Marketplace a kde všude se to umí pokazit. Probereme cenu, oprávnění, ochranu osobních údajů a prompt injection.</p>
  <p><a href="${utm(INFO_URL, "detail-webinare")}">Podrobnosti o webináři</a></p>
  <p><a href="${link(freeCode)}" style="${btn}">Zaregistrovat se zdarma</a></p>
  <p style="font-size:14px;color:#4b5563">Kód <strong>${freeCode}</strong> se po kliknutí vyplní sám. Platí pro jednu osobu.</p>
  <p>Jestli chcete vzít kamarády nebo kolegy, pošlete jim tenhle odkaz. Dostanou <strong>slevu 50 %</strong>,
  počet lidí není omezený:</p>
  <p><a href="${link(friendCode, "kamarad", "referral")}">${link(friendCode, "kamarad", "referral")}</a><br>
  <span style="font-size:14px;color:#4b5563">(kód ${friendCode})</span></p>
  <p style="font-size:13px;color:#6b7280">Oba kódy platí do 12. 10. 2026.</p>
  <p>Patrick Zandl</p>
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:28px 0 16px">
  <div style="font-size:14px;color:#4b5563">
  <p style="margin:0 0 6px"><strong style="color:#1f2937">Webinář Claude Code pro pokročilé: Self-improving loops</strong></p>
  <p style="margin:0 0 8px">Nakopněte svou práci s Claude Code. Pokročilá tvorba smyček a dlouhých autonomních běhů je tady!</p>
  <p style="margin:0 0 8px">Tříhodinový hands-on workshop pro vývojáře, kteří už Claude Code běžně používají a chtějí přejít
  od řízení každého kroku k poloautomatickému procesu s vlastní kontrolou kvality. Vývojář zůstává orchestrátorem
  (human-in-the-loop – proto je proces poloautomatický) a drží rozhodovací body, agenti dělají rutinu a vzájemnou kontrolu.</p>
  <p style="margin:0"><a href="${utm("https://www.vibecoding.cz/akce/self-improving-loops-claude-code", "paticka-self-improving-loops")}">Více o workshopu a registrace</a></p>
  </div>
  </body></html>`;
}

// --preview soubor.html: uloží e-mail pro první řádek CSV a skončí (nic neposílá).
const previewPath = arg("preview", null);
if (previewPath) {
  const [, freeCode, friendCode] = lines[0].split(",");
  const { writeFileSync } = await import("node:fs");
  writeFileSync(previewPath, `<!-- Předmět: ${subject} | Od: ${from} -->\n` + htmlBody(freeCode, friendCode));
  console.log(`Náhled uložen do ${previewPath} (předmět: ${subject})`);
  process.exit(0);
}

// --test-to adresa: pošle JEDEN e-mail s kódy prvního řádku CSV na zadanou adresu.
const testTo = arg("test-to", null);
if (testTo) {
  const [, freeCode, friendCode] = lines[0].split(",");
  lines.splice(0, lines.length, `${testTo},${freeCode},${friendCode}`);
}

let sent = 0;
let failed = 0;
for (const line of lines) {
  if (sent >= limit) break;
  const [email, freeCode, friendCode] = line.split(",");
  if (!email || !freeCode || !friendCode) continue;
  if (only && email !== only) continue;

  if (dryRun) {
    console.log(`[dry-run] ${email} → ${link(freeCode)} | ${link(friendCode, "kamarad", "referral")}`);
    sent++;
    continue;
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [email], subject, html: htmlBody(freeCode, friendCode) }),
  });
  if (!res.ok) {
    console.error(`CHYBA ${email}: ${res.status} ${await res.text()}`);
    failed++;
  } else {
    console.log(`OK ${email}`);
    sent++;
  }
  await new Promise((r) => setTimeout(r, 600));
}

console.log(`\nHotovo. ${dryRun ? "Dry-run" : "Odesláno"}: ${sent}.${failed ? ` Selhalo: ${failed}.` : ""}`);
