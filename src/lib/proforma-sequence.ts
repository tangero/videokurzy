/**
 * Atomický generátor sekvenčního čísla pro zálohové doklady.
 * Sekvence se ukládá v `site_config` pod klíčem `proforma_seq_{YEAR}`.
 *
 * D1 nemá row-level locks, ale podporuje transakce. Tady spoléháme na to,
 * že jednotlivý INSERT/UPDATE je atomický, a UNIQUE constraint na
 * `purchase.proformaNumber` je poslední pojistka proti race.
 */

import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { siteConfig } from "../db/schema";
import { formatProformaNumber } from "./proforma";

const KEY_PREFIX = "proforma_seq_";

/**
 * Vrátí další ZD číslo pro daný rok a inkrementuje counter.
 *
 * D1 + drizzle nemají `INSERT ... ON CONFLICT DO UPDATE RETURNING`, takže
 * to děláme dvoufázově: read → update/insert. Při kolizi se příští pokus
 * o uložení purchase row odhalí přes UNIQUE constraint a volající retryuje.
 */
export async function nextProformaNumber(
  db: ReturnType<typeof drizzle>,
  date: Date = new Date(),
): Promise<string> {
  const year = date.getFullYear();
  const key = `${KEY_PREFIX}${year}`;

  const existing = await db
    .select({ value: siteConfig.value })
    .from(siteConfig)
    .where(eq(siteConfig.key, key))
    .limit(1);

  const current = existing.length > 0 ? parseInt(existing[0].value, 10) || 0 : 0;
  const next = current + 1;

  if (existing.length > 0) {
    await db
      .update(siteConfig)
      .set({ value: String(next) })
      .where(eq(siteConfig.key, key));
  } else {
    await db.insert(siteConfig).values({ key, value: String(next) });
  }

  return formatProformaNumber(year, next);
}
