import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { and, desc, eq, like, ne, or, sql } from "drizzle-orm";
import { purchase, siteConfig } from "../db/schema";
import { user } from "../db/auth-schema";
import { requirePartnerKey } from "../middleware/partner-auth";
import {
  PRICE_INDIVIDUAL,
  PRICE_ORGANIZATION,
} from "../config/payment";
import type { Env } from "../types";
import type { DrizzleD1Database } from "drizzle-orm/d1";

/**
 * Partner-API for cross-worker integration with vibecoding-site admin.
 * Read-only access to purchase data, gated by `X-Partner-Key`.
 *
 * Endpoints:
 *   GET /api/partner/health          - liveness check
 *   GET /api/partner/purchases       - list with filters
 *   GET /api/partner/purchases/:id   - single purchase detail
 */
const partner = new Hono<{ Bindings: Env }>();

partner.use("/api/partner/*", requirePartnerKey);

// Per-key frekvenční limit: i s platným klíčem nelze rychle vyexfiltrovat
// celou DB objednávek. Pevné okno (tumbling bucket) je tu dostatečné.
const PARTNER_RATE_LIMIT_WINDOW_SECONDS = 60;
const PARTNER_RATE_LIMIT_MAX = 20;

partner.use("/api/partner/*", async (c, next) => {
  // Běží až PO ověření klíče — neautentizované požadavky odpadnou dřív
  // a counter tak vždy klíčujeme reálným autentizovaným klíčem.
  const key = c.req.header("X-Partner-Key") ?? "unknown";
  // Klíč hashujeme, ať v KV neleží surový secret.
  const hashBuffer = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(key),
  );
  const keyHash = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
  const bucket = Math.floor(Date.now() / (PARTNER_RATE_LIMIT_WINDOW_SECONDS * 1000));
  const kvKey = `partner_rate:${keyHash}:${bucket}`;
  const current = Number((await c.env.KV.get(kvKey)) ?? "0");
  if (current >= PARTNER_RATE_LIMIT_MAX) {
    return c.json({ error: "rate_limited" }, 429);
  }
  await c.env.KV.put(kvKey, String(current + 1), {
    expirationTtl: PARTNER_RATE_LIMIT_WINDOW_SECONDS * 2,
  });
  await next();
});

const VALID_STATUSES = ["pending", "active", "expired", "refunded"] as const;
type PurchaseStatus = (typeof VALID_STATUSES)[number];

interface Prices {
  individual: number;
  organization: number;
}

/**
 * Načte aktuální ceny ze `siteConfig` (admin je tam mění). Fallback na
 * konstanty z `config/payment.ts`. Pro historické objednávky to znamená,
 * že zobrazená částka odpovídá AKTUÁLNÍMU ceníku — historie cen není
 * v DB uložená.
 */
async function loadPrices(db: DrizzleD1Database): Promise<Prices> {
  const rows = await db.select().from(siteConfig);
  const cfg = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    individual: parseInt(cfg.price_individual ?? String(PRICE_INDIVIDUAL), 10),
    organization: parseInt(cfg.price_organization ?? String(PRICE_ORGANIZATION), 10),
  };
}

function basePrice(type: string, prices: Prices): number {
  return type === "organization" ? prices.organization : prices.individual;
}

function computeAmount(type: string, discountPercent: number, prices: Prices): number {
  const base = basePrice(type, prices);
  const pct = Math.max(0, Math.min(100, discountPercent || 0));
  return Math.round(base * (1 - pct / 100));
}

type PurchaseKind = "paid" | "comp" | "staff";

interface PurchaseRow {
  id: number;
  email: string;
  userId: string | null;
  type: "individual" | "organization";
  paymentMethod: "stripe" | "fio";
  variableSymbol: string | null;
  fioTransactionId: string | null;
  stripePaymentId: string | null;
  status: PurchaseStatus;
  expiresAt: Date;
  createdAt: Date;
  discountPercent: number;
  discountCode: string | null;
  fakturoidInvoiceId: number | null;
  fakturoidSubjectId: number | null;
  kind: PurchaseKind;
  compReason: string | null;
  grantedBy: string | null;
  amountPaid: number;
  userName: string | null;
}

function serializePurchase(row: PurchaseRow, prices: Prices) {
  const isPaid = row.kind === "paid";
  return {
    id: row.id,
    email: row.email,
    user_id: row.userId,
    contact_name: row.userName,
    type: row.type,
    payment_method: row.paymentMethod,
    variable_symbol: row.variableSymbol,
    fio_transaction_id: row.fioTransactionId,
    stripe_payment_id: row.stripePaymentId,
    status: row.status,
    kind: row.kind,
    comp_reason: row.compReason,
    granted_by: row.grantedBy,
    base_price: basePrice(row.type, prices),
    // Skutečně přijatá částka v Kč. Granty (comp/staff) i pending mají 0.
    amount: isPaid ? (row.amountPaid || 0) : 0,
    discount_percent: row.discountPercent,
    discount_code: row.discountCode,
    fakturoid_invoice_id: row.fakturoidInvoiceId,
    fakturoid_subject_id: row.fakturoidSubjectId,
    created_at: row.createdAt.toISOString(),
    expires_at: row.expiresAt.toISOString(),
  };
}

partner.get("/api/partner/health", (c) => {
  return c.json({ ok: true, service: "videokurzy", version: "1" });
});

partner.get("/api/partner/purchases", async (c) => {
  const db = drizzle(c.env.DB);
  const prices = await loadPrices(db);

  const url = new URL(c.req.url);
  const statusParam = url.searchParams.get("status") ?? "all";
  const kindParam = url.searchParams.get("kind"); // 'paid' | 'comp' | 'staff' | null
  const includeStaff = url.searchParams.get("include_staff") === "1";
  const search = (url.searchParams.get("search") ?? "").trim();
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
  const limit = Math.min(
    100,
    Math.max(1, parseInt(url.searchParams.get("limit") ?? "25", 10) || 25),
  );
  const offset = (page - 1) * limit;

  const conditions = [] as ReturnType<typeof eq>[];
  if (statusParam !== "all" && (VALID_STATUSES as readonly string[]).includes(statusParam)) {
    conditions.push(eq(purchase.status, statusParam as PurchaseStatus));
  }
  // Staff řádky (admin uživatelé) jsou audit, ne zákazníci — defaultně skryté.
  // Explicitní `kind` filtr má přednost; `include_staff=1` umožní zobrazit vše.
  if (kindParam && (["paid", "comp", "staff"] as const).includes(kindParam as PurchaseKind)) {
    conditions.push(eq(purchase.kind, kindParam as PurchaseKind));
  } else if (!includeStaff) {
    conditions.push(ne(purchase.kind, "staff"));
  }
  if (search) {
    const pattern = `%${search}%`;
    const searchCond = or(
      like(purchase.email, pattern),
      like(purchase.variableSymbol, pattern),
      like(purchase.discountCode, pattern),
    );
    if (searchCond) conditions.push(searchCond);
  }
  const whereExpr = conditions.length === 1
    ? conditions[0]
    : conditions.length > 1
      ? and(...conditions)
      : undefined;

  const baseQuery = db
    .select({
      id: purchase.id,
      email: purchase.email,
      userId: purchase.userId,
      type: purchase.type,
      paymentMethod: purchase.paymentMethod,
      variableSymbol: purchase.variableSymbol,
      fioTransactionId: purchase.fioTransactionId,
      stripePaymentId: purchase.stripePaymentId,
      status: purchase.status,
      expiresAt: purchase.expiresAt,
      createdAt: purchase.createdAt,
      discountPercent: purchase.discountPercent,
      discountCode: purchase.discountCode,
      fakturoidInvoiceId: purchase.fakturoidInvoiceId,
      fakturoidSubjectId: purchase.fakturoidSubjectId,
      kind: purchase.kind,
      compReason: purchase.compReason,
      grantedBy: purchase.grantedBy,
      amountPaid: purchase.amountPaid,
      userName: user.name,
    })
    .from(purchase)
    .leftJoin(user, eq(purchase.userId, user.id));

  const rows = (whereExpr
    ? await baseQuery.where(whereExpr).orderBy(desc(purchase.createdAt)).limit(limit).offset(offset)
    : await baseQuery.orderBy(desc(purchase.createdAt)).limit(limit).offset(offset)) as PurchaseRow[];

  const totalQuery = db
    .select({ count: sql<number>`count(*)` })
    .from(purchase);
  const [totalRow] = whereExpr ? await totalQuery.where(whereExpr) : await totalQuery;
  const total = Number(totalRow?.count ?? 0);

  // Stats across all rows (ignore current filter — gives consistent dashboard
  // numbers). Staff řádky jsou audit přístupu administrátorů a do statistik
  // zákazníků nepatří, takže je z agregace úplně vynecháme.
  const statsRows = (await db
    .select({
      status: purchase.status,
      type: purchase.type,
      discountPercent: purchase.discountPercent,
      kind: purchase.kind,
      amountPaid: purchase.amountPaid,
    })
    .from(purchase)
    .where(ne(purchase.kind, "staff"))) as Array<{
      status: PurchaseStatus;
      type: "individual" | "organization";
      discountPercent: number;
      kind: PurchaseKind;
      amountPaid: number;
    }>;

  let pending = 0;
  let activePaid = 0;
  let activeComp = 0;
  let expired = 0;
  let refunded = 0;
  let totalRevenue = 0;
  for (const s of statsRows) {
    if (s.status === "pending") pending++;
    else if (s.status === "active") {
      if (s.kind === "paid") {
        activePaid++;
        // Skutečně přijatá částka, ne dopočet z ceníku.
        totalRevenue += s.amountPaid || 0;
      } else {
        // comp (staff je vyfiltrován výše)
        activeComp++;
      }
    } else if (s.status === "expired") expired++;
    else if (s.status === "refunded") refunded++;
  }

  return c.json({
    items: rows.map((r) => serializePurchase(r, prices)),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / limit)),
    limit,
    stats: {
      total: statsRows.length,
      pending,
      // active = součet pro UI, plus rozpad pro nové dashboard karty.
      active: activePaid + activeComp,
      active_paid: activePaid,
      active_comp: activeComp,
      expired,
      refunded,
      // Revenue jen z reálně zaplacených objednávek.
      total_revenue: totalRevenue,
    },
  });
});

partner.get("/api/partner/purchases/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  if (!Number.isFinite(id)) {
    // Záměrně stejná odpověď jako u neexistujícího id — útočník nesmí
    // rozlišit "špatný formát" od "neexistuje" (žádný enumeration signál).
    return c.json({ error: "not_found" }, 404);
  }
  const db = drizzle(c.env.DB);
  const prices = await loadPrices(db);
  const [row] = (await db
    .select({
      id: purchase.id,
      email: purchase.email,
      userId: purchase.userId,
      type: purchase.type,
      paymentMethod: purchase.paymentMethod,
      variableSymbol: purchase.variableSymbol,
      fioTransactionId: purchase.fioTransactionId,
      stripePaymentId: purchase.stripePaymentId,
      status: purchase.status,
      expiresAt: purchase.expiresAt,
      createdAt: purchase.createdAt,
      discountPercent: purchase.discountPercent,
      discountCode: purchase.discountCode,
      fakturoidInvoiceId: purchase.fakturoidInvoiceId,
      fakturoidSubjectId: purchase.fakturoidSubjectId,
      kind: purchase.kind,
      compReason: purchase.compReason,
      grantedBy: purchase.grantedBy,
      amountPaid: purchase.amountPaid,
      userName: user.name,
    })
    .from(purchase)
    .leftJoin(user, eq(purchase.userId, user.id))
    .where(eq(purchase.id, id))
    .limit(1)) as PurchaseRow[];

  if (!row) {
    return c.json({ error: "not_found" }, 404);
  }
  return c.json({ purchase: serializePurchase(row, prices) });
});

export default partner;
