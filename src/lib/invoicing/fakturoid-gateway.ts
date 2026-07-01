/**
 * FakturoidInvoiceGateway (plán docs/fakturacni-system-revize.md v1.0.0, sekce 5.3).
 *
 * Tři NEZÁVISLE IDEMPOTENTNÍ kroky vystavení faktury. Každý před zápisem ověří
 * vzdálený stav, takže lze bezpečně opakovat (resume po částečném selhání / pádu):
 *   - ensureInvoiceCreated  — lookup dle custom_id → adopt | POST create
 *   - ensurePaymentRecorded — GET → už zaplaceno? → jen ts; jinak POST; nesoulad → mismatch
 *   - ensureInvoiceSent     — GET sent_at → už odesláno? jinak POST message.json
 *
 * Gateway pracuje nad injektovaným `FakturoidApi` (get/post) — díky tomu jdou
 * kroky testovat nad mock fetch bez OAuth/sítě. Reálný klient = makeFakturoidApi(env).
 *
 * ARES enrichment NENÍ v gatewayi (oproti staré exportPurchaseInvoice) — billing
 * snapshot se obohacuje při zakládání jobu v producer vrstvě. Gateway je tím
 * deterministický a Fakturoid-only.
 */

import { apiRequest, type FakturoidEnv } from "../fakturoid";
import type { JobKind } from "./jobs";

/** Tenké HTTP rozhraní nad Fakturoid API — injektovatelné kvůli testům. */
export interface FakturoidApi {
  get<T = unknown>(path: string): Promise<T>;
  post<T = unknown>(path: string, body?: unknown): Promise<T>;
}

/** Reálný klient nad existujícím apiRequest (OAuth2 + slug cache ve fakturoid.ts). */
export function makeFakturoidApi(env: FakturoidEnv): FakturoidApi {
  return {
    get: <T>(path: string) => apiRequest(env, "GET", path) as Promise<T>,
    post: <T>(path: string, body?: unknown) => apiRequest(env, "POST", path, body) as Promise<T>,
  };
}

const NOTE_PAID = "Neplaťte, faktura již byla uhrazena.";

interface FakturoidSubjectLike {
  id: number;
  email?: string | null;
  registration_no?: string | null;
}

interface FakturoidInvoiceLike {
  id: number;
  subject_id?: number;
  status?: string;
  paid_on?: string | null;
  sent_at?: string | null;
  payments?: Array<{ amount?: string | number }>;
}

/** Položka faktury — odvozeno stejně jako proforma (osobní předplatné / firemní licence). */
export function invoiceLineName(input: { jobKind: JobKind; isOrganization: boolean; domain?: string | null }): string {
  if (input.isOrganization) {
    return `Roční přístup ke kurzům — firemní licence${input.domain ? ` (${input.domain})` : ""}`;
  }
  return "Roční přístup ke kurzům — osobní předplatné";
}

/** Vstup pro vyřešení/založení Fakturoid subjektu (z billing snapshotu jobu). */
export interface SubjectInput {
  email: string;
  name: string;
  companyIco?: string | null;
  companyDic?: string | null;
  companyAddress?: string | null;
  companyCity?: string | null;
  companyZip?: string | null;
}

/**
 * Najde existující subjekt (dle IČO, pak dle e-mailu) nebo založí nový.
 * Idempotentní v praktickém smyslu — opakované volání nezaloží duplicitu, pokud
 * Fakturoid subjekt podle IČO/e-mailu najde.
 */
export async function ensureSubjectId(api: FakturoidApi, input: SubjectInput): Promise<number> {
  if (input.companyIco) {
    const byIco = await api.get<FakturoidSubjectLike[]>(
      `subjects/search.json?query=${encodeURIComponent(input.companyIco)}`,
    );
    const match = byIco?.find((s) => s.registration_no === input.companyIco);
    if (match) return match.id;
  }

  const byEmail = await api.get<FakturoidSubjectLike[]>(
    `subjects/search.json?query=${encodeURIComponent(input.email)}`,
  );
  const emailMatch = byEmail?.find((s) => (s.email ?? "").toLowerCase() === input.email.toLowerCase());
  if (emailMatch) return emailMatch.id;

  const created = await api.post<FakturoidSubjectLike>("subjects.json", {
    name: input.name,
    email: input.email,
    registration_no: input.companyIco ?? undefined,
    vat_no: input.companyDic ?? undefined,
    street: input.companyAddress ?? undefined,
    city: input.companyCity ?? undefined,
    zip: input.companyZip ?? undefined,
  });
  return created.id;
}

export interface InvoiceCreateInput {
  customId: string;
  lineName: string;
  amount: number;
  paidOn: string; // YYYY-MM-DD
  subject: SubjectInput;
  /** Doplněk k poznámce faktury, např. "VS: 33012345" u bankovních plateb. */
  noteSuffix?: string;
}

export interface InvoiceCreatedResult {
  invoiceId: number;
  subjectId: number | null;
  adopted: boolean;
}

/**
 * Krok 1 — vytvoří fakturu, nebo adoptuje existující se shodným custom_id.
 * Adopce řeší případ „POST prošel, DB zápis ne" (osiřelá faktura) — proto se
 * NIKDY nevytvoří druhá faktura pro stejný custom_id.
 */
export async function ensureInvoiceCreated(
  api: FakturoidApi,
  input: InvoiceCreateInput,
): Promise<InvoiceCreatedResult> {
  const existing = await api.get<FakturoidInvoiceLike[]>(
    `invoices.json?custom_id=${encodeURIComponent(input.customId)}`,
  );
  if (Array.isArray(existing) && existing.length > 0) {
    const inv = existing[0];
    return { invoiceId: inv.id, subjectId: inv.subject_id ?? null, adopted: true };
  }

  const subjectId = await ensureSubjectId(api, input.subject);
  const created = await api.post<FakturoidInvoiceLike>("invoices.json", {
    custom_id: input.customId,
    subject_id: subjectId,
    payment_method: "bank",
    currency: "CZK",
    vat_price_mode: "without_vat",
    issued_on: input.paidOn,
    taxable_fulfillment_due: input.paidOn,
    lines: [{ name: input.lineName, quantity: 1, unit_price: input.amount, vat_rate: 0 }],
    note: [NOTE_PAID, input.noteSuffix].filter(Boolean).join(" "),
  });
  return { invoiceId: created.id, subjectId, adopted: false };
}

export type PaymentRecordResult =
  | { status: "recorded" }
  | { status: "already_paid" }
  | { status: "mismatch"; remoteTotal: number };

/**
 * Krok 2 — zaeviduje platbu idempotentně. Před POST ověří vzdálený stav: když je
 * faktura už zaplacená nebo má platby, nepouští POST znovu (oponentura 0.3 B2).
 * Existující platba s JINOU částkou → `mismatch` (volající → needs_manual_review).
 */
export async function ensurePaymentRecorded(
  api: FakturoidApi,
  invoiceId: number,
  amount: number,
  paidOn: string,
): Promise<PaymentRecordResult> {
  const inv = await api.get<FakturoidInvoiceLike>(`invoices/${invoiceId}.json`);
  const payments = inv.payments ?? [];

  if (payments.length > 0) {
    const total = payments.reduce((sum, p) => sum + Number(p.amount ?? 0), 0);
    if (Math.round(total) !== Math.round(amount)) {
      return { status: "mismatch", remoteTotal: Math.round(total) };
    }
    return { status: "already_paid" };
  }
  if (inv.status === "paid" || inv.paid_on) {
    return { status: "already_paid" };
  }

  await api.post(`invoices/${invoiceId}/payments.json`, {
    paid_on: paidOn,
    amount,
    currency: "CZK",
  });
  return { status: "recorded" };
}

export type InvoiceSendResult = { status: "sent" } | { status: "already_sent" };

/**
 * Krok 3 — odešle fakturu zákazníkovi přes Fakturoid. Idempotence přes `sent_at`:
 * když Fakturoid hlásí už odeslané, e-mail se nepošle znovu (oponentura 0.2 V2).
 */
export async function ensureInvoiceSent(
  api: FakturoidApi,
  invoiceId: number,
  email: string,
): Promise<InvoiceSendResult> {
  const inv = await api.get<FakturoidInvoiceLike>(`invoices/${invoiceId}.json`);
  if (inv.sent_at) return { status: "already_sent" };

  await api.post(`invoices/${invoiceId}/message.json`, {
    email,
    subject: "Faktura za roční přístup ke kurzům — kurzy.vibecoding.cz",
    message:
      "Dobrý den,\n\nv příloze zasíláme fakturu za roční přístup ke kurzům.\n\n" +
      "Děkujeme.\n\n#link#\n\nvibecoding.cz",
  });
  return { status: "sent" };
}
