// Blacklist freemailových domén — nejdou použít pro B2B firemní licenci,
// protože by se licence vztahovala na všechny uživatele dané služby.

const FREEMAIL_DOMAINS = new Set<string>([
  // České freemaily
  "seznam.cz",
  "post.cz",
  "email.cz",
  "centrum.cz",
  "atlas.cz",
  "volny.cz",
  "tiscali.cz",
  // Mezinárodní freemaily
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.co.uk",
  "ymail.com",
  "outlook.com",
  "hotmail.com",
  "hotmail.co.uk",
  "live.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "protonmail.com",
  "proton.me",
  "pm.me",
  "tutanota.com",
  "tutanota.de",
  "tuta.io",
  "gmx.com",
  "gmx.de",
  "gmx.cz",
  "mail.com",
  "fastmail.com",
  "fastmail.fm",
  "zoho.com",
  "yandex.com",
  "yandex.ru",
]);

/**
 * Vrací true, pokud je doména ve freemail blacklistu.
 * Vstupní doména se normalizuje na lowercase.
 */
export function isFreemailDomain(domain: string): boolean {
  return FREEMAIL_DOMAINS.has(domain.toLowerCase().trim());
}

/** Lidsky čitelná zpráva pro UI, když uživatel zadá freemail doménu. */
export const FREEMAIL_REJECTION_MESSAGE =
  "Pro firemní licenci potřebujeme vlastní firemní doménu. Freemailové domény (gmail.com, seznam.cz, icloud.com a další) nelze použít, protože licence by se vztahovala na všechny uživatele dané služby.";
