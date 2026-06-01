import { createHmac } from "node:crypto";

const BUNNY_EMBED_BASE = "https://player.mediadelivery.net/embed";

export function generateSignedEmbedUrl(
  libraryId: string,
  videoId: string,
  tokenKey: string,
  expiryHours = 4
): string {
  const expires = Math.floor(Date.now() / 1000) + expiryHours * 3600;
  const url = `${BUNNY_EMBED_BASE}/${libraryId}/${videoId}`;
  const hashableBase = `${tokenKey}${videoId}${expires}`;

  const token = createHmac("sha256", tokenKey)
    .update(hashableBase)
    .digest("hex");

  // autoplay=false: video se po načtení stránky NEspouští automaticky
  // (Bunny default je sice false, ale nastavujeme explicitně pro jistotu).
  return `${url}?token=${token}&expires=${expires}&autoplay=false`;
}
