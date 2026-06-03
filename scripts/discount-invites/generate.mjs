#!/usr/bin/env node
// Generátor osobních slevových odkazů.
//
// Spouštění (skript importuje .ts modul; novější Node si TS typy odstraní sám):
//   node scripts/discount-invites/generate.mjs ...
// Pokud by starší Node import .ts odmítl, použij:
//   npx tsx scripts/discount-invites/generate.mjs \
//     --csv emails.csv --percent 50 --batch vibecoding-2026-06 \
//     --label "Osobní sleva pro absolventy" --expires 2026-12-31 \
//     --base https://kurzy.vibecoding.cz
//
// Vstup CSV: jeden e-mail na řádek (volitelně sloupec "email" s hlavičkou).
// Výstupy do scripts/discount-invites/out/:
//   - invites.sql  → aplikuj: wrangler d1 execute videokurzy-db --remote --file=...
//   - invites.csv  → email,token,url  (zdroj pro rozesílku přes Resend)

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { nanoid } from "nanoid";
import { buildInviteRows } from "../../src/lib/invite-generate.ts";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const csvPath = arg("csv");
if (!csvPath) {
  console.error("Chybí --csv <soubor>");
  process.exit(1);
}

const percent = parseInt(arg("percent", "50"), 10);
const batch = arg("batch", "default");
const label = arg("label", null);
const expiresRaw = arg("expires", null);
const baseUrl = arg("base", "https://kurzy.vibecoding.cz");

const expiresAt = expiresRaw ? new Date(`${expiresRaw}T23:59:59.000Z`) : null;

const raw = readFileSync(csvPath, "utf8");
const emails = raw
  .split(/\r?\n/)
  .map((line) => line.split(",")[0].trim())
  .filter((e) => e && e.includes("@") && e.toLowerCase() !== "email");

const { rows, sql } = buildInviteRows(emails, {
  percent,
  batch,
  label,
  expiresAt,
  baseUrl,
  now: new Date(),
  genToken: () => nanoid(),
});

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "out");
mkdirSync(outDir, { recursive: true });

writeFileSync(join(outDir, "invites.sql"), sql);
const csvOut =
  "email,token,url\n" +
  rows.map((r) => `${r.email},${r.token},${r.url}`).join("\n") +
  "\n";
writeFileSync(join(outDir, "invites.csv"), csvOut);

console.log(`Vygenerováno ${rows.length} tokenů.`);
console.log(`SQL:  scripts/discount-invites/out/invites.sql`);
console.log(`CSV:  scripts/discount-invites/out/invites.csv`);
console.log(`\nAplikuj na produkci:\n  npx wrangler d1 execute videokurzy-db --remote --file=scripts/discount-invites/out/invites.sql`);
