// Podpora více Bunny Stream library.
//
// Hlavní library = stávající BUNNY_LIBRARY_ID / BUNNY_API_KEY / BUNNY_TOKEN_KEY
// (+ BUNNY_PULL_ZONE, BUNNY_PULL_ZONE_TOKEN). Další library se konfigurují
// JSON secretem BUNNY_EXTRA_LIBRARIES:
//
//   {"655172": {"apiKey": "…", "tokenKey": "…",
//               "pullZone": "vz-1d2aadf9-9ec.b-cdn.net", "pullZoneToken": "…",
//               "name": "Druhá library"}}
//
// Každá library má vlastní Stream API klíč i Token Authentication Key —
// account API klíč Bunny pro Stream API nepřijímá a token key přes API nevrací.
// Lekce nese `bunnyLibraryId`; NULL = hlavní library.

import type { Env } from "../types";
import { generateSignedEmbedUrl } from "./bunny";

const BUNNY_API_BASE = "https://video.bunnycdn.com";

export type BunnyLibrary = {
  id: string;
  name: string;
  apiKey: string;
  tokenKey: string;
  pullZone?: string;
  pullZoneToken?: string;
  isPrimary: boolean;
};

type LibraryEnv = Pick<
  Env,
  | "BUNNY_LIBRARY_ID"
  | "BUNNY_API_KEY"
  | "BUNNY_TOKEN_KEY"
  | "BUNNY_PULL_ZONE"
  | "BUNNY_PULL_ZONE_TOKEN"
  | "BUNNY_EXTRA_LIBRARIES"
>;

function primaryLibrary(env: LibraryEnv): BunnyLibrary {
  return {
    id: String(env.BUNNY_LIBRARY_ID),
    name: "Hlavní library",
    apiKey: env.BUNNY_API_KEY,
    tokenKey: env.BUNNY_TOKEN_KEY,
    pullZone: env.BUNNY_PULL_ZONE || undefined,
    pullZoneToken: env.BUNNY_PULL_ZONE_TOKEN || undefined,
    isPrimary: true,
  };
}

/**
 * Rozparsuje BUNNY_EXTRA_LIBRARIES. Nevalidní JSON nebo položka bez klíčů se
 * jen zaloguje a přeskočí — rozbitý secret nesmí shodit přehrávání hlavní library.
 */
function extraLibraries(env: LibraryEnv): BunnyLibrary[] {
  const raw = env.BUNNY_EXTRA_LIBRARIES?.trim();
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error("[bunny] BUNNY_EXTRA_LIBRARIES není validní JSON");
    return [];
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    console.error("[bunny] BUNNY_EXTRA_LIBRARIES musí být objekt {libraryId: {...}}");
    return [];
  }
  const out: BunnyLibrary[] = [];
  for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
    const v = (value ?? {}) as Record<string, unknown>;
    const apiKey = typeof v.apiKey === "string" ? v.apiKey : "";
    const tokenKey = typeof v.tokenKey === "string" ? v.tokenKey : "";
    if (!apiKey || !tokenKey) {
      console.error(`[bunny] library ${id}: chybí apiKey nebo tokenKey`);
      continue;
    }
    out.push({
      id: String(id).trim(),
      name: typeof v.name === "string" && v.name ? v.name : `Library ${id}`,
      apiKey,
      tokenKey,
      pullZone: typeof v.pullZone === "string" && v.pullZone ? v.pullZone : undefined,
      pullZoneToken:
        typeof v.pullZoneToken === "string" && v.pullZoneToken ? v.pullZoneToken : undefined,
      isPrimary: false,
    });
  }
  return out;
}

/** Všechny nakonfigurované library, hlavní první. */
export function getBunnyLibraries(env: LibraryEnv): BunnyLibrary[] {
  const primary = primaryLibrary(env);
  return [primary, ...extraLibraries(env).filter((l) => l.id !== primary.id)];
}

/**
 * Library pro lekci. Prázdné ID = hlavní library. Neznámé (nenakonfigurované)
 * ID vrací null — volající nesmí potichu použít hlavní library, protože by
 * vznikla URL na neexistující video.
 */
export function resolveBunnyLibrary(
  env: LibraryEnv,
  libraryId: string | null | undefined,
): BunnyLibrary | null {
  const id = libraryId?.trim();
  const libs = getBunnyLibraries(env);
  if (!id) return libs[0]!;
  return libs.find((l) => l.id === id) ?? null;
}

/**
 * Normalizuje ID library z formuláře pro uložení do DB: hlavní library → null
 * (změna BUNNY_LIBRARY_ID pak neosiří řádky), nakonfigurovaná extra → její ID,
 * neznámá → undefined (= chyba validace).
 */
export function normalizeLessonLibraryId(
  env: LibraryEnv,
  input: string | null | undefined,
): string | null | undefined {
  const lib = resolveBunnyLibrary(env, input);
  if (!lib) return undefined;
  return lib.isPrimary ? null : lib.id;
}

/**
 * Podepsaná embed URL videa lekce ve správné library. Nenakonfigurovaná
 * library → "" (stránka ukáže stav bez videa) + log, ne 500.
 */
export function lessonEmbedUrl(
  env: LibraryEnv,
  lesson: { bunnyVideoId: string | null; bunnyLibraryId: string | null },
  expiryHours = 4,
  startSeconds = 0,
): string {
  if (!lesson.bunnyVideoId) return "";
  const lib = resolveBunnyLibrary(env, lesson.bunnyLibraryId);
  if (!lib) {
    console.error(`[bunny] library ${lesson.bunnyLibraryId} není nakonfigurovaná (video ${lesson.bunnyVideoId})`);
    return "";
  }
  return generateSignedEmbedUrl(lib.id, lesson.bunnyVideoId, lib.tokenKey, expiryHours, startSeconds);
}

export type BunnyListedVideo = {
  guid: string;
  title: string;
  dateUploaded: string;
  length: number;
  status: number;
};

/**
 * Seznam videí v library, nejnovější první. Bunny řadí `orderBy=date`, ale
 * směr nedokumentuje — proto ještě řadíme podle dateUploaded sestupně.
 */
export async function listLibraryVideos(
  lib: BunnyLibrary,
  opts: { search?: string; itemsPerPage?: number } = {},
): Promise<{ items: BunnyListedVideo[]; totalItems: number }> {
  const url = new URL(`${BUNNY_API_BASE}/library/${lib.id}/videos`);
  url.searchParams.set("page", "1");
  url.searchParams.set("itemsPerPage", String(opts.itemsPerPage ?? 200));
  url.searchParams.set("orderBy", "date");
  if (opts.search) url.searchParams.set("search", opts.search);

  const res = await fetch(url, {
    headers: { AccessKey: lib.apiKey, Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Bunny list videos ${res.status}: ${res.statusText}`);
  }
  const data = (await res.json()) as {
    items?: Array<Record<string, unknown>> | null;
    totalItems?: number;
  };
  const items = (data.items ?? []).map((v) => ({
    guid: String(v.guid ?? ""),
    title: String(v.title ?? ""),
    dateUploaded: String(v.dateUploaded ?? ""),
    length: Number(v.length) || 0,
    status: Number(v.status) || 0,
  }));
  items.sort((a, b) => Date.parse(b.dateUploaded || "0") - Date.parse(a.dateUploaded || "0"));
  return { items, totalItems: Number(data.totalItems) || items.length };
}
