// Řazení vydání newslettru v adminu. NELZE řadit podle createdAt: vydání se
// dodělávají zpětně (Week 25 vytvořený až po Week 26), takže pořadí vzniku
// záznamu neodpovídá chronologii obsahu. Řadíme primárně podle verze softwaru
// (versionRange monotónně roste), s fallbackem na číslo týdne a nakonec createdAt.

/** Prvek s poli potřebnými pro řazení. */
export interface SortableNewsItem {
  versionRange: string | null;
  weekLabel: string | null;
  createdAt: Date;
}

/**
 * Numerický klíč z nejvyšší verze v rozsahu, např. „v2.1.178–v2.1.183" → 2001183.
 * Bere HORNÍ mez rozsahu (poslední verze v týdnu). Lexikografické řazení textu
 * by selhalo (v2.1.9 > v2.1.185), proto skládáme komponenty do jednoho čísla
 * s dostatečnou rezervou (1000 na komponentu). Vrací null, když verzi nelze číst.
 */
export function versionSortKey(versionRange: string | null): number | null {
  if (!versionRange) return null;
  // Posbírej všechny „x.y.z" v řetězci; horní mez rozsahu je ta poslední/největší.
  const versions = [...versionRange.matchAll(/(\d+)\.(\d+)\.(\d+)/g)].map(
    (m) => Number(m[1]) * 1_000_000 + Number(m[2]) * 1_000 + Number(m[3]),
  );
  if (versions.length === 0) return null;
  return Math.max(...versions);
}

/** Číslo týdne z „Week 26" → 26. Vrací null, když ho nelze přečíst. */
export function weekSortKey(weekLabel: string | null): number | null {
  if (!weekLabel) return null;
  const m = weekLabel.match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

/**
 * Sestupné řazení vydání (nejnovější nahoře) podle verze softwaru → týdne →
 * createdAt. Stabilní: při úplné shodě zachová vstupní pořadí. Prvky bez verze
 * i bez týdne padají naspod (řadí se jen mezi sebou dle createdAt).
 */
export function sortNewsItems<T extends SortableNewsItem>(items: T[]): T[] {
  return items
    .map((it, i) => ({ it, i }))
    .sort((a, b) => {
      const va = versionSortKey(a.it.versionRange);
      const vb = versionSortKey(b.it.versionRange);
      if (va !== null && vb !== null && va !== vb) return vb - va;
      if (va !== null && vb === null) return -1;
      if (va === null && vb !== null) return 1;

      const wa = weekSortKey(a.it.weekLabel);
      const wb = weekSortKey(b.it.weekLabel);
      if (wa !== null && wb !== null && wa !== wb) return wb - wa;
      if (wa !== null && wb === null) return -1;
      if (wa === null && wb !== null) return 1;

      const ca = a.it.createdAt.getTime();
      const cb = b.it.createdAt.getTime();
      if (ca !== cb) return cb - ca;
      return a.i - b.i;
    })
    .map((x) => x.it);
}
