---
author: Patrick Zandl
categories:
- AI
- Claude Code
- Anthropic
- Vývojářské nástroje
layout: post
title: "Claude Code: strop effortu, hodnocení pluginů a přepínání stylů výstupu"
post_excerpt: "Sedm verzí Claude Code (v2.1.263–v2.1.269) přineslo hlavně nástroje pro pluginy a agenty: příkaz pro hodnocení pluginů, přepínání stylů výstupu a strop úrovně effortu. Ve VS Code přibyla mapa agentů, hooks a dialogy oprávnění, stabilitu prompt cache zlepšují opravy napříč verzemi."
summary_points:
- "Nastavení `maxEffortLevel` omezuje úroveň effortu u všech poskytovatelů (v2.1.267)."
- "Limit souběžných agentů v nástroji Workflow lze zvýšit až na 256 (v2.1.269)."
- "Příkaz `claude plugin eval` vyhodnotí plugin a vrátí bodované, reprodukovatelné výsledky (v2.1.269)."
- "Styly výstupu se přepínají příkazem `/output-style` (v2.1.269)."
- "Parametr `--plugin-dir` umí načíst celou složku pluginů (v2.1.265)."
---

# Claude Code: strop effortu, hodnocení pluginů a přepínání stylů výstupu

Období Week 37 pokrývá verze v2.1.263 až v2.1.269, tedy sedm buildů, jejichž hlavní linií je tooling kolem pluginů a agentů. Přibyl příkaz pro hodnocení pluginů, přepínač stylů výstupu a konfigurovatelný strop effortu. VS Code získal mapu agentů, podporu hooks a dialogy oprávnění. Průběžně se opravovala také stabilita prompt cache. Zbytek tvoří menší úpravy kolem správy pluginů, telemetrie a práce se sezeními.

## Přehled velkých změn

- Strop úrovně effortu přes `maxEffortLevel` (v2.1.267)
- Vyšší limit souběžných agentů v nástroji Workflow (v2.1.269)
- Hodnocení pluginů příkazem `claude plugin eval` (v2.1.269)
- Načtení celé složky pluginů přes `--plugin-dir` (v2.1.265)
- Přepínání stylů výstupu příkazem `/output-style` (v2.1.269)

## Velké změny

**Strop úrovně effortu přes `maxEffortLevel`.** Nové nastavení `maxEffortLevel` omezuje úroveň effortu u všech poskytovatelů, včetně Bedrocku, Vertexu a Foundry. Lze ho zadat na nejvyšší úrovni konfigurace, nebo samostatně pro jednotlivé modely v `modelSettings`. Uživatelé si dál mohou zvolit nižší úroveň, než kolik strop připouští. Interpretace: jde o nástroj pro ty, kdo chtějí mít chování modelu pod kontrolou napříč týmem nebo organizací. Protože nastavení platí u všech poskytovatelů, hodí se zejména tam, kde se Claude Code provozuje přes víc backendů najednou. Dokumentace: [Model config](https://code.claude.com/docs/en/model-config). (v2.1.267)

**Vyšší limit souběžných agentů v nástroji Workflow.** Proměnná `CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS` (hodnoty 1–256) zvyšuje limit souběžných agentů na jeden běh nástroje Workflow, což je určeno pro větvené úlohy omezené hlavně inferencí. Samostatně `/workflows` v detailu agenta označuje volání nástrojů jako běžící, selhaná nebo hotová a klávesa Enter rozbalí volání včetně vstupů a výsledků. Interpretace: širší paralelismus přijde vhod u rozsáhlých fan-out úloh, kde čekání na inferenci dominuje nad vším ostatním. Lepší čitelnost detailu pak usnadní zjistit, který z mnoha agentů selhal a proč. Dokumentace: [Workflows](https://code.claude.com/docs/en/workflows). (v2.1.269)

**Hodnocení pluginů příkazem `claude plugin eval`.** Nový příkaz spustí evaluační sadu pluginu proti Claude Code a vrátí bodované, reprodukovatelné výsledky. Výstup přichází jako JSON a HTML report, možnosti vypíše `claude plugin eval --help`. Interpretace: autoři pluginů tak získávají měřitelný způsob, jak ověřit kvalitu své práce, a mohou ho zapojit do vlastních procesů. Reprodukovatelnost dává smysl hlavně při porovnávání verzí téhož pluginu. Dokumentace: [Plugin evals](https://code.claude.com/docs/en/plugin-evals). (v2.1.269)

**Načtení celé složky pluginů přes `--plugin-dir`.** Parametr `--plugin-dir` nově umí ukázat na složku s více pluginy: načte se každá podsložka, která obsahuje manifest. Podsložky přidané nebo odebrané za běhu Claude Code se zachytí automaticky. Interpretace: vývojáři s více pluginy si ušetří výčet jednotlivých cest a při iteraci nemusejí relaci restartovat. Dokumentace: [Načítání pluginů](https://code.claude.com/docs/en/plugins/loading). (v2.1.265)

**Přepínání stylů výstupu příkazem `/output-style`.** Nový příkaz `/output-style [name]` vypíše dostupné styly výstupu a umožní mezi nimi přepínat. Funguje i přes Remote Control a v cloudových či jiných headless sezeních. Interpretace: změna stylu je teď možná i tam, kde není po ruce interaktivní terminál. Jde o komfortní vylepšení, ne o změnu schopností. Dokumentace: [Output styles](https://code.claude.com/docs/en/output-styles). (v2.1.269)

## Drobnosti

- `--system-prompt-snapshot off` vykreslí systémový prompt při každém požadavku znovu, což se hodí při ladění textu promptu.
- Výsledky nástroje Bash mohou obsahovat diff souborů změněných příkazem, pokud je zapnuté nastavení `bashEditDiffEnabled`.
- `OTEL_METRICS_INCLUDE_REPOSITORY` označí metriky a události OpenTelemetry atributy repozitáře `vcs.*`.
- Příkazy `claude plugin install`, `uninstall`, `update`, `enable` a `disable` mají přepínač `--json`, řádky `claude plugin list --json` nově obsahují `errorDetails` a `noteDetails`.
- Instalace, zapnutí či vypnutí pluginu v `/plugin` se projeví po zavření nabídky, takže `/reload-plugins` už není potřeba.
- Lomítkové příkazy zadané uprostřed promptu zobrazují seznam shod a skill z pluginu lze najít podle samotného názvu.
- Nové spravované nastavení `gatewayInternalNetworks` umožňuje administrátorům povolit `/login` k bráně Claude apps na veřejném bloku IPv4 jejich organizace.
- Při nastaveném `pricing:` v `gateway.yaml` dostávají přihlášení klienti stejné sazby, takže `/cost` a telemetrie odpovídají měřiči nákladů brány.
- VS Code přidává nastavení „Archive inactive sessions“, které ve výchozím stavu automaticky archivuje sezení neaktivní 14 dní.
- `--continue` a `--resume` zobrazí konverzaci okamžitě, bez čekání na hooks SessionStart.
- Zamítnutí v auto mode nově jmenují blokující pravidlo a vyzývají Clauda, aby zkusil bezpečnější postup a dokončil nesouvisející práci, než se zastaví a zeptá.
- Cloudová sezení umožňují vzít zpět zařazenou zprávu dřív, než ji Claude přečte, a to odebráním z fronty nebo klávesou Esc či šipkou nahoru.

## Závěr

Week 37 je týden nástrojů pro ty, kdo kolem Claude Code něco staví. Příkaz `claude plugin eval`, načítání složky pluginů a nové možnosti u workflow agentů míří na autory pluginů a uživatele orchestrace. Strop `maxEffortLevel` osloví hlavně administrátory, kteří chtějí nastavení sjednotit napříč poskytovateli. Pro každodenní práci jsou nejpraktičtější drobnosti: okamžité zobrazení konverzace po `--continue` a `--resume`, žádný `/reload-plugins` po změně v `/plugin` a srozumitelnější zamítnutí v auto mode.
