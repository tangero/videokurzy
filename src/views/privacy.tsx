import type { FC } from "hono/jsx";
import { Layout } from "./layout";

export const PrivacyPage: FC = () => (
  <Layout title="Zásady ochrany osobních údajů">
    <div class="max-w-3xl mx-auto px-4 py-12 prose">
      <h1>Zásady ochrany osobních údajů</h1>
      <p>Poslední aktualizace: 30. 6. 2026</p>

      <h2>1. Správce údajů</h2>
      <p>
        Správcem osobních údajů je Patrick Zandl, provozovatel webu vibecoding.cz
        a kurzy.vibecoding.cz.
      </p>

      <h2>2. Jaké údaje zpracováváme</h2>
      <ul>
        <li><strong>Email</strong> — pro přihlášení (magic link), komunikaci a fakturaci</li>
        <li><strong>Platební údaje</strong> — zpracovává Stripe, neukládáme čísla karet</li>
        <li><strong>Progress v kurzu</strong> — které epizody jste dokončili</li>
        <li><strong>IP adresa a user agent</strong> — pro bezpečnost a session management</li>
        <li>
          <strong>Marketingové identifikátory</strong> — pokud udělíte souhlas:
          hashovaný (anonymizovaný) email, IP adresa, identifikátory kliknutí
          z reklamy (gclid, fbclid) a cookies reklamních platforem. Slouží
          k měření konverzí a remarketingu.
        </li>
      </ul>

      <h2>3. Účel zpracování</h2>
      <ul>
        <li>Poskytnutí přístupu k videokurzu</li>
        <li>Zpracování plateb a vystavení faktur</li>
        <li>Zasílání přihlašovacích odkazů (magic link)</li>
        <li>Sledování pokroku v kurzu</li>
        <li>Měření účinnosti reklamy a remarketing — jen s vaším souhlasem</li>
      </ul>

      <h2>4. Právní základ</h2>
      <p>
        Zpracování pro přístup ke kurzu je založeno na plnění smlouvy (po platbě),
        zajištění bezpečnosti a vedení účetnictví na oprávněném zájmu a zákonné
        povinnosti. <strong>Měření konverzí a remarketing zpracováváme výhradně
        na základě vašeho souhlasu</strong>, který udělujete zaškrtnutím při
        objednávce (měření konverzí) nebo v liště souhlasu s cookies (remarketing).
        Souhlas můžete kdykoliv odvolat — viz sekce Cookies.
      </p>

      <h2>5. Příjemci údajů</h2>
      <ul>
        <li><strong>Stripe</strong> — zpracování plateb</li>
        <li><strong>Resend</strong> — odesílání emailů</li>
        <li><strong>Cloudflare</strong> — hosting, databáze a anonymní návštěvnost (bez cookies)</li>
        <li><strong>Bunny.net</strong> — streamování videí</li>
        <li><strong>Fakturoid</strong> — vystavení a archivace faktur</li>
        <li>
          <strong>Meta Platforms Ireland, Google Ireland, Seznam.cz</strong> —
          jen s vaším souhlasem, pro měření konverzí a remarketing. U Meta a Google
          může docházet k přenosu do USA na základě standardních smluvních doložek
          / rámce EU–US Data Privacy Framework. Emailová adresa se před odesláním
          hashuje (SHA-256), reklamní platformy ji nedostávají v čitelné podobě.
        </li>
      </ul>

      <h2>6. Doba uchovávání</h2>
      <p>
        Údaje uchováváme po dobu trvání předplatného a dalších 3 let pro účely
        účetnictví a případných reklamací.
      </p>

      <h2>7. Vaše práva</h2>
      <p>Máte právo na:</p>
      <ul>
        <li>Přístup k osobním údajům</li>
        <li>Opravu nepřesných údajů</li>
        <li>Výmaz údajů ("právo být zapomenut")</li>
        <li>Přenositelnost údajů</li>
        <li>Podání stížnosti u ÚOOÚ</li>
      </ul>
      <p>
        Účet můžete kdykoliv trvale smazat sami v <a href="/profile">nastavení účtu</a>.
        Smažeme váš profil, přihlašovací údaje i postup ve kurzech; vystavené účetní
        doklady zůstávají archivované ze zákona, ale zbavené vašich osobních údajů.
      </p>

      <h2>8. Kontakt</h2>
      <p>
        Pro uplatnění práv nebo dotazy: <strong>patrick@vibecoding.cz</strong>
      </p>

      <h2>9. Cookies</h2>
      <p>Cookies a podobné technologie používáme ve třech kategoriích:</p>
      <ul>
        <li>
          <strong>Nezbytné</strong> — session cookie pro přihlášení a cookie
          uchovávající vaši volbu souhlasu. Bez souhlasu, web bez nich nefunguje.
        </li>
        <li>
          <strong>Anonymní návštěvnost</strong> — Cloudflare Web Analytics měří
          návštěvnost <em>bez cookies</em> a bez identifikace osob, proto nevyžaduje souhlas.
        </li>
        <li>
          <strong>Marketingové</strong> — cookies a pixely Meta, Google a Seznam
          pro remarketing. Načítají se <strong>jen po vašem souhlasu</strong> v liště
          souhlasu. Bez souhlasu se vůbec nenačtou.
        </li>
      </ul>
      <p>
        Souhlas s marketingovými cookies můžete kdykoliv změnit nebo odvolat
        v liště souhlasu v patičce webu. Měření konverzí (server-side, bez ukládání
        do vašeho prohlížeče) řídíte samostatně zaškrtnutím při objednávce.
      </p>
    </div>
  </Layout>
);
