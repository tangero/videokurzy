/**
 * Fakturoid API v3 client — OAuth2 Client Credentials.
 * Vytváří subjects + zaplacené faktury pro nákupy kurzů (FIO + Stripe).
 *
 * Adaptováno z vibecoding-site (worskhopová registrace) → videokurzy
 * (roční přístup ke kurzům). Klíčový rozdíl: tady nemáme firemní billing
 * údaje (ICO/DIČ/adresa) — invoice se vystavuje na e-mail.
 */

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

async function apiRequest(
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

async function createSubject(
  env: FakturoidEnv,
  data: PurchaseInvoiceData,
): Promise<FakturoidSubject> {
  // Pro org licenci pojmenuj subject podle domény (zvýrazní v Fakturoidu),
  // pro individual jen e-mailem (žádné firemní jméno nemáme).
  const name =
    data.type === "organization" && data.domain
      ? `${data.domain} (firemní licence)`
      : data.email;
  return (await apiRequest(env, "POST", "subjects.json", {
    name,
    email: data.email,
  })) as FakturoidSubject;
}

async function createPaidInvoice(
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

  const invoice = (await apiRequest(env, "POST", "invoices.json", {
    subject_id: subjectId,
    payment_method: "bank",
    currency: "CZK",
    vat_price_mode: "without_vat",
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

  // mark_as_sent dává faktuře číslo a vytvoří PDF.
  try {
    await apiRequest(env, "POST", `invoices/${invoice.id}/fire.json?event=mark_as_sent`);
  } catch (e) {
    console.error("Fakturoid: fire mark_as_sent failed:", e);
  }

  // Zaznamenat platbu — datem dnešní den.
  try {
    await apiRequest(env, "POST", `invoices/${invoice.id}/payments.json`, {
      paid_on: new Date().toISOString().split("T")[0],
      amount: data.amount,
      currency: "CZK",
    });
  } catch (e) {
    console.error("Fakturoid: record payment failed:", e);
  }

  return invoice;
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
 * Hlavní orchestrace — vytvoří subject (pokud neexistuje), vystaví zaplacenou
 * fakturu, volitelně ji odešle emailem. Vrací invoice + subject ID pro uložení
 * do `purchase` (pro pozdější dobropisy / audit).
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

    const subject = await createSubject(env, data);
    const invoice = await createPaidInvoice(env, subject.id, data);
    const slug = await getAccountSlug(env);

    console.log(`Fakturoid: invoice ${invoice.id} for ${data.email} (${data.type})`);

    if (options?.sendEmail) {
      try {
        await sendInvoiceEmail(env, invoice.id, data.email);
      } catch (e) {
        console.error("Fakturoid: send invoice email failed:", e);
      }
    }

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
