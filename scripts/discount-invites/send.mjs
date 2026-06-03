#!/usr/bin/env node
// Rozešle osobní slevové odkazy přes Resend.
//
// Použití:
//   RESEND_API_KEY=re_xxx node scripts/discount-invites/send.mjs \
//     --csv scripts/discount-invites/out/invites.csv \
//     --from "Videokurzy <andrea@vibecoding.cz>" \
//     --subject "Sleva 50 % na videokurz Claude Code" \
//     [--reply-to "andrea@vibecoding.cz"] [--dry-run] [--limit 5]
//
// CSV musí mít hlavičku: email,token,url
//
// Pozn.: tvar volání Resend API (endpoint, Bearer auth, pole from/to/subject/
// html/reply_to) odpovídá ostřenému helperu v src/lib/email.ts.

import { readFileSync } from "node:fs";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && (process.argv[i + 1] === undefined || process.argv[i + 1].startsWith("--"))) return true; // flag
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const csvPath = arg("csv", "scripts/discount-invites/out/invites.csv");
const from = arg("from");
const subject = arg("subject", "Sleva 50 % na videokurz Claude Code");
const replyToRaw = arg("reply-to", null);
const replyTo = replyToRaw && replyToRaw !== true ? replyToRaw : null;
const dryRun = process.argv.includes("--dry-run");
const limitRaw = arg("limit", null);
const limit = limitRaw && limitRaw !== true ? parseInt(limitRaw, 10) : Infinity;

const apiKey = process.env.RESEND_API_KEY;
if (!dryRun && !apiKey) {
  console.error("Chybí RESEND_API_KEY (spusť: RESEND_API_KEY=re_... node ...).");
  process.exit(1);
}
if (!from) {
  console.error("Chybí --from \"Jméno <adresa>\"");
  process.exit(1);
}

const lines = readFileSync(csvPath, "utf8").split(/\r?\n/).filter(Boolean);
const header = lines.shift();
if (!header || !header.startsWith("email,token,url")) {
  console.error("CSV musí mít hlavičku: email,token,url");
  process.exit(1);
}

function htmlBody(url) {
  return `<!doctype html><html lang="cs"><body style="font-family:system-ui,sans-serif;line-height:1.6;color:#1f2937">
  <p>Ahoj,</p>
  <p>jako absolventovi placeného kurzu na vibecoding.cz pro tebe mám <strong>osobní slevu 50 %</strong>
  na videokurz Claude Code na <a href="https://kurzy.vibecoding.cz">kurzy.vibecoding.cz</a>.</p>
  <p>Sleva se aktivuje automaticky přes tvůj osobní odkaz — nic nemusíš opisovat:</p>
  <p><a href="${url}" style="display:inline-block;background:#4f46e5;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none">Získat kurz se slevou 50 %</a></p>
  <p style="font-size:13px;color:#6b7280">Odkaz je osobní a jednorázový. Nabídka platí jen do uvedeného data.</p>
  <p>Patrick Zandl</p>
  </body></html>`;
}

let sent = 0;
for (const line of lines) {
  if (sent >= limit) break;
  const [email, , url] = line.split(",");
  if (!email || !url) continue;

  if (dryRun) {
    console.log(`[dry-run] ${email} → ${url}`);
    sent++;
    continue;
  }

  const payload = { from, to: [email], subject, html: htmlBody(url) };
  if (replyTo) payload.reply_to = replyTo;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    console.error(`CHYBA ${email}: ${res.status} ${await res.text()}`);
  } else {
    console.log(`OK ${email}`);
    sent++;
  }
  await new Promise((r) => setTimeout(r, 600));
}

console.log(`\nHotovo. ${dryRun ? "Dry-run" : "Odesláno"}: ${sent}.`);
