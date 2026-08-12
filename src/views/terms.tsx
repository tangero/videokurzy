import type { FC } from "hono/jsx";
import { Layout } from "./layout";

export const TermsPage: FC = () => (
  <Layout title="Obchodní podmínky">
    <div class="max-w-3xl mx-auto px-4 py-12 prose">
      <h1>Obchodní podmínky</h1>
      <p>Poslední aktualizace: 12. 8. 2026</p>
      <p>
        Provozovatel: <strong>Patrick Zandl</strong>, IČO 43943420,
        se sídlem U Přelízky 1126/6, 250 01 Brandýs nad Labem-Stará Boleslav.
        Provozovatel není plátcem DPH.
        <br />
        Kontakt: <a href="mailto:patrick@vibecoding.cz">patrick@vibecoding.cz</a>,
        tel. <a href="tel:+420777677077">+420 777 677 077</a>
      </p>

      <h2>1. Předmět smlouvy</h2>
      <p>
        Tyto podmínky upravují nákup přístupu k videokurzům dostupným na
        kurzy.vibecoding.cz (dále „platforma"). Uzavřením objednávky zákazník
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

      <h2 id="odstoupeni">4. Odstoupení od smlouvy (spotřebitel)</h2>
      <p>
        Spotřebitel má podle § 1829 občanského zákoníku právo odstoupit od
        smlouvy uzavřené distančním způsobem do <strong>14 dnů</strong> bez
        udání důvodu.
      </p>
      <p>
        Přístup ke kurzům je digitálním obsahem dodávaným bez hmotného nosiče.
        Aktivuje se bezprostředně po přijetí platby, tedy zpravidla před
        uplynutím 14denní lhůty; při objednávce nás o to zákazník výslovně žádá.
      </p>
      <p>
        Zákon sice umožňuje, aby v takovém případě právo na odstoupení zaniklo
        (§ 1837 písm. l) obč. zák.), <strong>my ho však neuplatňujeme</strong> —
        okamžité zpřístupnění je u nás podmínkou nákupu, a vzdání se práva proto
        nemůže být svobodnou volbou zákazníka. Právo odstoupit do 14 dnů tak
        spotřebiteli zůstává v plném rozsahu i poté, co si obsah zpřístupnil
        nebo zhlédl.
      </p>
      <p>
        Lhůta běží ode dne uzavření smlouvy. Pro dodržení lhůty stačí odstoupení
        odeslat před jejím uplynutím. Odstoupení lze zaslat e-mailem na{" "}
        <a href="mailto:patrick@vibecoding.cz">patrick@vibecoding.cz</a> nebo
        poštou na adresu sídla uvedenou výše — postačí jakékoli jednoznačné
        prohlášení, formulář níže je jen pomůcka.
      </p>
      <p>
        Uhrazená částka bude vrácena do 14 dnů od doručení odstoupení, a to
        stejným způsobem, jakým byla přijata. Po vrácení peněz je přístup
        deaktivován.
      </p>

      <h3 id="formular-odstoupeni">Vzorový formulář pro odstoupení od smlouvy</h3>
      <p>
        (Vyplňte a odešlete tento formulář jen v případě, že chcete odstoupit od
        smlouvy. Použití formuláře není povinné.)
      </p>
      <blockquote class="border-l-4 border-gray-300 bg-gray-50 pl-4 pr-4 py-3 my-4 text-sm">
        <p>
          Adresát: Patrick Zandl, U Přelízky 1126/6, 250 01 Brandýs nad
          Labem-Stará Boleslav, e-mail: patrick@vibecoding.cz
        </p>
        <p>
          Oznamuji, že tímto odstupuji od smlouvy o poskytnutí přístupu k
          videokurzům na kurzy.vibecoding.cz.
        </p>
        <p>Datum objednání: …</p>
        <p>Jméno a příjmení spotřebitele: …</p>
        <p>Adresa spotřebitele: …</p>
        <p>E-mail použitý při objednávce: …</p>
        <p>Variabilní symbol nebo číslo dokladu: …</p>
        <p>Podpis spotřebitele (pouze pokud je formulář zasílán v listinné podobě): …</p>
        <p>Datum: …</p>
      </blockquote>
      <p>
        Vedle tohoto zákonného práva nabízíme dobrovolnou garanci vrácení peněz
        podle článku 5. Ta se uplatní i tam, kam zákonné právo nedosáhne —
        typicky u firemních (B2B) licencí, kde odstoupení podle § 1829
        spotřebiteli nepřísluší. Spotřebitel si může vybrat; podmínky garance
        jeho zákonné právo na odstoupení nijak neomezují.
      </p>

      <h2 id="refund">5. Vrácení peněz (refund)</h2>

      <p>
        Následující tabulka popisuje naši <strong>dobrovolnou garanci</strong>,
        nikoli zákonné právo na odstoupení podle článku 4. Podmínka rozsahu
        zhlédnutého obsahu se vztahuje pouze na garanci — vůči spotřebiteli,
        který ve 14denní lhůtě odstoupí podle § 1829, se neuplatní a nárok na
        vrácení peněz mu zůstává i při zhlédnutí 50 % a více epizod.
      </p>

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

      <h2>6. Obnova přístupu</h2>
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

      <h2>7. Dostupnost a obsah platformy</h2>
      <p>
        Usilujeme o maximální dostupnost platformy, nezaručujeme však 100%
        uptime. Obsah kurzů (epizody, moduly) může být průběžně aktualizován
        nebo rozšiřován. Zakoupená licence opravňuje ke sledování veškerého
        obsahu dostupného v době platnosti přístupu.
      </p>

      <h2>8. Duševní vlastnictví</h2>
      <p>
        Veškerý obsah platformy (videa, texty, materiály) je duševním
        vlastnictvím Patricka Zandla. Licence opravňuje výhradně k osobnímu
        sledování. Šíření, kopírování nebo opětovné zveřejňování obsahu bez
        písemného souhlasu je zakázáno.
      </p>

      <h2>9. Ochrana osobních údajů</h2>
      <p>
        Zpracování osobních údajů se řídí{" "}
        <a href="/privacy">Zásadami ochrany osobních údajů</a>.
      </p>

      <h2>10. Rozhodné právo</h2>
      <p>
        Tyto podmínky se řídí právem České republiky. Případné spory budou
        řešeny příslušnými soudy ČR.
      </p>
      <p>
        K mimosoudnímu řešení spotřebitelských sporů je příslušná{" "}
        <strong>Česká obchodní inspekce</strong>, se sídlem Gorazdova 1969/24,
        120 00 Praha 2, internetová adresa{" "}
        <a href="https://coi.gov.cz/informace-o-adr/" target="_blank" rel="noreferrer">
          coi.gov.cz
        </a>.
        Seznam subjektů mimosoudního řešení sporů v členských státech EU vede
        Evropská komise na adrese{" "}
        <a
          href="https://consumer-redress.ec.europa.eu/list-alternative-dispute-resolution-adr-bodies_en"
          target="_blank"
          rel="noreferrer"
        >
          consumer-redress.ec.europa.eu
        </a>.
      </p>

      <h2>11. Kontakt</h2>
      <p>
        <strong>Patrick Zandl</strong>, IČO 43943420
        <br />
        U Přelízky 1126/6, 250 01 Brandýs nad Labem-Stará Boleslav
        <br />
        Email: <a href="mailto:patrick@vibecoding.cz">patrick@vibecoding.cz</a>
        <br />
        Telefon: <a href="tel:+420777677077">+420 777 677 077</a>
        <br />
        Web: <a href="https://vibecoding.cz" target="_blank" rel="noreferrer">vibecoding.cz</a>
      </p>
    </div>
  </Layout>
);
