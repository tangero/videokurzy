// Logika zaváděcí slevy.
//
// Stavový stroj:
//  1) `auto` — admin zapnul slevu, sloty se nevyčerpaly. Sleva pro každého.
//  2) `code-only` — sloty vyčerpané, ale promo kód je nakonfigurovaný a aktivní.
//     Sleva platí pouze pro lidi, co kód v checkoutu zadají.
//  3) `off` — sleva neaktivní (vypnutá adminem, kód expirovaný, nebo nenastavený).
//
// Počet použitých slotů = počet `purchase.status='active' AND discountPercent>0`.
// Pending FIO objednávky se nepočítají, abychom neztratili slot, když platba
// nedorazí včas. Drobný overflow při race condition je akceptovatelný.

import { drizzle } from "drizzle-orm/d1";
import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import { purchase, discountInvite } from "../db/schema";

type Db = ReturnType<typeof drizzle>;

export type DiscountSettings = {
  active: boolean;
  percent: number;
  limit: number;
  code: string;
  codeExpiresAt: Date | null;
  label: string;
};

export type DiscountStage =
  | { kind: "off" }
  | {
      kind: "auto";
      percent: number;
      label: string;
      slotsTotal: number;
      slotsLeft: number;
      slotsUsed: number;
      codeActive: boolean; // info pro admin — kód taky funguje
    }
  | {
      kind: "code-only";
      percent: number;
      label: string;
      codeExpiresAt: Date | null;
    };

export type AppliedDiscount = {
  percent: number;
  code: string | null;
  source: "auto" | "code" | "invite";
};

export type InviteDiscount = {
  percent: number;
  token: string;
  label: string | null;
};

/** Načte aktuální stav slevy podle settings a počtu použitých slotů. */
export async function getDiscountState(
  db: Db,
  settings: DiscountSettings,
  now = new Date(),
): Promise<DiscountStage> {
  if (!settings.active || settings.percent <= 0 || settings.limit <= 0) {
    return { kind: "off" };
  }

  const codeActive = isCodeActive(settings, now);

  const slotsUsed = await countDiscountedActivePurchases(db);
  const slotsLeft = Math.max(0, settings.limit - slotsUsed);

  if (slotsLeft > 0) {
    return {
      kind: "auto",
      percent: settings.percent,
      label: settings.label,
      slotsTotal: settings.limit,
      slotsLeft,
      slotsUsed,
      codeActive,
    };
  }

  if (codeActive) {
    return {
      kind: "code-only",
      percent: settings.percent,
      label: settings.label,
      codeExpiresAt: settings.codeExpiresAt,
    };
  }

  return { kind: "off" };
}

/**
 * Vyhodnotí, jaká sleva se má aplikovat na konkrétní nákup, případně podle
 * zadaného promo kódu. Vrací null, pokud žádná sleva neplatí.
 *
 * V `auto` stage sleva platí pro každého — kód není potřeba (a kdyby ho někdo
 * zadal, dostane stejnou slevu, jen označenou jako 'code').
 */
export async function resolveCheckoutDiscount(
  db: Db,
  settings: DiscountSettings,
  providedCode: string | null,
  inviteToken: string | null = null,
  now = new Date(),
): Promise<AppliedDiscount | null> {
  // Invite token má vždy přednost a funguje i když je globální sleva vypnutá.
  const invite = await resolveInviteDiscount(db, inviteToken, now);
  if (invite) {
    return {
      percent: invite.percent,
      code: `invite:${invite.token}`,
      source: "invite",
    };
  }

  const stage = await getDiscountState(db, settings, now);
  const normalizedCode = providedCode?.trim() || null;
  const codeMatches = !!(
    normalizedCode &&
    settings.code &&
    normalizedCode.toLowerCase() === settings.code.trim().toLowerCase() &&
    isCodeActive(settings, now)
  );

  if (stage.kind === "auto") {
    return {
      percent: stage.percent,
      code: codeMatches ? settings.code : null,
      source: codeMatches ? "code" : "auto",
    };
  }
  if (stage.kind === "code-only" && codeMatches) {
    return { percent: stage.percent, code: settings.code, source: "code" };
  }
  return null;
}

/** Spočítá kolik aktivních purchase záznamů má discountPercent > 0. */
export async function countDiscountedActivePurchases(db: Db): Promise<number> {
  const row = await db
    .select({ c: sql<number>`count(*)` })
    .from(purchase)
    .where(and(eq(purchase.status, "active"), gt(purchase.discountPercent, 0)))
    .get();
  return row?.c ?? 0;
}

/**
 * Vrátí novou cenu po slevě, zaokrouhlenou DOLŮ na celé Kč.
 * `originalPrice` je v celých Kč.
 */
export function applyDiscount(originalPrice: number, percent: number): number {
  if (percent <= 0) return originalPrice;
  const clamped = Math.max(0, Math.min(100, percent));
  return Math.floor(originalPrice * (100 - clamped) / 100);
}

function isCodeActive(settings: DiscountSettings, now: Date): boolean {
  if (!settings.code.trim()) return false;
  if (!settings.codeExpiresAt) return true;
  return settings.codeExpiresAt.getTime() > now.getTime();
}

/**
 * Načte invite slevu pro daný token, pokud je platná.
 * Platný = existuje, není využitý (usedAt IS NULL) a buď nemá expiraci,
 * nebo expirace ještě neuplynula.
 */
export async function resolveInviteDiscount(
  db: Db,
  token: string | null,
  now = new Date(),
): Promise<InviteDiscount | null> {
  const normalized = token?.trim() || null;
  if (!normalized) return null;

  const row = await db
    .select({
      token: discountInvite.token,
      percent: discountInvite.percent,
      label: discountInvite.label,
      expiresAt: discountInvite.expiresAt,
      usedAt: discountInvite.usedAt,
    })
    .from(discountInvite)
    .where(eq(discountInvite.token, normalized))
    .get();

  if (!row) return null;
  if (row.usedAt) return null;
  if (row.percent <= 0) return null;
  if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) return null;

  return { percent: row.percent, token: row.token, label: row.label };
}

/**
 * Spotřebuje invite token — atomicky a idempotentně. Označí usedAt + purchaseId
 * jen pokud token ještě nebyl využit. Vrací true, když ho zrovna spotřeboval.
 */
export async function consumeInviteToken(
  db: Db,
  token: string,
  purchaseId: number,
  now = new Date(),
): Promise<boolean> {
  const updated = await db
    .update(discountInvite)
    .set({ usedAt: now, usedByPurchaseId: purchaseId })
    .where(and(eq(discountInvite.token, token), isNull(discountInvite.usedAt)))
    .returning({ token: discountInvite.token });
  return updated.length > 0;
}
