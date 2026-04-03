import type { FC } from "hono/jsx";
import { Layout } from "./layout";

export const PrivacyPage: FC = () => (
  <Layout title="Zásady ochrany osobních údajů">
    <div class="max-w-3xl mx-auto px-4 py-12 prose">
      <h1>Zásady ochrany osobních údajů</h1>
      <p>Poslední aktualizace: 3. 4. 2026</p>

      <h2>1. Správce údajů</h2>
      <p>
        Správcem osobních údajů je Patrick Zandl, provozovatel webu vibecoding.cz
        a kurz.vibecoding.cz.
      </p>

      <h2>2. Jaké údaje zpracováváme</h2>
      <ul>
        <li><strong>Email</strong> — pro přihlášení (magic link), komunikaci a fakturaci</li>
        <li><strong>Platební údaje</strong> — zpracovává Stripe, neukládáme čísla karet</li>
        <li><strong>Progress v kurzu</strong> — které epizody jste dokončili</li>
        <li><strong>IP adresa a user agent</strong> — pro bezpečnost a session management</li>
      </ul>

      <h2>3. Účel zpracování</h2>
      <ul>
        <li>Poskytnutí přístupu k videokurzu</li>
        <li>Zpracování plateb a vystavení faktur</li>
        <li>Zasílání přihlašovacích odkazů (magic link)</li>
        <li>Sledování pokroku v kurzu</li>
      </ul>

      <h2>4. Právní základ</h2>
      <p>
        Zpracování je založeno na plnění smlouvy (přístup ke kurzu po platbě)
        a oprávněném zájmu (bezpečnost, analytika).
      </p>

      <h2>5. Příjemci údajů</h2>
      <ul>
        <li><strong>Stripe</strong> — zpracování plateb</li>
        <li><strong>Resend</strong> — odesílání emailů</li>
        <li><strong>Cloudflare</strong> — hosting a databáze</li>
        <li><strong>Bunny.net</strong> — streamování videí</li>
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

      <h2>8. Kontakt</h2>
      <p>
        Pro uplatnění práv nebo dotazy: <strong>patrick@vibecoding.cz</strong>
      </p>

      <h2>9. Cookies</h2>
      <p>
        Používáme pouze technické cookies nezbytné pro fungování přihlášení
        (session cookie). Nepoužíváme analytické ani marketingové cookies.
      </p>
    </div>
  </Layout>
);
