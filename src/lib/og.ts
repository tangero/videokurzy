// Open Graph / X (Twitter) card podklady pro sdílení epizod na sociálních sítích.

import type { Env } from "../types";
import { fetchBunnyVideo, signPullZoneUrl } from "./transcribe";

export const DEFAULT_OG_DESCRIPTION =
  "Naučte se vibe coding s Claude Code. 10 epizod, od nápadu po deployment.";

/**
 * Z markdownu popisu lekce udělá krátký prostý text pro og:description.
 * Bere první odstavce, odstraní markdown syntaxi a ořízne na celé slovo.
 */
export function markdownExcerpt(markdown: string | null | undefined, maxLength = 200): string {
  if (!markdown) return "";
  const text = markdown
    .replace(/\r\n/g, "\n")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/gm, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(\*|_)(.+?)\1/g, "$2")
    .replace(/\s+/g, " ")
    .trim();

  if (text.length <= maxLength) return text;
  const cut = text.slice(0, maxLength - 1);
  const lastSpace = cut.lastIndexOf(" ");
  const base = lastSpace > maxLength * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${base.replace(/[\s,.;:–-]+$/, "")}…`;
}

/** Popis epizody pro og:description — výtah z bodyMarkdown, jinak obecný fallback. */
export function lessonOgDescription(
  bodyMarkdown: string | null | undefined,
  moduleTitle?: string | null,
): string {
  const excerpt = markdownExcerpt(bodyMarkdown);
  if (excerpt) return excerpt;
  if (moduleTitle) return `Epizoda z modulu ${moduleTitle} — videokurz Claude Code s Patrickem.`;
  return DEFAULT_OG_DESCRIPTION;
}

/** Veřejná URL náhledového obrázku epizody (proxy přes worker, viz routes/watch.tsx). */
export function lessonOgImagePath(slug: string): string {
  return `/og/watch/${encodeURIComponent(slug)}.jpg`;
}

/**
 * Stáhne thumbnail videa z Bunny pull zóny. Pull zóna blokuje přímý přístup
 * (Referer, případně token auth), takže crawler Facebooku/X by ho napřímo
 * nedostal — proto obrázek servírujeme přes worker.
 */
export async function fetchLessonThumbnail(env: Env, videoId: string): Promise<Response | null> {
  if (!env.BUNNY_PULL_ZONE) return null;

  // Vlastní thumbnail (nastavený z adminu) má jiné jméno souboru než default.
  let fileName = "thumbnail.jpg";
  try {
    const video = await fetchBunnyVideo(env, videoId);
    if (video.thumbnailFileName) fileName = video.thumbnailFileName;
  } catch (err) {
    console.error(`[og] bunny video ${videoId}: ${(err as Error).message}`);
  }

  const host = env.BUNNY_PULL_ZONE.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const path = `/${videoId}/${fileName}`;
  const signedPath = env.BUNNY_PULL_ZONE_TOKEN
    ? signPullZoneUrl(path, env.BUNNY_PULL_ZONE_TOKEN, 300)
    : path;
  const authUrl = env.BETTER_AUTH_URL?.replace(/\/$/, "") ?? "";
  const referer = authUrl && !authUrl.includes("localhost")
    ? `${authUrl}/`
    : "https://kurzy.vibecoding.cz/";

  const res = await fetch(`https://${host}${signedPath}`, { headers: { Referer: referer } });
  if (!res.ok) {
    console.error(`[og] thumbnail ${videoId} ${res.status}`);
    return null;
  }
  return res;
}
