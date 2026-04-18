// Admin konfigurace — emaily pro notifikace a odesílatel transakčních emailů

/** Emaily admin uživatelů, kam chodí notifikace o nových B2B objednávkách, schválených platbách atd. */
export const ADMIN_EMAILS = [
  "patrick@vibecoding.cz",
  "andrea@vibecoding.cz",
] as const;

/** Odesílatel všech transakčních emailů (magic link, purchase confirmation, reminders). */
export const EMAIL_FROM = "Andrea Maloveczká <andrea@vibecoding.cz>";

/** Reply-to adresa (support). */
export const EMAIL_REPLY_TO = "andrea@vibecoding.cz";
