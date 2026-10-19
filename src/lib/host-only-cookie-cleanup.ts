// Session cookies Better Auth mají v produkci Domain=.vibecoding.cz (COOKIE_DOMAIN),
// aby je viděly i ostatní weby, např. diskuse na www.vibecoding.cz. Kdo se přihlásil
// dřív, má ještě starou cookie téhož jména bez Domain (jen kurzy.vibecoding.cz).
// Prohlížeč pak posílá obě, starší první, a Better Auth čte první výskyt — po
// odhlášení a novém přihlášení by tak četl starou neplatnou session. Proto při
// každém nastavení doménové cookie zároveň smažeme její variantu bez Domain.

const AUTH_COOKIE_NAME = /^(__Secure-)?better-auth\.[A-Za-z0-9_.-]+$/;

/** Set-Cookie hlavičky, které smažou variantu bez Domain ke každé doménové auth cookie. */
export function hostOnlyCookieCleanup(setCookies: string[]): string[] {
  const names = new Set<string>();
  for (const header of setCookies) {
    const name = header.slice(0, header.indexOf("=")).trim();
    if (!AUTH_COOKIE_NAME.test(name)) continue;
    if (!/;\s*domain=/i.test(header)) continue;
    names.add(name);
  }
  return [...names].map((name) => `${name}=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax`);
}
