// Bunny Stream Transcribe AI integrace.
// Docs: https://docs.bunny.net/api-reference/stream/manage-videos/transcribe-video
//       https://docs.bunny.net/stream/transcribing

import type { Env } from "../types";

const BUNNY_API_BASE = "https://video.bunnycdn.com";

export type BunnyCaption = {
  srclang: string;
  label: string;
  version?: number;
};

export type BunnyVideo = {
  guid: string;
  title: string;
  length: number;
  status: number;
  captions: BunnyCaption[] | null;
};

/** Spustí transkripci videa. Zdrojový jazyk default čeština. */
export async function triggerTranscribe(
  env: Env,
  videoId: string,
  opts: { sourceLanguage?: string; targetLanguages?: string[]; force?: boolean } = {},
): Promise<void> {
  const sourceLanguage = opts.sourceLanguage ?? "cs";
  const url = new URL(
    `${BUNNY_API_BASE}/library/${env.BUNNY_LIBRARY_ID}/videos/${videoId}/transcribe`,
  );
  if (opts.force) url.searchParams.set("force", "true");

  const body = {
    sourceLanguage,
    targetLanguages: opts.targetLanguages ?? [],
    generateTitle: false,
    generateDescription: false,
    generateChapters: false,
    generateMoments: false,
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      AccessKey: env.BUNNY_API_KEY,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Bunny transcribe ${res.status}: ${detail || res.statusText}`);
  }
}

/** Načte metadata videa včetně dostupných caption tracků. */
export async function fetchBunnyVideo(env: Env, videoId: string): Promise<BunnyVideo> {
  const res = await fetch(
    `${BUNNY_API_BASE}/library/${env.BUNNY_LIBRARY_ID}/videos/${videoId}`,
    {
      headers: { AccessKey: env.BUNNY_API_KEY, Accept: "application/json" },
    },
  );
  if (!res.ok) {
    throw new Error(`Bunny get video ${res.status}: ${res.statusText}`);
  }
  return (await res.json()) as BunnyVideo;
}

/** Stáhne VTT soubor pro daný jazyk z pull zone a vrátí jeho obsah. */
export async function fetchCaptionVtt(
  env: Env,
  videoId: string,
  srclang: string,
): Promise<string | null> {
  if (!env.BUNNY_PULL_ZONE) return null;
  const host = env.BUNNY_PULL_ZONE.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const url = `https://${host}/${videoId}/captions/${srclang}.vtt`;
  const res = await fetch(url);
  if (!res.ok) return null;
  return await res.text();
}

/**
 * Převede VTT obsah na čistý text. Zachovává odstavce (prázdné řádky),
 * odstraňuje WEBVTT hlavičku, časová razítka, cue identifikátory a HTML tagy.
 */
export function vttToPlainText(vtt: string): string {
  const lines = vtt.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let prevWasBlank = true;
  let inNote = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      if (inNote) {
        inNote = false;
        continue;
      }
      if (!prevWasBlank) out.push("");
      prevWasBlank = true;
      continue;
    }
    if (inNote) continue;
    if (/^WEBVTT/i.test(line)) continue;
    if (/^NOTE(\s|$)/i.test(line)) {
      inNote = true;
      continue;
    }
    // Časová razítka: 00:00:00.000 --> 00:00:05.000
    if (/-->/.test(line)) continue;
    // Cue identifikátor (samotné číslo nebo slovo bez interpunkce a před časem)
    if (/^\d+$/.test(line)) continue;
    // Strip HTML/VTT tagy <c>, <i>, <v Speaker>, <00:00:00.000>
    const text = line
      .replace(/<\d{2}:\d{2}:\d{2}\.\d{3}>/g, "")
      .replace(/<[^>]+>/g, "")
      .trim();
    if (!text) continue;
    out.push(text);
    prevWasBlank = false;
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Zjistí, zda má video český caption track. */
export function hasCzechCaption(video: BunnyVideo): boolean {
  if (!video.captions) return false;
  return video.captions.some((c) => c.srclang.toLowerCase().startsWith("cs"));
}
