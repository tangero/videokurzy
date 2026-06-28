/**
 * Job service fakturačního outboxu (plán docs/fakturacni-system-revize.md v1.0.0,
 * sekce 5.1–5.2). Deterministicky zakládá řádky `invoice_job` z normalizované
 * události `PaymentConfirmed` a zajišťuje DB-level dedup.
 *
 * Idempotence stojí na třech unique indexech tabulky (migrace 0031):
 *   - UNIQUE(customId)                                  — jeden Fakturoid custom_id = jedna faktura
 *   - UNIQUE(purchaseId) WHERE jobKind='initial_purchase' — max 1 vstupní faktura/purchase
 *   - UNIQUE(paymentSource, sourceEventId)              — dedup platební události
 *
 * `customId` se generuje ZDE (producer vrstva), nikdy v consumeru (oponentura 0.2 B5).
 * Tento modul NEsahá na Fakturoid ani na frontu — jen na DB. Vystavení faktury
 * řeší gateway/consumer (krok 3/4).
 */

import type { drizzle } from "drizzle-orm/d1";
import { invoiceJob } from "../../db/schema";

type Db = ReturnType<typeof drizzle>;

export type PaymentSource =
  | "stripe_checkout"
  | "stripe_renewal"
  | "fio"
  | "creditas"
  | "manual"
  | "backfill";

export type JobKind = "initial_purchase" | "stripe_renewal";

export type PaidAtSource =
  | "stripe_api"
  | "bank_api"
  | "manual_admin_input"
  | "fakturoid_paid_on"
  | "purchase_createdAt_fallback";

/** Billing snapshot k času platby — kopíruje se na fakturu i pro pozdější audit. */
export interface BillingSnapshot {
  email: string;
  invoiceEmail?: string | null;
  companyName?: string | null;
  companyIco?: string | null;
  companyDic?: string | null;
  companyAddress?: string | null;
  companyCity?: string | null;
  companyZip?: string | null;
  contactName?: string | null;
}

/**
 * Normalizovaná platební událost — jediný vstup pro založení fakturační úlohy.
 * Všichni producenti (Stripe webhook, bankovní scan, manual confirm, backfill)
 * mapují na tento tvar.
 */
export interface PaymentConfirmed {
  purchaseId: number;
  jobKind: JobKind;
  paymentSource: PaymentSource;
  /** Dedup klíč platební události (Stripe session/invoice id, bank tx id, manual-confirm-<id>). */
  sourceEventId?: string | null;
  /** Povinné pro jobKind='stripe_renewal' — vstupuje do customId. */
  stripeInvoiceId?: string | null;
  /** Skutečně přijatá částka v CZK (může přijít zlomková z banky → needs_manual_review). */
  amount: number;
  /** Timestamp pro SLA/řazení. */
  paidAt: Date;
  paidAtSource: PaidAtSource;
  /** 'estimated' joby se neodesílají automaticky e-mailem (gate ve fázi odeslání). */
  paidAtConfidence?: "exact" | "estimated";
  billing: BillingSnapshot;
  /**
   * Volitelný override počátečního stavu (backfill: 'needs_reconcile' pro existující
   * fakturu). Default se odvodí z validace částky.
   */
  initialState?: "pending" | "needs_reconcile" | "needs_manual_review";
}

export type CreateResult =
  | { status: "created"; jobId: number }
  | { status: "duplicate" };

const PRAGUE_TZ = "Europe/Prague";
const PAIDON_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: PRAGUE_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * Účetní datum (YYYY-MM-DD) v časové zóně Europe/Prague. Bankovní platba připsaná
 * 23:30 UTC patří do následujícího pražského dne — proto vždy převádět přes TZ,
 * ne `toISOString()` (oponentura 0.3 B3). `en-CA` locale dává přímo YYYY-MM-DD.
 */
export function paidOnFromDate(d: Date): string {
  return PAIDON_FMT.format(d);
}

/**
 * Deterministický Fakturoid `custom_id`. Vstupní faktura je vázaná na purchase,
 * renewal na konkrétní Stripe invoice (aby šlo mít víc faktur k jednomu subscription).
 */
export function customIdFor(pc: Pick<PaymentConfirmed, "jobKind" | "purchaseId" | "stripeInvoiceId">): string {
  if (pc.jobKind === "stripe_renewal") {
    if (!pc.stripeInvoiceId) {
      throw new Error("customIdFor: jobKind='stripe_renewal' vyžaduje stripeInvoiceId");
    }
    return `vk-stripe-invoice-${pc.stripeInvoiceId}`;
  }
  return `vk-purchase-${pc.purchaseId}`;
}

/**
 * Validace částky na celé koruny (O6). Banka může vrátit zlomek (Creditas string
 * "2000.00"); `.00` projde, jiná desetinná část je nejednoznačná → needs_manual_review.
 * ŽÁDNÉ tiché zaokrouhlení do účetnictví (oponentura 0.2 V4): hodnota se sice uloží
 * zaokrouhlená pro referenci, ale job jde k ruční kontrole.
 */
export function isWholeCrowns(amount: number): boolean {
  return Number.isFinite(amount) && Number.isInteger(amount);
}

/** Sestaví insert hodnoty pro `invoice_job` z `PaymentConfirmed`. */
export function buildInvoiceJobValues(pc: PaymentConfirmed): typeof invoiceJob.$inferInsert {
  const whole = isWholeCrowns(pc.amount);
  const state = pc.initialState ?? (whole ? "pending" : "needs_manual_review");
  const b = pc.billing;

  return {
    purchaseId: pc.purchaseId,
    jobKind: pc.jobKind,
    customId: customIdFor(pc),
    paymentSource: pc.paymentSource,
    sourceEventId: pc.sourceEventId ?? null,
    amount: Math.round(pc.amount),
    paidAt: pc.paidAt,
    paidOn: paidOnFromDate(pc.paidAt),
    paidAtSource: pc.paidAtSource,
    paidAtConfidence: pc.paidAtConfidence ?? "exact",
    email: b.email,
    invoiceEmail: b.invoiceEmail ?? null,
    companyName: b.companyName ?? null,
    companyIco: b.companyIco ?? null,
    companyDic: b.companyDic ?? null,
    companyAddress: b.companyAddress ?? null,
    companyCity: b.companyCity ?? null,
    companyZip: b.companyZip ?? null,
    contactName: b.contactName ?? null,
    state,
    // Když částka není celá koruna, zaznamenej důvod pro ruční kontrolu.
    lastErrorCode: whole ? null : "non_integer_amount",
    lastErrorMessage: whole ? null : `raw amount = ${pc.amount}`,
    attempts: 0,
    aresWarning: false,
    createdAt: new Date(),
  };
}

/**
 * Idempotentně založí fakturační úlohu. Při kolizi kteréhokoli unique indexu
 * (customId / initial_purchase / sourceEventId) NEvytvoří duplicitu a vrátí
 * `{ status: 'duplicate' }`. Bezpečné volat opakovaně i souběžně.
 *
 * Pozn.: enqueue do INVOICE_QUEUE řeší volající/producer (krok 4); i kdyby enqueue
 * selhal, řádek v DB zůstane a reconcile cron ho doručí (outbox, oponentura 0.2 B1).
 */
export async function createInvoiceJob(db: Db, pc: PaymentConfirmed): Promise<CreateResult> {
  const rows = await db
    .insert(invoiceJob)
    .values(buildInvoiceJobValues(pc))
    .onConflictDoNothing()
    .returning({ id: invoiceJob.id });

  if (rows.length === 0) return { status: "duplicate" };
  return { status: "created", jobId: rows[0].id };
}

/** Druh purchase, který se má fakturovat: reálná platba s nenulovou částkou. */
export function shouldInvoice(p: { kind: string; amountPaid: number }): boolean {
  return (p.kind === "paid" || p.kind === "manual") && p.amountPaid > 0;
}
