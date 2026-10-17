---
author: Patrick Zandl
categories:
- AI
- Claude Code
- Anthropic
- Vývojářské nástroje
layout: post
title: Testování pluginů a volné okno pro každý panel — novinky Claude Code Week 37
post_excerpt: "Týden 37 (7.–11. září 2026) přinesl do Claude Code dvě větší novinky — příkazový řádek pro automatizované testování pluginů a možnost vytrhnout libovolný panel desktopové aplikace do samostatného okna — a řadu menších vylepšení práce s pluginy, auto modem i rozhraním editoru VS Code."
summary_points:
- Nový příkaz claude plugin eval umožňuje spouštět sadu testovacích případů pro vlastní plugin, hodnotit výsledky a porovnat je s referenčním během bez pluginu.
- Pomocník claude plugin eval init provede uživatele sestavením testovací sady — od definice kritérií úspěchu až po zápis souborů.
- V desktopové aplikaci lze libovolný panel (diff, terminál) přesunout do vlastního okna, přetáhnout jej na druhý monitor a kdykoli ho zpět ukotit.
- Nastavení maxEffortLevel nyní funguje napříč všemi poskytovateli, včetně Amazon Bedrock, Google Cloud Agent Platform a Microsoft Foundry.
- Při blokování akce auto modem klasifikátor nově uvádí konkrétní pravidlo, které akci zachytilo.
- Automatické doplňování příkazů uvnitř promptu nyní zobrazuje celý seznam shodujících se příkazů místo jediného návrhu.
---

# Testování pluginů a volné okno pro každý panel — novinky Claude Code Week 37

Týden 37 přinesl v rozsahu verzí v2.1.263 až v2.1.269 dvě změny, které rozšiřují schopnosti nástroje. Jedna cílí na tvůrce pluginů: nový podpříkaz pro automatizované testování. Druhá řeší každodenní ergonomii v desktopové aplikaci: panely nyní lze vytrhnout do vlastních oken. Vedle toho přibylo zhruba deset drobnějších úprav, které zpřesňují chování auto modu, rozhraní VS Code a několika dalších oblastí.

## Přehled větších změn

- Testování pluginů příkazem `claude plugin eval` (v2.1.269)
- Volná okna pro panely v desktopové aplikaci (Desktop)

## Velké změny

### Testování pluginů příkazem `claude plugin eval`

Příkaz `claude plugin eval` spustí váš plugin proti připravené sadě testovacích případů, ohodnotí výsledky a — pokud nezakážete výchozí chování — provede každý případ znovu bez pluginu. Výsledky obou běhů pak lze porovnat a přesně vidět, jaký přínos plugin má.

Pro první kroky slouží `claude plugin eval init`: interaktivně se zeptá, jak má správný výsledek vypadat, navrhne testovací případy i kontrolní kritéria, jednou sadu spustí a zapíše výsledné soubory. Každý běh a každá kontrola, při níž druhý model posuzuje odpověď, je skutečné volání modelu na vašem účtu — je proto vhodné kalkulovat s náklady při opakovaném spouštění v CI.

**Interpretace:** Doposud neexistoval standardizovaný způsob, jak ověřit, že plugin dělá to, co má. Automatizovaná testovací sada snižuje riziko regresí při úpravách pluginu a usnadňuje jejich sdílení — příjemce může spustit testy a okamžitě vidět, zda plugin na jeho konfiguraci funguje.

Dokumentace: [Plugin evals](https://code.claude.com/docs/en/plugin-evals) — v2.1.269

---

### Volná okna pro panely v desktopové aplikaci

V desktopové aplikaci Claude Code lze nyní libovolný panel — diff, terminál nebo jiný — přetáhnout do samostatného okna. Panel tak lze umístit na druhý monitor, zatímco Claude pokračuje v práci v hlavním okně. Po skončení práce stačí panel zpět ukotit.

**Interpretace:** Uživatelé s více monitory mohli doposud rozložení pracovní plochy přizpůsobit jen omezeně. Možnost přesunout diff nebo terminál na vedlejší obrazovku odpovídá způsobu práce, na který jsou vývojáři zvyklí z jiných nástrojů — a při delších bězích agenta to přináší znatelně lepší přehlednost.

Dokumentace: [Arrange your workspace](https://code.claude.com/docs/en/desktop#arrange-your-workspace) — Desktop

---

## Drobnosti

- Nastavení [`maxEffortLevel`](https://code.claude.com/docs/en/settings-reference#maxeffortlevel) lze uvést na nejvyšší úrovni nebo per-model pod `modelSettings`; omezuje maximální úroveň úsilí na všech poskytovatelích, včetně Amazon Bedrock, Google Cloud Agent Platform a Microsoft Foundry — vyšší hodnota se zastropuje na nastavené hranici.
- Parametr `--plugin-dir` přijme složku s pluginy a [načte každou bezprostřední podsložku s manifestem](https://code.claude.com/docs/en/plugins/create#load-a-directory-or-archive-for-one-session) jako samostatný plugin pro dané sezení.
- Pokud WebFetch nestáhne stránku do pěti minut, [fetch selže s chybou o překročení lhůty](https://code.claude.com/docs/en/tools-reference#webfetch-tool-behavior) místo toho, aby visel; proměnná `CLAUDE_CODE_WEBFETCH_DEADLINE_MS` lhůtu upravuje, hodnota `0` limit odstraní.
- Přepínač `--json` u příkazů `claude plugin install`, `uninstall`, `update`, `enable` a `disable` vypíše výsledek jako [jeden objekt JSON na poslední řádek stdout](https://code.claude.com/docs/en/plugins/cli-reference#plugin-json-result).
- Když klasifikátor auto modu zablokuje akci, důvod předaný Claudovi [obvykle uvádí název pravidla, které akci zachytilo](https://code.claude.com/docs/en/auto-mode-config#fix-a-denial-with-an-allow-rule-an-environment-entry-or-a-retry), například `[Data Exfiltration]` — snazší ladění pravidel povolení.
- Zadáte-li `/` uprostřed promptu, [zobrazí se seznam všech shodujících se příkazů](https://code.claude.com/docs/en/interactive-mode#complete-a-command-mid-prompt) místo jediného návrhu; v celoobrazovkovém zobrazení se seznam otevírá průběžně při psaní; dovednost pluginu se shoduje i podle samotného názvu bez prefixu pluginu.
- Ve rozšíření VS Code zobrazí kliknutí na počet agentů v dolní části pole pro prompt [mapu agentů](https://code.claude.com/docs/en/vs-code#use-the-prompt-box), kde lze otevřít přepis subagenta jen pro čtení nebo jej zastavit.
- Ve rozšíření VS Code přidají položky Hooks a Permissions v sekci Customize příkazového menu háky a pravidla oprávnění přímo do [uživatelských, projektových nebo lokálních nastavení](https://code.claude.com/docs/en/vs-code#use-the-prompt-box).
- Claude nyní dokáže přiřadit každému publikovanému artefaktu [ikonu záložky prohlížeče](https://code.claude.com/docs/en/artifacts#create-an-artifact) odpovídající obsahu artefaktu.
- V Claude Code na webu lze zpětvzít zprávu zařazenou do fronty v cloudovém sezení, než ji Claude přečte — odstraněním z fronty, stiskem Esc nebo šipky nahoru se text vrátí do pole pro zprávu.

---

Week 37 je týdnem konsolidace a dokončování. Nejzásadnější přírůstek — testovací příkaz pro pluginy — přichází v moment, kdy ekosystém pluginů roste a vývojáři potřebují spolehlivý způsob, jak ověřit správnost svých rozšíření. Volná okna v desktopové aplikaci pak ocení zejména ti, kteří Claude Code používají v celodenním provozu na více monitorech. Zpřesnění zpráv auto modu a rozšířené doplňování příkazů jsou drobné, ale vítané úpravy pro každého, kdo s nástrojem tráví hodiny denně.
