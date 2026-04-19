import type { FC } from "hono/jsx";
import { Layout } from "./layout";

export const TermsPage: FC = () => (
  <Layout title="Obchodní podmínky">
    <div class="max-w-3xl mx-auto px-4 py-12 prose">
      <h1>Obchodní podmínky</h1>
      <p>Poslední aktualizace: 19. 4. 2026</p>
      <p>
        Provozovatel: <strong>Patrick Zandl</strong>, IČO 66192751,
        sídlem Praha. Kontakt: <a href="mailto:patrick@vibecoding.cz">patrick@vibecoding.cz</a>
      </p>

      <h2>1. Předmět smlouvy</h2>
      <p>
        Tyto podmínky upravují nákup přístupu k videokurzům dostupným na
        kurz.vibecoding.cz (dále „platforma"). Uzavřením objednávky zákazník
        souhlasí s těmito podmínkami.
      </p>

      <h2>2. Typy licencí</h2>

      <h3>2.1 Individuální licence (B2C)</h3>
      <ul>
        <li>Cena: <strong>2 000 Kč</strong> za rok</li>
        <li>Přístup ke všem kurzům na platformě pro jednoho uživatele</li>
        <li>Přístup je vázán na emailovou adresu použitou při nákupu</li>
        <li>Platnost: <strong>365 dní</strong> od aktivace</li>
        <li>Přenositelnost: licence není přenositelná na jinou osobu</li>
      </ul>

      <h3>2.2 Firemní (doménová) licence (B2B)</h3>
      <ul>
        <li>Cena: <strong>15 000 Kč</strong> za rok</li>
        <li>
          Přístup ke všem kurzům pro <strong>všechny uživatele</strong> s
          emailovou adresou na zakoupené doméně (např. @vase-firma.cz)
        </li>
        <li>Licence se aktivuje po manuálním schválení domény administrátorem</li>
        <li>Platnost: <strong>365 dní</strong> od aktivace</li>
        <li>
          Freemailové domény (gmail.com, seznam.cz a podobné) nelze použít
          jako firemní doménu — licence by se vztahovala na všechny uživatele
          dané veřejné služby
        </li>
      </ul>

      <h2>3. Platební metody a splatnost</h2>

      <h3>3.1 Platba kartou (Stripe)</h3>
      <p>
        Platba probíhá okamžitě přes platební bránu Stripe. Přístup je
        aktivován automaticky po potvrzení platby.
      </p>

      <h3>3.2 Bankovní převod (QR platba / FIO)</h3>
      <p>
        Objednávka je vytvořena s variabilním symbolem a čeká na připsání
        platby. Splatnost:
      </p>
      <ul>
        <li>
          <strong>Standardní splatnost: 7 dní</strong> od vytvoření objednávky
        </li>
        <li>
          <strong>Prodloužená splatnost: 21 dní</strong> — dostupná volbou
          „Prodloužená splatnost (pro firemní zpracování)" při nákupu
        </li>
      </ul>
      <p>
        Pokud platba není připsána do konce lhůty, objednávka je automaticky
        zrušena a variabilní symbol propadne. Zákazník musí vytvořit novou
        objednávku.
      </p>
      <p>
        Platba se páruje automaticky. Po spárování je přístup aktivován.
        Zákazník může stav ověřit kliknutím na „Ověřit platbu" na stránce
        s platebními údaji.
      </p>

      <h2>4. Vrácení peněz (refund)</h2>

      <table>
        <thead>
          <tr>
            <th>Podmínka</th>
            <th>Výsledek</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Do 14 dní od nákupu <strong>a zároveň</strong> méně než 50 % epizod dokončeno</td>
            <td>Plný refund</td>
          </tr>
          <tr>
            <td>Do 14 dní od nákupu, ale 50 % nebo více epizod dokončeno</td>
            <td>Refund odmítnut — obsah byl spotřebován</td>
          </tr>
          <tr>
            <td>Po uplynutí 14 dní od nákupu</td>
            <td>Refund odmítnut</td>
          </tr>
          <tr>
            <td>Firemní (B2B) licence</td>
            <td>Refund jen na vyžádání, posuzujeme individuálně</td>
          </tr>
        </tbody>
      </table>

      <p>
        Žádost o refund zasílejte na{" "}
        <a href="mailto:patrick@vibecoding.cz">patrick@vibecoding.cz</a>.
        Refund vyřizujeme do 5 pracovních dnů. Po schválení je přístup
        okamžitě deaktivován.
      </p>

      <h2>5. Obnova přístupu</h2>
      <p>
        Přístup aktivovaný kartou přes Stripe se obnovuje automaticky jako
        roční předplatné. Zákazník obdrží upozornění e-mailem před každým
        obnovením. Automatické obnovení lze kdykoli zrušit v Zákaznickém
        portálu Stripe.
      </p>
      <p>
        Přístup aktivovaný bankovním převodem (FIO) se <strong>neobnovuje
        automaticky</strong>. Zákazník dostane série upozornění (3 týdny, 2 týdny,
        1 týden a 1 den před expirací) a musí provést novou objednávku.
      </p>

      <h2>6. Dostupnost a obsah platformy</h2>
      <p>
        Usilujeme o maximální dostupnost platformy, nezaručujeme však 100%
        uptime. Obsah kurzů (epizody, moduly) může být průběžně aktualizován
        nebo rozšiřován. Zakoupená licence opravňuje ke sledování veškerého
        obsahu dostupného v době platnosti přístupu.
      </p>

      <h2>7. Duševní vlastnictví</h2>
      <p>
        Veškerý obsah platformy (videa, texty, materiály) je duševním
        vlastnictvím Patricka Zandla. Licence opravňuje výhradně k osobnímu
        sledování. Šíření, kopírování nebo opětovné zveřejňování obsahu bez
        písemného souhlasu je zakázáno.
      </p>

      <h2>8. Ochrana osobních údajů</h2>
      <p>
        Zpracování osobních údajů se řídí{" "}
        <a href="/privacy">Zásadami ochrany osobních údajů</a>.
      </p>

      <h2>9. Rozhodné právo</h2>
      <p>
        Tyto podmínky se řídí právem České republiky. Případné spory budou
        řešeny příslušnými soudy ČR. Spotřebitel má právo obrátit se na
        Českou obchodní inspekci (coi.cz) v případě mimosoudního řešení sporu.
      </p>

      <h2>10. Kontakt</h2>
      <p>
        <strong>Patrick Zandl</strong>
        <br />
        Email: <a href="mailto:patrick@vibecoding.cz">patrick@vibecoding.cz</a>
        <br />
        Web: <a href="https://vibecoding.cz" target="_blank" rel="noreferrer">vibecoding.cz</a>
      </p>
    </div>
  </Layout>
);
