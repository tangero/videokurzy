import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { and, desc, eq, like, or, sql } from "drizzle-orm";
import { purchase } from "../db/schema";
import { user } from "../db/auth-schema";
import { requirePartnerKey } from "../middleware/partner-auth";
import {
  PRICE_INDIVIDUAL,
  PRICE_ORGANIZATION,
} from "../config/payment";
import type { Env } from "../types";

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

const VALID_STATUSES = ["pending", "active", "expired", "refunded"] as const;
type PurchaseStatus = (typeof VALID_STATUSES)[number];

function basePrice(type: string): number {
  return type === "organization" ? PRICE_ORGANIZATION : PRICE_INDIVIDUAL;
}

function computeAmount(type: string, discountPercent: number): number {
  const base = basePrice(type);
  const pct = Math.max(0, Math.min(100, discountPercent || 0));
  return Math.round(base * (1 - pct / 100));
}

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
  userName: string | null;
}

function serializePurchase(row: PurchaseRow) {
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
    base_price: basePrice(row.type),
    amount: computeAmount(row.type, row.discountPercent),
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

  const url = new URL(c.req.url);
  const statusParam = url.searchParams.get("status") ?? "all";
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

  // Stats across all rows (ignore current filter — gives consistent dashboard numbers).
  const statsRows = (await db
    .select({
      status: purchase.status,
      type: purchase.type,
      discountPercent: purchase.discountPercent,
    })
    .from(purchase)) as Array<{
      status: PurchaseStatus;
      type: "individual" | "organization";
      discountPercent: number;
    }>;

  let pending = 0;
  let active = 0;
  let expired = 0;
  let refunded = 0;
  let totalRevenue = 0;
  for (const s of statsRows) {
    if (s.status === "pending") pending++;
    else if (s.status === "active") {
      active++;
      totalRevenue += computeAmount(s.type, s.discountPercent);
    } else if (s.status === "expired") expired++;
    else if (s.status === "refunded") refunded++;
  }

  return c.json({
    items: rows.map(serializePurchase),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / limit)),
    limit,
    stats: {
      total: statsRows.length,
      pending,
      active,
      expired,
      refunded,
      total_revenue: totalRevenue,
    },
  });
});

partner.get("/api/partner/purchases/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  if (!Number.isFinite(id)) {
    return c.json({ error: "invalid_id" }, 400);
  }
  const db = drizzle(c.env.DB);
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
      userName: user.name,
    })
    .from(purchase)
    .leftJoin(user, eq(purchase.userId, user.id))
    .where(eq(purchase.id, id))
    .limit(1)) as PurchaseRow[];

  if (!row) {
    return c.json({ error: "not_found" }, 404);
  }
  return c.json({ purchase: serializePurchase(row) });
});

export default partner;
