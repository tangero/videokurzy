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
    // FIO často vrací 500 i pro „validní" stavy (neplatný token, příliš
    // velký rozsah, nedostupný účet). Vytáhneme tělo, ať admin vidí důvod.
    const bodyText = await response.text().catch(() => "");
    const detail = bodyText ? ` — ${bodyText.slice(0, 200).replace(/\s+/g, " ")}` : "";
    return {
      ok: false,
      error: `FIO API ${response.status}${detail}`,
      status: 502,
    };
  }

  const data = (await response.json()) as FioApiResponse;
  const transactions = data.accountStatement?.transactionList?.transaction ?? [];
  return { ok: true, transactions };
}
