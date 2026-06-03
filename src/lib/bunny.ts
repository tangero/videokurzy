import { createHmac } from "node:crypto";

const BUNNY_EMBED_BASE = "https://player.mediadelivery.net/embed";

export function generateSignedEmbedUrl(
  libraryId: string,
  videoId: string,
  tokenKey: string,
  expiryHours = 4,
  startSeconds = 0
): string {
  const expires = Math.floor(Date.now() / 1000) + expiryHours * 3600;
  const url = `${BUNNY_EMBED_BASE}/${libraryId}/${videoId}`;
  const hashableBase = `${tokenKey}${videoId}${expires}`;

  const token = createHmac("sha256", tokenKey)
    .update(hashableBase)
    .digest("hex");

  // autoplay=false: video se po načtení stránky NEspouští automaticky
  // (Bunny default je sice false, ale nastavujeme explicitně pro jistotu).
  // showSpeed=true: v nativním přehrávači se zobrazí ovládání rychlosti
  // přehrávání (Bunny neumí přednastavit výchozí rychlost ani ji měnit přes
  // Player.js API, jediná cesta je tenhle nativní prvek).
  let embed = `${url}?token=${token}&expires=${expires}&autoplay=false&showSpeed=true`;
  // t=<vteřiny>: video naběhne na uloženou pozici (resume z lesson_watch).
  if (startSeconds > 0) embed += `&t=${Math.floor(startSeconds)}`;
  return embed;
}
