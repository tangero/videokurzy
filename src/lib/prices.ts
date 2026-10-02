import type { drizzle } from "drizzle-orm/d1";
import { siteConfig } from "../db/schema";
import { PRICE_INDIVIDUAL, PRICE_ORGANIZATION } from "../config/payment";

export type Prices = { individual: number; organization: number };

/**
 * Aktuální ceník. Závazné ceny žijí v `site_config` (spravuje je admin);
 * konstanty v `config/payment.ts` jsou jen fallback pro prázdnou DB.
 */
export async function getPrices(db: ReturnType<typeof drizzle>): Promise<Prices> {
  const rows = await db.select().from(siteConfig);
  const cfg = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    individual: parseInt(cfg.price_individual ?? String(PRICE_INDIVIDUAL), 10),
    organization: parseInt(cfg.price_organization ?? String(PRICE_ORGANIZATION), 10),
  };
}

/** 3000 → „3 000 Kč" (nezlomitelná mezera, ať se částka nerozdělí na dva řádky). */
export function formatCzk(amount: number): string {
  return `${String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, " ")} Kč`;
}
