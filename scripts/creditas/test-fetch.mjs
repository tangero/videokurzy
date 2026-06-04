// Ostrý read-only test Creditas API: /account/transaction/search.
// Načte token + identifikátor z prostředí a vypíše, co banka vrátí.
// NIC nezapisuje — slouží jen k ověření přihlášení a reálného tvaru polí.
//
// Spuštění (klíče z .dev.vars):
//   node --env-file=.dev.vars scripts/creditas/test-fetch.mjs
// nebo s dodáním za běhu:
//   CREDITAS_API_TOKEN=... CREDITAS_IDENTIFIKATOR=... node scripts/creditas/test-fetch.mjs
//
// Volitelně: počet dní zpět jako 1. argument (default 28).

const BASE_URL = "https://api.creditas.cz/oam/v1";
const PAGE_ITEM_COUNT = 200;

const token = process.env.CREDITAS_API_TOKEN;
const accountId = process.env.CREDITAS_IDENTIFIKATOR;
const daysBack = parseInt(process.argv[2] ?? "28", 10);

if (!token || token.startsWith("<") || token === "dev") {
  console.error("✗ Chybí ostrý CREDITAS_API_TOKEN (v .dev.vars je placeholder nebo 'dev').");
  process.exit(1);
}
if (!accountId || accountId.startsWith("<") || accountId === "dev-account") {
  console.error("✗ Chybí ostrý CREDITAS_IDENTIFIKATOR.");
  process.exit(1);
}

function dateRange(days) {
  const now = new Date();
  const from = new Date(now.getTime() - days * 86400000);
  return {
    dateFrom: from.toISOString().split("T")[0],
    dateTo: now.toISOString().split("T")[0],
  };
}

const { dateFrom, dateTo } = dateRange(daysBack);
const url = `${BASE_URL}/account/transaction/search`;
const body = {
  accountId,
  pageItemCount: PAGE_ITEM_COUNT,
  pageIndex: 0,
  filter: { dateFrom, dateTo },
};

console.log(`→ POST ${url}`);
console.log(`  identifikátor: ${accountId.slice(0, 6)}… , rozsah: ${dateFrom} … ${dateTo}\n`);

let res;
try {
  res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
} catch (err) {
  console.error("✗ Síťová chyba při volání Creditas:", err.message);
  process.exit(1);
}

const text = await res.text();
console.log(`← HTTP ${res.status} ${res.statusText}\n`);

if (!res.ok) {
  // Creditas vrací deklarované i bezpečnostní chyby s HTTP 500 a JSON `name`.
  console.error("✗ Volání selhalo. Tělo odpovědi:");
  console.error(text.slice(0, 2000));
  process.exit(1);
}

let data;
try {
  data = JSON.parse(text);
} catch {
  console.error("✗ Odpověď není validní JSON. Tělo:");
  console.error(text.slice(0, 2000));
  process.exit(1);
}

// 1) Syrový JSON — klíčové pro ověření REÁLNÝCH názvů polí (camelCase vs snake_case).
console.log("=== SYROVÁ ODPOVĚĎ (prvních ~3000 znaků) ===");
console.log(JSON.stringify(data, null, 2).slice(0, 3000));
console.log("");

// 2) Pokus o parsování dle našeho předpokladu (camelCase). Když je prázdno,
//    zkus i snake_case — to rovnou napoví, jestli musíme upravit src/lib/creditas.ts.
const txsCamel = data.transactions ?? [];
console.log("=== SHRNUTÍ ===");
console.log(`transactions (camelCase): ${txsCamel.length}`);
console.log(`item_count / itemCount: ${data.itemCount ?? data.item_count ?? "—"}`);

const sample = txsCamel[0];
if (sample) {
  console.log("\n=== PRVNÍ TRANSAKCE — která pole reálně existují ===");
  const keys = Object.keys(sample);
  console.log("klíče:", keys.join(", "));
  console.log("amount:", JSON.stringify(sample.amount ?? sample.value ?? null));
  console.log(
    "VS:",
    sample.variableSymbol ?? sample.variable_symbol ?? "(žádné pole variableSymbol/variable_symbol)",
  );
  console.log(
    "transactionId:",
    sample.transactionId ?? sample.transaction_id ?? sample.id ?? "(žádné)",
  );
} else {
  console.log("\n⚠ Žádné transakce v camelCase tvaru. Zkontroluj syrový JSON výše —");
  console.log("  pokud tam transakce JSOU pod jinými názvy (snake_case), je nutné");
  console.log("  upravit názvy polí v src/lib/creditas.ts.");
}
