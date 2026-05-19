/**
 * ARES lookup helper — vyhledávání ekonomických subjektů přes ARES API v3.
 * Použito v checkoutu (uživatel zadá IČO nebo název firmy) a jako server-side
 * enrichment ve Fakturoid exportu (kdyby UI selhalo).
 *
 * Port z vibecoding-site/src/pages/api/ares-lookup.ts (Astro) → Hono/Cloudflare.
 */

export interface AresCompany {
  company_name: string;
  ico: string;
  dic: string;
  address: string;
  city: string;
  zip: string;
}

interface AresSidlo {
  nazevStatu?: string;
  nazevObce?: string;
  nazevUlice?: string;
  cisloDomovni?: number;
  cisloOrientacni?: number;
  cisloOrientacniPismeno?: string;
  psc?: number;
}

interface AresSubjekt {
  obchodniJmeno?: string;
  ico?: string;
  dic?: string;
  sidlo?: AresSidlo;
}

function buildAddress(sidlo: AresSidlo): string {
  let address = sidlo.nazevUlice || "";
  if (sidlo.cisloDomovni) {
    address += ` ${sidlo.cisloDomovni}`;
    if (sidlo.cisloOrientacni) {
      address += `/${sidlo.cisloOrientacni}`;
      if (sidlo.cisloOrientacniPismeno) {
        address += sidlo.cisloOrientacniPismeno;
      }
    }
  }
  return address.trim();
}

function formatPostalCode(psc: number | undefined): string {
  if (!psc) return "";
  return String(psc).replace(/(\d{3})(\d{2})/, "$1 $2");
}

function mapSubjekt(s: AresSubjekt, fallbackIco?: string): AresCompany {
  const sidlo = s.sidlo || {};
  return {
    company_name: s.obchodniJmeno || "",
    ico: s.ico || fallbackIco || "",
    dic: s.dic || "",
    address: buildAddress(sidlo),
    city: sidlo.nazevObce || "",
    zip: formatPostalCode(sidlo.psc),
  };
}

/** Lookup podle přesného IČO. Vrací 1 výsledek nebo prázdné pole. */
export async function lookupByIco(ico: string): Promise<AresCompany[]> {
  const normalized = ico.trim().replace(/[^0-9]/g, "");
  if (!/^\d{7,8}$/.test(normalized)) return [];

  try {
    const res = await fetch(
      `https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty/${normalized}`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (res.status === 404) return [];
    if (!res.ok) throw new Error(`ARES API: ${res.status}`);

    const data = (await res.json()) as AresSubjekt;
    return [mapSubjekt(data, normalized)];
  } catch (err) {
    console.error("[ares] lookupByIco failed:", err);
    return [];
  }
}

/** Fulltext podle obchodního jména. Max 5 výsledků. */
export async function lookupByName(name: string): Promise<AresCompany[]> {
  if (name.trim().length < 3) return [];
  try {
    const res = await fetch(
      `https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty/vyhledat?obchodniJmeno=${encodeURIComponent(name)}&start=0&pocet=5`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) throw new Error(`ARES API: ${res.status}`);

    const data = (await res.json()) as { ekonomickeSubjekty?: AresSubjekt[] };
    return (data.ekonomickeSubjekty || []).map((s) => mapSubjekt(s));
  } catch (err) {
    console.error("[ares] lookupByName failed:", err);
    return [];
  }
}
