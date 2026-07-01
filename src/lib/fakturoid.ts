/**
 * Fakturoid API v3 client — OAuth2 Client Credentials.
 * Vytváří subjects + zaplacené faktury pro nákupy kurzů (FIO + Stripe).
 *
 * Adaptováno z vibecoding-site (worskhopová registrace) → videokurzy
 * (roční přístup ke kurzům). Klíčový rozdíl: tady nemáme firemní billing
 * údaje (ICO/DIČ/adresa) — invoice se vystavuje na e-mail.
 */

import { maskEmail } from "./errors";

const API_BASE = "https://app.fakturoid.cz/api/v3";
const USER_AGENT = "VibeCoding kurzy (patrick@zandl.cz)";

// In-memory cache pro access token a account slug — token má platnost 2h,
// slug se nemění. Cache přežije v rámci jednoho worker isolatu.
let cachedToken: { token: string; expiresAt: number } | null = null;
let cachedSlug: string | null = null;

export interface FakturoidEnv {
  FAKTUROID_CLIENT_ID?: string;
  FAKTUROID_CLIENT_SECRET?: string;
}

interface FakturoidSubject {
  id: number;
  name: string;
  email?: string;
  registration_no?: string;
  vat_no?: string;
  street?: string;
  city?: string;
  zip?: string;
}

interface FakturoidInvoice {
  id: number;
  number?: string;
  public_html_url?: string;
}

export interface PurchaseInvoiceData {
  email: string;
  type: "individual" | "organization";
  domain?: string | null;
  amount: number;
  variableSymbol?: string | null;
  // Firemní fakturační údaje (volitelné). Když je companyIco vyplněné,
  // fakturuje se na firmu a subjekt v Fakturoidu se hledá/zakládá podle IČO.
  companyName?: string | null;
  companyIco?: string | null;
  companyDic?: string | null;
  companyAddress?: string | null;
  companyCity?: string | null;
  companyZip?: string | null;
  contactName?: string | null;
}

async function getAccessToken(env: FakturoidEnv): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.token;
  }

  const clientId = env.FAKTUROID_CLIENT_ID;
  const clientSecret = env.FAKTUROID_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Fakturoid credentials nejsou nakonfigurované");
  }

  const credentials = btoa(`${clientId}:${clientSecret}`);
  const res = await fetch(`${API_BASE}/oauth/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": USER_AGENT,
    },
    body: JSON.stringify({ grant_type: "client_credentials" }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Fakturoid OAuth failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in?: number };
  // 5 minut buffer před expirací — token je obvykle platný 2h.
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + ((data.expires_in || 7200) - 300) * 1000,
  };

  return cachedToken.token;
}

async function getAccountSlug(env: FakturoidEnv): Promise<string> {
  if (cachedSlug) return cachedSlug;

  const token = await getAccessToken(env);
  const res = await fetch(`${API_BASE}/user.json`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "User-Agent": USER_AGENT,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Fakturoid user fetch failed (${res.status}): ${text}`);
  }

  const user = (await res.json()) as { accounts?: Array<{ slug: string }> };
  if (!user.accounts?.length) {
    throw new Error("Žádný Fakturoid účet nebyl nalezen");
  }

  cachedSlug = user.accounts[0].slug;
  return cachedSlug;
}

export async function apiRequest(
  env: FakturoidEnv,
  method: string,
  path: string,
  body?: unknown,
): Promise<unknown> {
  const token = await getAccessToken(env);
  const slug = await getAccountSlug(env);

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "User-Agent": USER_AGENT,
  };

  if (body) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(`${API_BASE}/accounts/${slug}/${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Fakturoid API ${method} ${path} failed (${res.status}): ${text}`);
  }

  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return res.json();
  }
  return null;
}

/**
 * Najde subjekt podle IČO. Fakturoid `subjects/search.json` hledá fulltext —
 * filtrujeme až na klientu na přesnou shodu registration_no. Vrací null pokud nic.
 */
async function findSubjectByIco(
  env: FakturoidEnv,
  ico: string,
): Promise<FakturoidSubject | null> {
  try {
    const results = (await apiRequest(
      env,
      "GET",
      `subjects/search.json?query=${encodeURIComponent(ico)}`,
    )) as FakturoidSubject[] | null;
    if (!results?.length) return null;
    const match = results.find((s) => s.registration_no === ico);
    if (!match) return null;
    return (await apiRequest(env, "GET", `subjects/${match.id}.json`)) as FakturoidSubject;
  } catch {
    return null;
  }
}

/**
 * Pokud uživatel zadal jen IČO bez ostatních polí (nebo UI selhalo),
 * dotáhneme zbytek přímo z ARES. Best-effort — při výpadku ARES vrátí null
 * a faktura se vystaví s tím, co máme.
 */
async function enrichFromAres(
  ico: string,
): Promise<Partial<PurchaseInvoiceData> | null> {
  try {
    const res = await fetch(
      `https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty/${ico}`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      obchodniJmeno?: string;
      dic?: string;
      sidlo?: {
        nazevUlice?: string;
        cisloDomovni?: number;
        cisloOrientacni?: number;
        cisloOrientacniPismeno?: string;
        nazevObce?: string;
        psc?: number;
      };
    };
    const s = data.sidlo || {};
    let address = s.nazevUlice || "";
    if (s.cisloDomovni) {
      address += ` ${s.cisloDomovni}`;
      if (s.cisloOrientacni) {
        address += `/${s.cisloOrientacni}`;
        if (s.cisloOrientacniPismeno) address += s.cisloOrientacniPismeno;
      }
    }
    return {
      companyName: data.obchodniJmeno || undefined,
      companyDic: data.dic || undefined,
      companyAddress: address.trim() || undefined,
      companyCity: s.nazevObce || undefined,
      companyZip: s.psc ? String(s.psc).replace(/(\d{3})(\d{2})/, "$1 $2") : undefined,
    };
  } catch (err) {
    console.error("[fakturoid] ARES enrichment failed:", err);
    return null;
  }
}

function mergeAresEnrichment(
  data: PurchaseInvoiceData,
  ares: Partial<PurchaseInvoiceData> | null,
): PurchaseInvoiceData {
  if (!ares) return data;
  return {
    ...data,
    companyName: data.companyName || ares.companyName || null,
    companyDic: data.companyDic || ares.companyDic || null,
    companyAddress: data.companyAddress || ares.companyAddress || null,
    companyCity: data.companyCity || ares.companyCity || null,
    companyZip: data.companyZip || ares.companyZip || null,
  };
}

async function ensureSubject(
  env: FakturoidEnv,
  data: PurchaseInvoiceData,
): Promise<FakturoidSubject> {
  // 1) Pokud máme IČO, zkusíme najít existující subjekt → bez duplikátů
  //    při opakovaných nákupech od stejné firmy.
  if (data.companyIco) {
    const existing = await findSubjectByIco(env, data.companyIco);
    if (existing) return existing;
  }

  // 2) Sestavíme nový subjekt. Pro firemní fakturaci s IČO použijeme firemní
  //    název a billing pole; jinak fallback na původní pojmenování (doména /
  //    e-mail) které nemá registration_no.
  if (data.companyIco) {
    return (await apiRequest(env, "POST", "subjects.json", {
      name: data.companyName || data.companyIco,
      email: data.email,
      registration_no: data.companyIco,
      vat_no: data.companyDic || undefined,
      street: data.companyAddress || undefined,
      city: data.companyCity || undefined,
      zip: data.companyZip || undefined,
    })) as FakturoidSubject;
  }

  const name =
    data.type === "organization" && data.domain
      ? `${data.domain} (firemní licence)`
      : data.email;
  return (await apiRequest(env, "POST", "subjects.json", {
    name,
    email: data.email,
  })) as FakturoidSubject;
}

/**
 * Vytvoří fakturu ve stavu `open` (Vystavená). Stav přepne na `paid` až
 * záznam platby v `recordPayment` — `paid_on` na invoice je jen UI hint,
 * status řídí existence záznamu v `payments`.
 */
async function createInvoice(
  env: FakturoidEnv,
  subjectId: number,
  data: PurchaseInvoiceData,
): Promise<FakturoidInvoice> {
  const lineName =
    data.type === "organization"
      ? `Roční přístup ke kurzům — firemní licence (${data.domain ?? "neuvedeno"})`
      : "Roční přístup ke kurzům — osobní předplatné";

  const noteParts: string[] = ["Neplaťte, faktura již byla uhrazena."];
  if (data.variableSymbol) noteParts.push(`VS: ${data.variableSymbol}`);

  const today = new Date().toISOString().split("T")[0];
  const invoice = (await apiRequest(env, "POST", "invoices.json", {
    subject_id: subjectId,
    payment_method: "bank",
    currency: "CZK",
    vat_price_mode: "without_vat",
    issued_on: today,
    taxable_fulfillment_due: today,
    lines: [
      {
        name: lineName,
        quantity: 1,
        unit_price: data.amount,
        vat_rate: 0,
      },
    ],
    note: noteParts.join(" "),
  })) as FakturoidInvoice;

  return invoice;
}

/** Zaeviduje platbu — Fakturoid přepne fakturu na status `paid`. */
async function recordPayment(
  env: FakturoidEnv,
  invoiceId: number,
  amount: number,
): Promise<void> {
  await apiRequest(env, "POST", `invoices/${invoiceId}/payments.json`, {
    paid_on: new Date().toISOString().split("T")[0],
    amount,
    currency: "CZK",
  });
}

/**
 * Označí existující fakturu jako Zaplacenou. Užitečné pro retroaktivní opravu
 * starších faktur, které zůstaly ve stavu Vystavená/Odeslaná (např. když selhal
 * původní `payments.json` POST).
 */
export async function markInvoicePaid(
  env: FakturoidEnv,
  invoiceId: number,
  amount: number,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await apiRequest(env, "POST", `invoices/${invoiceId}/payments.json`, {
      paid_on: new Date().toISOString().split("T")[0],
      amount,
      currency: "CZK",
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/**
 * Najde subject podle e-mailu. Vrací první match (Fakturoid full-text search).
 * Vrací null pokud nic.
 */
export async function findSubjectByEmail(
  env: FakturoidEnv,
  email: string,
): Promise<{ id: number; name: string; email?: string } | null> {
  try {
    const results = (await apiRequest(
      env,
      "GET",
      `subjects/search.json?query=${encodeURIComponent(email)}`,
    )) as Array<{ id: number; name: string; email?: string }> | null;
    if (!results?.length) return null;
    const exact = results.find((s) => s.email?.toLowerCase() === email.toLowerCase());
    return exact ?? results[0];
  } catch {
    return null;
  }
}

/**
 * Vypíše faktury subjektu seřazené od nejnovější. Užitečné pro dohledání
 * osiřelé faktury, která se vytvořila v Fakturoidu ale fakturoidInvoiceId se
 * neuložil do naší DB (např. kvůli zabitým promises ve worker isolatu).
 */
export async function listSubjectInvoices(
  env: FakturoidEnv,
  subjectId: number,
): Promise<Array<{ id: number; status: string; total: number; issued_on: string }>> {
  try {
    const results = (await apiRequest(
      env,
      "GET",
      `invoices.json?subject_id=${subjectId}`,
    )) as Array<{ id: number; status: string; total: number; issued_on: string }> | null;
    return results ?? [];
  } catch {
    return [];
  }
}

/** Načte detail faktury (status, čísla, lines). */
export async function fetchInvoice(
  env: FakturoidEnv,
  invoiceId: number,
): Promise<Record<string, unknown> | null> {
  try {
    return (await apiRequest(env, "GET", `invoices/${invoiceId}.json`)) as Record<string, unknown>;
  } catch (err) {
    console.error(`Fakturoid: fetchInvoice ${invoiceId} failed:`, err);
    return null;
  }
}

async function sendInvoiceEmail(
  env: FakturoidEnv,
  invoiceId: number,
  email: string,
): Promise<void> {
  await apiRequest(env, "POST", `invoices/${invoiceId}/message.json`, {
    email,
    subject: "Faktura za roční přístup k videokurzu",
    message:
      "Dobrý den,\n\nv příloze zasíláme fakturu za roční přístup ke kurzům na kurzy.vibecoding.cz.\n\nDěkujeme za nákup.\n\n#link#\n\nVibecoding.cz",
  });
}

export interface ExportResult {
  ok: boolean;
  invoiceId?: number;
  subjectId?: number;
  accountSlug?: string;
  error?: string;
}

/**
 * Hlavní orchestrace pro nákup: create subject → create invoice → (volitelně)
 * pošli emailem → zaeviduj platbu. Konečný stav faktury je vždy `paid`.
 *
 * Pořadí kroků je klíčové. Fakturoid status drive existence záznamů, ne pole
 * `paid_on` na faktuře. Stavový přechod:
 *   1. POST /invoices.json → `open` (Vystavená).
 *   2. POST /invoices/{id}/message.json → `sent` (Odeslaná). Volitelné.
 *   3. POST /invoices/{id}/payments.json → `paid` (Zaplacená). VŽDY poslední,
 *      protože email by jinak vrátil stav zpět na `sent`.
 *
 * Tři chyby v minulosti, kterých se chceme vyhnout:
 *  - Fire-and-forget volání → worker zabil promise, faktura osiřela bez DB linku.
 *  - Spoléhat na `paid_on` v invoice body → status zůstal `open`, status řídí
 *    payments tabulka.
 *  - Poslat email po payments.json → status se vrátil z `paid` na `sent`.
 */
export async function exportPurchaseInvoice(
  env: FakturoidEnv,
  data: PurchaseInvoiceData,
  options?: { sendEmail?: boolean },
): Promise<ExportResult> {
  try {
    if (!env.FAKTUROID_CLIENT_ID || !env.FAKTUROID_CLIENT_SECRET) {
      return { ok: false, error: "Fakturoid credentials nejsou nakonfigurované" };
    }

    // Pokud máme IČO ale chybí ostatní billing pole (např. Stripe metadata
    // limit 500 znaků nedovolil vše), doplníme z ARES.
    const enriched = data.companyIco && !data.companyAddress
      ? mergeAresEnrichment(data, await enrichFromAres(data.companyIco))
      : data;

    const subject = await ensureSubject(env, enriched);
    const invoice = await createInvoice(env, subject.id, enriched);
    const slug = await getAccountSlug(env);

    if (options?.sendEmail) {
      try {
        await sendInvoiceEmail(env, invoice.id, data.email);
      } catch (e) {
        console.error("Fakturoid: send invoice email failed:", e);
      }
    }

    // VŽDY poslední krok — záznam platby přepne status na `paid`. Pokud
    // selže, faktura zůstane `sent` (po emailu) nebo `open` (bez emailu);
    // /admin/api/purchases/mark-invoices-paid umí takovou fakturu opravit.
    try {
      await recordPayment(env, invoice.id, data.amount);
    } catch (e) {
      console.error("Fakturoid: record payment failed:", e);
    }

    console.log(`Fakturoid: invoice ${invoice.id} for ${maskEmail(data.email)} (${data.type}) → paid`);

    return {
      ok: true,
      invoiceId: invoice.id,
      subjectId: subject.id,
      accountSlug: slug,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("Fakturoid export error:", msg);
    return { ok: false, error: msg };
  }
}
