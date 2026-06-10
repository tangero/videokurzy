import { and, desc, eq, inArray, ne, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { nanoid } from "nanoid";
import { user, lessonWatch } from "../db/schema";
import { purchase, progress } from "../db/schema";
import { userEmails } from "../db/identity-schema";
import { ensureUserEmailRecord, normalizeEmail } from "./user-emails";
import { linkPurchasesToUser } from "./access";

type Db = ReturnType<typeof drizzle>;
type AdminAccess = "free" | "individual" | "organization";
type CreateAdminUserResult = { id: string; email: string; name: string | null; role: string };

const VALID_ROLES = new Set(["user", "admin"]);
const VALID_ACCESS = new Set<AdminAccess>(["free", "individual", "organization"]);
const DAY_MS = 24 * 60 * 60 * 1000;
export const ADMIN_GRANT_DEFAULT_DAYS = 90;

export function normalizeSqlTimestampDate(value: Date | number | string | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return null;
  const milliseconds = numeric < 10_000_000_000 ? numeric * 1000 : numeric;
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime()) ? null : date;
}

function defaultAdminGrantExpiresAt(now = new Date()): Date {
  return new Date(now.getTime() + ADMIN_GRANT_DEFAULT_DAYS * DAY_MS);
}

export function defaultAdminGrantExpiresOn(now = new Date()): string {
  return defaultAdminGrantExpiresAt(now).toISOString().slice(0, 10);
}

export function parseAdminGrantExpiresAt(value?: string, now = new Date()): Date {
  const trimmed = value?.trim();
  if (!trimmed) return defaultAdminGrantExpiresAt(now);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    throw new Error("Zadej platné datum konce přístupu.");
  }

  const expiresAt = new Date(`${trimmed}T23:59:59.999Z`);
  if (Number.isNaN(expiresAt.getTime())) {
    throw new Error("Zadej platné datum konce přístupu.");
  }
  return expiresAt;
}

function parsePastedEmails(value: string): string[] {
  const seen = new Set<string>();
  const emails: string[] = [];
  for (const raw of value.split(/[\s,;]+/)) {
    const email = normalizeEmail(raw);
    if (!email || seen.has(email)) continue;
    seen.add(email);
    emails.push(email);
  }
  return emails;
}

export async function createAdminUser(
  db: Db,
  opts: {
    email: string;
    name?: string;
    role?: string;
    access?: string;
    expiresAt?: Date;
    grantedBy?: string | null;
    compReason?: string | null;
  },
): Promise<CreateAdminUserResult> {
  const email = normalizeEmail(opts.email);
  const name = opts.name?.trim() || null;
  const role = VALID_ROLES.has(opts.role ?? "") ? opts.role! : "user";
  const access: AdminAccess = VALID_ACCESS.has(opts.access as AdminAccess)
    ? opts.access as AdminAccess
    : "free";

  if (!email || !email.includes("@")) {
    throw new Error("Zadej platný e-mail.");
  }

  const existing = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, email))
    .get();

  if (existing) {
    throw new Error("Uživatel s tímto e-mailem už existuje.");
  }

  const id = nanoid();
  const now = new Date();

  await db.insert(user).values({
    id,
    email,
    name,
    role,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });

  await ensureUserEmailRecord(db, { userId: id, email });
  await linkPurchasesToUser(
    id,
    email,
    db as unknown as Parameters<typeof linkPurchasesToUser>[2],
  );

  // Admin uživatelé mají přístup z titulu role (viz hasAccess()) — purchase
  // řádek by jen plnil tabulku objednávek "fake zákazníkem". Nezakládáme.
  if (access !== "free" && role !== "admin") {
    await db.insert(purchase).values({
      email,
      userId: id,
      type: access,
      paymentMethod: "stripe", // historický artefakt — pro comp je irelevantní
      stripePaymentId: null,    // čistý namespace; granty se poznají podle kind='comp'
      status: "active",
      kind: "comp",
      grantedBy: opts.grantedBy ?? null,
      compReason: opts.compReason ?? null,
      expiresAt: opts.expiresAt ?? defaultAdminGrantExpiresAt(now),
      createdAt: now,
    });
  }

  return { id, email, name, role };
}

export type AdminUserListItem = {
  id: string;
  email: string;
  name: string | null;
  role: string;
  createdAt: Date;
  activeAccess: AdminAccess | null;
  accessExpiresAt: Date | null;
  // 'paid' = reálně zaplaceno (Stripe/FIO), 'grant' = comp/staff od admina,
  // null = bez aktivního přístupu (jen registrace nebo expired).
  accessSource: "paid" | "grant" | null;
  /** Poslední reálné sledování videa (z lesson_watch.updatedAt). Nejlepší signál aktivity. */
  lastActivityAt: Date | null;
};

export async function listAdminUsers(
  db: Db,
  opts: { search?: string; limit?: number; offset?: number } = {},
): Promise<{ rows: AdminUserListItem[]; total: number }> {
  const limit = Math.max(1, Math.min(200, opts.limit ?? 50));
  const offset = Math.max(0, opts.offset ?? 0);
  const search = opts.search?.trim().toLowerCase() ?? "";

  const pattern = `%${search.replace(/[%_]/g, (m) => `\\${m}`)}%`;
  const where = search
    ? sql`(lower(${user.email}) LIKE ${pattern} ESCAPE '\\' OR lower(coalesce(${user.name}, '')) LIKE ${pattern} ESCAPE '\\')`
    : undefined;

  const baseQuery = db
    .select({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      createdAt: user.createdAt,
    })
    .from(user);

  const rows = await (where ? baseQuery.where(where) : baseQuery)
    .orderBy(desc(user.createdAt))
    .limit(limit)
    .offset(offset);

  const countQuery = db.select({ c: sql<number>`count(*)` }).from(user);
  const totalRow = await (where ? countQuery.where(where) : countQuery).get();
  const total = totalRow?.c ?? 0;

  if (rows.length === 0) return { rows: [], total };

  const ids = rows.map((r) => r.id);
  const emails = rows.map((r) => r.email);

  // Aktivní přístup (stávající logika)
  const activePurchaseFields = {
    userId: purchase.userId,
    email: purchase.email,
    type: purchase.type,
    expiresAt: purchase.expiresAt,
    kind: purchase.kind,
  };

  const activePurchasesByUserId = await db
    .select({
      ...activePurchaseFields,
    })
    .from(purchase)
    .where(and(eq(purchase.status, "active"), inArray(purchase.userId, ids)));

  const activePurchasesByEmail = await db
    .select({
      ...activePurchaseFields,
    })
    .from(purchase)
    .where(and(eq(purchase.status, "active"), inArray(purchase.email, emails)));

  const activePurchases = [...activePurchasesByUserId, ...activePurchasesByEmail];

  // Poslední aktivita ze sledování videa (nejlepší signál "pokračuje v koukání")
  const lastActivityRows = ids.length > 0
    ? await db
        .select({
          userId: lessonWatch.userId,
          last: sql<Date | number | string | null>`max(${lessonWatch.updatedAt})`,
        })
        .from(lessonWatch)
        .where(inArray(lessonWatch.userId, ids))
        .groupBy(lessonWatch.userId)
    : [];

  const emailToId = new Map(rows.map((r) => [r.email.toLowerCase(), r.id]));
  const activeByUser = new Map<string, {
    type: AdminAccess;
    expiresAt: Date;
    source: "paid" | "grant";
  }>();
  for (const p of activePurchases) {
    const userId = p.userId ?? emailToId.get(p.email.toLowerCase()) ?? null;
    if (!userId) continue;
    const source: "paid" | "grant" = p.kind === "paid" ? "paid" : "grant";
    const expiresAt = normalizeSqlTimestampDate(p.expiresAt);
    if (!expiresAt) continue;
    const prev = activeByUser.get(userId);
    if (!prev || prev.expiresAt < expiresAt) {
      activeByUser.set(userId, {
        type: p.type as AdminAccess,
        expiresAt,
        source,
      });
    }
  }

  const lastActivityByUser = new Map<string, Date>();
  for (const row of lastActivityRows) {
    const last = normalizeSqlTimestampDate(row.last);
    if (last) lastActivityByUser.set(row.userId, last);
  }

  return {
    rows: rows.map((r) => {
      const active = activeByUser.get(r.id);
      return {
        ...r,
        createdAt: normalizeSqlTimestampDate(r.createdAt) ?? new Date(0),
        activeAccess: active?.type ?? null,
        accessExpiresAt: active?.expiresAt ?? null,
        accessSource: active?.source ?? null,
        lastActivityAt: lastActivityByUser.get(r.id) ?? null,
      };
    }),
    total,
  };
}

export type AdminUserDetail = {
  id: string;
  email: string;
  name: string | null;
  role: string;
  emailVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
  emails: { email: string; isPrimary: boolean; verifiedAt: Date; addedAt: Date; addedVia: string }[];
  purchases: {
    id: number;
    email: string;
    type: AdminAccess;
    paymentMethod: "stripe" | "fio" | "creditas";
    status: "pending" | "active" | "expired" | "refunded";
    expiresAt: Date;
    createdAt: Date;
    kind: "paid" | "comp" | "staff";
    compReason: string | null;
    grantedBy: string | null;
  }[];
  progressCount: number;
  lastActivityAt: Date | null;
};

export async function getAdminUserDetail(db: Db, id: string): Promise<AdminUserDetail | null> {
  const u = await db.select().from(user).where(eq(user.id, id)).get();
  if (!u) return null;

  const emails = await db
    .select()
    .from(userEmails)
    .where(eq(userEmails.userId, id))
    .all();

  const purchases = await db
    .select()
    .from(purchase)
    .where(eq(purchase.userId, id))
    .orderBy(desc(purchase.createdAt))
    .all();

  const progressRow = await db
    .select({ c: sql<number>`count(*)` })
    .from(progress)
    .where(eq(progress.userId, id))
    .get();

  const lastActivityRow = await db
    .select({ last: sql<Date | number | string | null>`max(${lessonWatch.updatedAt})` })
    .from(lessonWatch)
    .where(eq(lessonWatch.userId, id))
    .get();

  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    emailVerified: u.emailVerified,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
    emails: emails.map((e) => ({
      email: e.email,
      isPrimary: e.isPrimary,
      verifiedAt: e.verifiedAt,
      addedAt: e.addedAt,
      addedVia: e.addedVia,
    })),
    purchases: purchases.map((p) => ({
      id: p.id,
      email: p.email,
      type: p.type as AdminAccess,
      paymentMethod: p.paymentMethod,
      status: p.status,
      expiresAt: p.expiresAt,
      createdAt: p.createdAt,
      kind: p.kind,
      compReason: p.compReason ?? null,
      grantedBy: p.grantedBy ?? null,
    })),
    progressCount: progressRow?.c ?? 0,
    lastActivityAt: normalizeSqlTimestampDate(lastActivityRow?.last),
  };
}

export async function updateAdminUser(
  db: Db,
  id: string,
  opts: { name?: string | null; role?: string },
): Promise<void> {
  const u = await db.select({ id: user.id }).from(user).where(eq(user.id, id)).get();
  if (!u) throw new Error("Uživatel nenalezen.");
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (opts.name !== undefined) {
    const trimmed = opts.name?.trim() ?? "";
    updates.name = trimmed || null;
  }
  if (opts.role !== undefined) {
    if (!VALID_ROLES.has(opts.role)) throw new Error("Neplatná role.");
    updates.role = opts.role;
  }
  await db.update(user).set(updates).where(eq(user.id, id));
}

export async function deleteAdminUser(db: Db, id: string): Promise<void> {
  const u = await db.select({ id: user.id }).from(user).where(eq(user.id, id)).get();
  if (!u) throw new Error("Uživatel nenalezen.");
  // Detach purchases (history is preserved, ties to user are cleared).
  await db.update(purchase).set({ userId: null }).where(eq(purchase.userId, id));
  // user_emails, session, account, progress all cascade via FK.
  await db.delete(user).where(eq(user.id, id));
}

/**
 * GDPR self-service výmaz účtu. Na rozdíl od admin deleteAdminUser() navíc
 * ANONYMIZUJE objednávky (purchase) — účetní stopa (částka, VS, faktura,
 * datum) zůstává kvůli zákonu o účetnictví, ale osobní údaje (e-mail, jméno,
 * firma) se přepíšou na neutrální hodnoty, takže z DB nejde osobu zpětně
 * identifikovat. Faktury ve Fakturoidu jsou samostatný systém s vlastní
 * retencí a tímhle se nemažou.
 *
 * Vrací počet anonymizovaných objednávek (pro audit/log).
 */
export async function anonymizeAndDeleteUser(db: Db, id: string): Promise<number> {
  const u = await db
    .select({ id: user.id, email: user.email })
    .from(user)
    .where(eq(user.id, id))
    .get();
  if (!u) throw new Error("Uživatel nenalezen.");

  // Stabilní neidentifikující placeholder. .invalid je rezervovaná TLD
  // (RFC 2606), takže e-mail nikdy nemůže patřit reálné schránce.
  const anonEmail = `deleted+${id}@deleted.invalid`;

  const affected = await db
    .update(purchase)
    .set({
      userId: null,
      email: anonEmail,
      companyName: null,
      companyIco: null,
      companyDic: null,
      companyAddress: null,
      companyCity: null,
      companyZip: null,
      contactName: null,
    })
    .where(eq(purchase.userId, id));

  // user_emails, session, account, progress kaskádují přes FK.
  await db.delete(user).where(eq(user.id, id));

  return (affected as { meta?: { changes?: number } }).meta?.changes ?? 0;
}

export async function grantAdminAccess(
  db: Db,
  opts: {
    userId: string;
    access: Exclude<AdminAccess, "free">;
    expiresAt: Date;
    grantedBy?: string | null;
    compReason?: string | null;
  },
): Promise<void> {
  const u = await db
    .select({ id: user.id, email: user.email, role: user.role })
    .from(user)
    .where(eq(user.id, opts.userId))
    .get();
  if (!u) throw new Error("Uživatel nenalezen.");
  if (u.role === "admin") {
    throw new Error("Administrátor má přístup z titulu role, grant není potřeba.");
  }
  const now = new Date();
  await db.insert(purchase).values({
    email: u.email,
    userId: u.id,
    type: opts.access,
    paymentMethod: "stripe",   // historický artefakt — pro comp irelevantní
    stripePaymentId: null,
    status: "active",
    kind: "comp",
    grantedBy: opts.grantedBy ?? null,
    compReason: opts.compReason ?? null,
    expiresAt: opts.expiresAt,
    createdAt: now,
  });
}

export async function revokeAdminPurchase(
  db: Db,
  opts: { userId: string; purchaseId: number },
): Promise<void> {
  const row = await db
    .select({ id: purchase.id })
    .from(purchase)
    .where(and(eq(purchase.id, opts.purchaseId), eq(purchase.userId, opts.userId)))
    .get();
  if (!row) throw new Error("Grant nenalezen.");
  await db
    .update(purchase)
    .set({ status: "expired", expiresAt: new Date() })
    .where(eq(purchase.id, opts.purchaseId));
}

export async function extendAdminPurchase(
  db: Db,
  opts: { userId: string; purchaseId: number; expiresAt: Date },
): Promise<void> {
  const row = await db
    .select({ id: purchase.id })
    .from(purchase)
    .where(and(eq(purchase.id, opts.purchaseId), eq(purchase.userId, opts.userId)))
    .get();
  if (!row) throw new Error("Grant nenalezen.");
  await db
    .update(purchase)
    .set({ status: "active", expiresAt: opts.expiresAt })
    .where(eq(purchase.id, opts.purchaseId));
}

export async function createAdminUsers(
  db: Db,
  opts: {
    emails: string;
    name?: string;
    role?: string;
    access?: string;
    expiresAt?: Date;
    grantedBy?: string | null;
    compReason?: string | null;
  },
): Promise<{ created: CreateAdminUserResult[]; errors: { email: string; message: string }[] }> {
  const emails = parsePastedEmails(opts.emails);
  if (emails.length === 0) {
    throw new Error("Vlož alespoň jeden platný e-mail.");
  }

  const created: CreateAdminUserResult[] = [];
  const errors: { email: string; message: string }[] = [];
  const sharedName = emails.length === 1 ? opts.name : undefined;

  for (const email of emails) {
    try {
      created.push(await createAdminUser(db, {
        email,
        name: sharedName,
        role: opts.role,
        access: opts.access,
        expiresAt: opts.expiresAt,
        grantedBy: opts.grantedBy,
        compReason: opts.compReason,
      }));
    } catch (err) {
      errors.push({ email, message: (err as Error).message || "Uživatele se nepodařilo založit." });
    }
  }

  return { created, errors };
}
