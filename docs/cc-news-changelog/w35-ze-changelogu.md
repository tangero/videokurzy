---
author: Patrick Zandl
categories:
- AI
- Claude Code
- Anthropic
- Vývojářské nástroje
layout: post
title: "Claude Code: omezený režim --restricted, jemnější prompt cache a lepší přehled o nákladech"
post_excerpt: "Týden 35 (v2.1.240–v2.1.250) přinesl v Claude Code hlavně nástroje pro kontrolu a ladění nákladů: uzamčený režim --restricted, jemné nastavení TTL prompt cache, kurátorský seznam modelů v /model a podrobnější přehled spotřeby u úloh /loop a subagentů."
summary_points:
- "Nový režim `--restricted` odebírá nástroje spouštějící příkazy a kód a ignoruje soubory s nastavením (v2.1.248)."
- "Panel Auto mode v /permissions umožňuje zobrazit a upravit pravidla klasifikátoru auto mode (v2.1.246)."
- "Příkaz /usage nově rozpisuje spotřebu po jednotlivých úlohách /loop a /tasks ukazuje model subagentů (v2.1.243)."
- "Nastavení `promptCacheTtl` a `subagentPromptCacheTtl` dovolují jemně řídit TTL prompt cache zvlášť pro hlavní konverzaci a subagenty (v2.1.243)."
- "Nastavení `modelPicker` umožňuje sestavit vlastní seznam modelů pro /model (v2.1.243)."
- "Nástroj SendFeedback připraví zprávu o problému, kterou uživatel zkontroluje a odešle z /feedback (v2.1.247)."
---

# Claude Code: omezený režim --restricted, jemnější prompt cache a lepší přehled o nákladech

Týden 35 pokrývá verze Claude Code od 2.1.240 do 2.1.250. Neobjevila se žádná zásadní změna principu fungování nástroje. Týden má charakter průběžného ladění a jeho společným jmenovatelem je kontrola. Přibyl uzamčený režim `--restricted`, panel pro pravidla auto mode, jemnější řízení TTL prompt cache, kurátorský seznam modelů a podrobnější statistiky spotřeby u úloh `/loop` a subagentů. Doplňuje je řada menších úprav od paměťové náročnosti po přihlašování.

## Přehled velkých změn

- Režim `--restricted` (v2.1.248)
- Panel Auto mode v `/permissions` (v2.1.246)
- Jemné nastavení TTL prompt cache (v2.1.243)
- Rozpis úloh `/loop` v `/usage` a informace o modelu subagentů (v2.1.243)
- Vlastní seznam modelů v `/model` přes `modelPicker` (v2.1.243)
- Nástroj SendFeedback (v2.1.247)

## Velké změny

**Režim `--restricted`.** Příznak `--restricted` (nebo proměnná `CLAUDE_CODE_RESTRICTED=1`) odebírá vestavěné nástroje, které spouštějí příkazy nebo kód, a také `WebFetch`, pokud není výslovně uveden v `--tools`. Souborové nástroje zůstávají omezené na pracovní adresář, `bypassPermissions` se odmítá a soubory s nastavením uživatele, projektu i lokálním se ignorují. *Interpretace:* jde o nejvýznamnější změnu týdne z hlediska bezpečnosti. Ignorování souborů s nastavením znamená, že chování režimu nezávisí na obsahu repozitáře, a to ocení především ti, kdo chtějí Claude Code nasadit v prostředí s omezenou důvěrou. Dokumentace: [CLI reference](https://code.claude.com/docs/en/cli-reference). (v2.1.248)

**Panel Auto mode v `/permissions`.** Příkaz `/permissions` má nový panel Auto mode, v němž lze zobrazit a upravovat pravidla klasifikátoru auto mode. Nové varování při startu navíc upozorní na allow pravidla pro Bash s žolíkem před podpříkazem, například `Bash(git * main)`, protože taková pravidla odpovídají i volbám vloženým před podpříkaz. *Interpretace:* pravidla auto mode se dosud upravovala hůře dostupnou cestou, takže panel přináší pohodlí a lepší přehled. Varování zachytí příliš široká pravidla, která vypadají přísněji, než ve skutečnosti jsou. Dokumentace: [Auto mode config](https://code.claude.com/docs/en/auto-mode-config). (v2.1.246)

**Jemné nastavení TTL prompt cache.** Nová nastavení `promptCacheTtl` a `subagentPromptCacheTtl` umožňují uživatelům s API klíčem i cloudovým poskytovatelem držet hodinovou prompt cache v hlavní konverzaci, zatímco subagenti zůstanou na pěti minutách. Frontmatter agenta navíc získal klíč `experimental.cacheTtl` (`"5m"` nebo `"1h"`) pro TTL na úrovni jednotlivého agenta, pokud není nastaveno TTL pro subagenty. *Interpretace:* nákladová páka pro týmy s velkým objemem práce se subagenty. Dlouhá cache se vyplatí tam, kde se kontext opakovaně využívá, krátká stačí u krátkodobých pomocných běhů. Dokumentace: [Prompt caching](https://code.claude.com/docs/en/prompt-caching). (v2.1.243)

**Rozpis úloh `/loop` v `/usage` a informace o modelu subagentů.** Příkaz `/usage` nově obsahuje rozpis po jednotlivých smyčkách: počet běhů, celkový počet tokenů, tokeny na běh a čas posledního běhu. Díky tomu je snadné odhalit úlohy `/loop`, které se rozběhly nebo jsou nadměrně hovorné. Příkaz `/tasks` a dialogy s detaily agentů zobrazují také model (a úroveň effort), na kterém konkrétní subagent běžel. *Interpretace:* k nastavení TTL přibývá i měření. Kdo nechává smyčky běžet delší dobu, získává první pořádný nástroj, jak zjistit, která z nich pálí tokeny. Dokumentace: [Costs](https://code.claude.com/docs/en/costs). (v2.1.243)

**Vlastní seznam modelů v `/model` přes `modelPicker`.** Nové nastavení `modelPicker` umožňuje definovat seřazený a popsaný seznam modelů pro `/model`. Přijímá libovolný zápis identifikátoru včetně id pro Vertex a Bedrock. Seznam lze přidat k vestavěné nabídce, nebo ji celou nahradit. *Interpretace:* změna je užitečná hlavně pro správce týmů a organizací, kteří chtějí vývojářům nabídnout jen schválené modely pod srozumitelnými názvy. Dokumentace: [Model config](https://code.claude.com/docs/en/model-config). (v2.1.243)

**Nástroj SendFeedback.** Když se v relaci něco pokazí, Claude nově připraví návrh zprávy o problému, kterou uživatel zkontroluje a odešle z `/feedback`. Funkci lze vypnout nastavením `feedbackDrafts`. *Interpretace:* jde spíš o komfort než o změnu schopností. Hlášení chyb s kontextem z relace ale může být kvalitnější než zprávy psané zpětně z paměti. Dokumentace: [Commands](https://code.claude.com/docs/en/commands). (v2.1.247)

## Drobnosti

- Přihlášení bez klíče přes `/login` → Anthropic Console („Sign in with your Console account") umožní vstup organizacím, které API klíče nepovolují.
- Nové spravované nastavení `modelPricing` způsobí, že `/cost`, stavový řádek i telemetrie používají sjednané ceny za model a slevový násobitel organizace místo ceníkových cen.
- `/claude-api cost-optimize` zanalyzuje útratu existujícího projektu za Claude API a po jednotlivých změřených krocích projde nákladové páky (caching, hygiena tokenů, batch, effort, volba modelu).
- Výchozí okno auto-compact u Sonnetu 5 je nově celých 1M kontextu, takže relace s 1M kontextem se kompaktují zhruba při 967 tisících tokenů místo 934 tisíc.
- `/cd` nově hned po přesunu uplatní nastavení projektu v novém adresáři, hooks, servery z `.mcp.json` (s obvyklým potvrzením), skills i agenty, a ne až při `--resume`.
- Subagent, který skončí na limitu `maxTurns`, vrací výstup označený jako částečný, s nápovědou, jak pokračovat přes `SendMessage`.
- Neinteraktivní relace (`-p`, SDK, cloud) automaticky navážou na odpověď přerušenou uprostřed streamu chybou serveru, ztrátou spojení nebo zaseknutím.
- Nativní buildy spotřebují o zhruba 40–70 MB méně paměti na relaci a nativní binárka se stahuje komprimovaná zstd (na Linuxu x64 asi 75 MB místo 340 MB).
- Prompt nástroje Workflow se zmenšil z přibližně 5,7 tisíce na přibližně 1 tisíc tokenů, referenci pro psaní skriptů nahradil přibalený skill `workflow-authoring`.
- Zasílání zpráv mezi relacemi (`SendMessage` / `ListAgents`) funguje na jednom počítači i na Bedrock, Vertex a Foundry a také při vypnuté telemetrii; zprávy od protějšku se sbalí na jednořádkový náhled, který rozbalí Ctrl+O.
- Samořízený dynamický režim `/loop` a autonomní výchozí chování bez promptu jsou nově dostupné vždy, i na Bedrock, Vertex a Foundry; po sobě jdoucí nečinná probuzení se sloučí do jednoho řádku.
- Řádek s délkou tahu na jeho konci nově ukazuje čas dokončení, např. `✻ Sautéed for 23s · done 6:05 PM`.
- `/ultrareview <PR#>` před spuštěním ověří, že připojený účet GitHub má k repozitáři přístup, a případně vysvětlí nápravu; necommitnuté soubory podobné přihlašovacím údajům, například `*.tfvars` a `key.pem.tmp`, se už nenahrávají.

## Závěr

Týden 35 nepřinesl žádný efektní skok, ale poctivě rozšiřuje možnosti řízení. Pro bezpečnostně orientované týmy je nejzajímavější režim `--restricted` spolu s panelem pro pravidla auto mode. Kdo hlídá náklady, ocení jemné TTL prompt cache, rozpis smyček v `/usage`, `modelPricing` i `/claude-api cost-optimize`. Správcům organizací přijde vhod `modelPicker` a přihlášení bez API klíče. Mezi drobnostmi vyniká zmenšení paměťové stopy nativních buildů a velikosti stahované binárky, které pocítí každý.
