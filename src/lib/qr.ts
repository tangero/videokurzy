// Server-side QR code SVG generation přes uqr (pure JS, edge-compatible).

import { encode } from "uqr";

/**
 * Generuje QR kód jako inline SVG řetězec.
 * ECC level "M" (Medium) — vyvážení robustnosti a velikosti.
 */
export function generateQRSvg(data: string, size: number = 240): string {
  const result = encode(data, { ecc: "M" });
  const modules = result.data;
  const moduleCount = modules.length;
  const cellSize = size / moduleCount;

  let paths = "";
  for (let row = 0; row < moduleCount; row++) {
    for (let col = 0; col < moduleCount; col++) {
      if (modules[row][col]) {
        const x = (col * cellSize).toFixed(2);
        const y = (row * cellSize).toFixed(2);
        const s = cellSize.toFixed(2);
        paths += `M${x},${y}h${s}v${s}h-${s}z`;
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}"><path d="${paths}" fill="#000"/></svg>`;
}
