// Konfigurace plateb — Stripe a FIO Bank
// Zdroj FIO účtu: Patrick Zandl, FIO podnikatelský účet 2403461724/2010

/** IBAN FIO účtu (podnikatelský) */
export const PAYMENT_IBAN = "CZ9720100000002403461724";

/** Číslo účtu pro zobrazení */
export const PAYMENT_ACCOUNT = "2403461724/2010";

/** BIC / SWIFT kód */
export const PAYMENT_BIC = "FIOBCZPP";

/** Název příjemce (zobrazí se na QR platbě a v SPAYD) */
export const PAYMENT_RECIPIENT = "Patrick Zandl";

/** B2C částka v CZK */
export const PRICE_INDIVIDUAL = 2000;

/** B2B částka v CZK */
export const PRICE_ORGANIZATION = 15000;

/** Doba přístupu v dnech (1 rok) */
export const ACCESS_DURATION_DAYS = 365;

/** VS prefix pro videokurzy objednávky (odlišuje od donations `11` a workshops `22`) */
export const FIO_VS_PREFIX = "33";

/** Výchozí splatnost FIO objednávky ve dnech */
export const FIO_DEFAULT_DUE_DAYS = 7;

/** Prodloužená splatnost FIO objednávky (pro firemní zpracování) ve dnech */
export const FIO_EXTENDED_DUE_DAYS = 21;

/** FIO API rate limit v ms (30s limit + 5s buffer) */
export const FIO_RATE_LIMIT_MS = 35000;

/** Kolik dní zpět hledat transakce ve FIO API (pokrývá prodlouženou splatnost + margin) */
export const FIO_LOOKBACK_DAYS = 28;

/** Renewal reminder offsets ve dnech před expirací (3 týdny, 2 týdny, 1 týden, 1 den) */
export const FIO_RENEWAL_REMINDER_DAYS = [21, 14, 7, 1] as const;
