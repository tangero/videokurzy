#!/usr/bin/env node
// Vygeneruje osobní promo kódy na akci z vibecoding.cz pro předplatitele videokurzů.
// Každý předplatitel dostane dva kódy:
//   VSTUP-XXXXXX   – vstupenka zdarma, jedno použití (max_uses = 1 = jedna vstupenka)
//   KAMARAD-XXXXXX – sleva pro kamarády, neomezený počet použití
//
// Použití (viz README.md):
//   node scripts/event-invites/generate.mjs \
//     --subscribers scripts/event-invites/out/subscribers.json \
//     --event-id evt_... --friend-price 250 --valid-until 2026-10-12 \
//     --batch grokbot-2026-10-12
//
// Výstup:
//   out/promo.sql       – INSERT do promo_codes (D1 vibecoding-events)
//   out/recipients.csv  – email,free_code,friend_code
//
// contact_email zůstává NULL záměrně: cron promo-summary posílá souhrn každému
// kódu s vyplněným kontaktem, a ten je určený partnerům, ne předplatitelům.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { randomInt } from "node:crypto";
import { dirname, join } from "node:path";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const subscribersPath = arg("subscribers", "scripts/event-invites/out/subscribers.json");
const eventId = arg("event-id");
const friendPrice = Number(arg("friend-price"));
const validUntil = arg("valid-until");
const batch = arg("batch");
const outDir = arg("out", join(dirname(subscribersPath)));

if (!eventId || !Number.isInteger(friendPrice) || friendPrice <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(validUntil ?? "") || !batch) {
  console.error("Povinné: --event-id, --friend-price (Kč, > 0), --valid-until YYYY-MM-DD, --batch");
  process.exit(1);
}

// Výstup `wrangler d1 execute --json` je pole s jedním objektem { results: [...] }.
const raw = JSON.parse(readFileSync(subscribersPath, "utf8"));
const rows = Array.isArray(raw) ? raw.flatMap((r) => r.results ?? r) : raw.results;
const emails = [...new Set(
  rows.map((r) => String(r.email ?? "").trim().toLowerCase()).filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)),
)].sort();

// Bez znaků, které se pletou (0/O, 1/I/L).
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const used = new Set();
function code(prefix) {
  for (;;) {
    let s = "";
    for (let i = 0; i < 6; i++) s += ALPHABET[randomInt(ALPHABET.length)];
    const c = `${prefix}-${s}`;
    if (!used.has(c)) { used.add(c); return c; }
  }
}
const q = (v) => (v === null ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);

const sql = [];
const csv = ["email,free_code,friend_code"];
for (const email of emails) {
  const free = code("VSTUP");
  const friend = code("KAMARAD");
  for (const [c, price, maxUses, kind] of [[free, 0, 1, "zdarma"], [friend, friendPrice, 0, "kamarad"]]) {
    sql.push(
      `INSERT INTO promo_codes (id, code, event_id, new_price, commission_percent, max_uses, used_count, valid_until, contact_email, contact_name, note, active) ` +
      `VALUES (${q(`promo_${batch}_${c}`)}, ${q(c)}, ${q(eventId)}, ${price}, 0, ${maxUses}, 0, ${q(validUntil)}, NULL, NULL, ${q(`${batch} ${kind} ${email}`)}, 1);`,
    );
  }
  csv.push(`${email},${free},${friend}`);
}

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "promo.sql"), sql.join("\n") + "\n");
writeFileSync(join(outDir, "recipients.csv"), csv.join("\n") + "\n");
console.log(`Předplatitelů: ${emails.length}, kódů: ${sql.length}. Výstup v ${outDir}/promo.sql a recipients.csv`);
