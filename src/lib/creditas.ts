// Creditas Bank API utilities pro párování příchozích plateb videokurzy objednávek.
// Sesterský modul k `fio.ts` — stejná logika párování (VS + přesná částka + CZK),
// jiné API a prefix VS = "34".
//
// Creditas API (https://api.creditas.cz/oam/v1) na rozdíl od FIO:
//  - autentizuje Bearer tokenem v hlavičce (ne tokenem v URL),
//  - transakce se čtou přes POST /account/transaction/search s JSON tělem,
//  - identifikuje účet systémovým `accountId` (ne číslem účtu),
//  - částka je objekt { value: string, currency: string }, kladná = příchozí.

import {
  CREDITAS_API_BASE_URL,
  CREDITAS_PAGE_ITEM_COUNT,
  CREDITAS_VS_PREFIX,
} from "../config/payment";

/** Peněžní částka v Creditas API — value je STRING (např. "2000.00"). */
export interface CreditasMoney {
  value: string;
  currency: string;
}

export interface CreditasPartnerAccount {
  partnerName?: string;
  number?: string;
  bankCode?: string;
  bankName?: string;
}

/** Jedna transakce z /account/transaction/search (model AccountTransaction). */
export interface CreditasTransaction {
  transactionId: string;
  amount: CreditasMoney;
  variableSymbol?: string;
  specificSymbol?: string;
  constantSymbol?: string;
  effectiveDate?: string;
  partnerAccount?: CreditasPartnerAccount;
  remittanceInfo?: string;
}

/** Odpověď /account/transaction/search (model InlineResponse20012). */
export interface CreditasSearchResponse {
  transactions?: CreditasTransaction[];
  itemCount?: number;
}

export interface CreditasPaymentMatchResult {
  found: boolean;
  transaction?: {
    id: string;
    // null = banka datum neuvedla. NEfabrikovat — viz fio.ts (účetní datum faktury).
    date: string | null;
    amount: number;
    senderName: string | null;
  };
}

/**
 * Generuje variabilní symbol s prefixem "34" (Creditas videokurzy).
 * Výsledek je 8místný: "34" + 6 náhodných číslic (100000–999999).
 */
export function generateCreditasVariableSymbol(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  const num = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
  const tail = String(100000 + (num % 900000));
  return `${CREDITAS_VS_PREFIX}${tail}`;
}

/** Vrací datumový rozsah (YYYY-MM-DD) pro filtr Creditas dotazu. */
export function getCreditasDateRange(daysBack: number): { dateFrom: string; dateTo: string } {
  const now = new Date();
  const from = new Date(now.getTime() - daysBack * 86400000);
  return {
    dateFrom: from.toISOString().split("T")[0],
    dateTo: now.toISOString().split("T")[0],
  };
}

/**
 * Hledá odpovídající příchozí platbu v seznamu Creditas transakcí.
 * Páruje podle: VS (bez leading zeros) + přesná částka + CZK + kladný objem.
 * Sémantika shodná s `matchPayment` ve fio.ts — kladná amount.value = příchozí.
 */
export function matchCreditasPayment(
  transactions: CreditasTransaction[],
  expectedVS: string,
  expectedAmount: number,
  excludeTransactionIds: Set<string> = new Set(),
): CreditasPaymentMatchResult {
  const normalizedExpectedVS = expectedVS.replace(/^0+/, "");

  for (const tx of transactions) {
    const amount = parseFloat(tx.amount?.value ?? "");
    const vs = (tx.variableSymbol ?? "").replace(/^0+/, "");
    const currency = tx.amount?.currency;
    const txId = tx.transactionId;

    if (!Number.isFinite(amount) || amount <= 0) continue;
    if (!txId) continue;
    if (excludeTransactionIds.has(txId)) continue;

    if (vs === normalizedExpectedVS && amount === expectedAmount && currency === "CZK") {
      return {
        found: true,
        transaction: {
          id: txId,
          date: tx.effectiveDate ?? null,
          amount,
          senderName: tx.partnerAccount?.partnerName ?? null,
        },
      };
    }
  }

  return { found: false };
}

/**
 * Volá Creditas API a vrací seznam transakcí za posledních `daysBack` dní.
 * V dev režimu (token === "dev") vrací prázdný seznam — platbu simuluj přes
 * /dev/creditas/pay.
 *
 * Vyžaduje Bearer token (ručně generovaný klíč nebo OAuth access token) a
 * systémový `accountId` účtu, ke kterému klíč patří.
 */
export async function fetchCreditasTransactions(
  token: string,
  accountId: string,
  daysBack: number,
): Promise<
  | { ok: true; transactions: CreditasTransaction[] }
  | { ok: false; error: string; status: number }
> {
  if (token === "dev") {
    return { ok: true, transactions: [] };
  }
  if (!accountId) {
    return { ok: false, error: "Creditas accountId není nakonfigurované", status: 500 };
  }

  const { dateFrom, dateTo } = getCreditasDateRange(daysBack);
  const url = `${CREDITAS_API_BASE_URL}/account/transaction/search`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        accountId,
        pageItemCount: CREDITAS_PAGE_ITEM_COUNT,
        pageIndex: 0,
        filter: { dateFrom, dateTo },
      }),
    });
  } catch (err) {
    return { ok: false, error: `Creditas fetch failed: ${(err as Error).message}`, status: 502 };
  }

  if (!response.ok) {
    // Creditas vrací deklarované i bezpečnostní chyby s HTTP 500 a JSON `name`.
    // Vytáhneme tělo, ať admin vidí důvod (neplatný klíč, validační chyba…).
    const bodyText = await response.text().catch(() => "");
    const detail = bodyText ? ` — ${bodyText.slice(0, 200).replace(/\s+/g, " ")}` : "";
    return {
      ok: false,
      error: `Creditas API ${response.status}${detail}`,
      status: 502,
    };
  }

  const data = (await response.json()) as CreditasSearchResponse;
  return { ok: true, transactions: data.transactions ?? [] };
}
