---
author: Patrick Zandl
categories:
- AI
- Claude Code
- Anthropic
- Vývojářské nástroje
layout: post
title: "Claude Fable 5.1, diagnostika prompt cache a spravované servery MCP v Claude Code"
post_excerpt: "Verze 2.1.251 až 2.1.261 přinášejí nový výchozí model Claude Fable 5.1, diagnostiku prompt cache v /cost a na stavovém řádku, centrálně spravované servery MCP a hooks pro přepínání modelů. Rozsáhlé úpravy dostalo i rozšíření pro VS Code."
summary_points:
- Organizace mohou uživatelům centrálně poskytovat servery MCP a bezobslužné hostitele nechat automaticky zamítat všechny dotazy na oprávnění (v2.1.259).
- Výchozím modelem řady Fable je nově Claude Fable 5.1 s kontextem 1M (v2.1.257).
- Nové hooks reagují na přepnutí modelu a hooks při obnovení relace dostávají údaje o zastaralosti a ceně opětovného nacachování (v2.1.251).
- Model a systémový prompt subagentů lze řídit přesněji, včetně vynucení jednoho modelu pro všechny (v2.1.257).
- Prompt cache má v /cost a na stavovém řádku vlastní diagnostiku včetně pravděpodobné příčiny minutí (v2.1.260).
- Celoobrazovkový režim umí zobrazit panel s rozdíly vedle konverzace (v2.1.260).
---

# Claude Fable 5.1, diagnostika prompt cache a spravované servery MCP v Claude Code

Verze 2.1.251 až 2.1.261 patří viditelnosti modelů a nákladů. Přichází Claude Fable 5.1 jako výchozí model řady Fable, `/cost` a stavový řádek ukazují stav prompt cache a hooks umějí zasáhnout do přepínání modelů. Druhou linií je správa pro organizace: centrálně distribuované servery MCP a režim oprávnění pro bezobslužné běhy. Rozšíření pro VS Code dostalo velkou dávku úprav v práci s relacemi a výběrem modelu a ostatní novinky jsou menší vylepšení ovládání.

- Spravované servery MCP a oprávnění bez dohledu (v2.1.259)
- Claude Fable 5.1 jako výchozí model Fable (v2.1.257)
- Hooks pro přepnutí modelu a bohatší hooks při obnovení relace (v2.1.251)
- Kontrola nad modely a systémovými prompty subagentů (v2.1.257)
- Diagnostika prompt cache v `/cost` a na stavovém řádku (v2.1.260)
- Panel s rozdíly vedle konverzace v celoobrazovkovém režimu (v2.1.260)

**Spravované servery MCP a oprávnění bez dohledu.** Organizace mohou přes spravované nastavení `managedMcpServers` poskytnout všem uživatelům servery MCP s přenosem HTTP/SSE. Nový přepínač `--permission-prompts none` míří na bezobslužné headless hostitele: cokoli, co by vyvolalo dotaz, se automaticky zamítne, zatímco o ostatním dál rozhoduje aktivní režim oprávnění. Změnila se také role `allowedMcpServers`. Nově řídí jen servery, které si uživatelé přidají sami, takže server zapsaný doslova v `managed-mcp.json` se po aktualizaci načte. *Interpretace:* administrátoři získávají oficiální cestu, jak týmům doručit schválené servery MCP bez ručního nastavování na každém stroji. Automatické zamítání dotazů dělá chování bezobslužných běhů předvídatelnější, protože nic nezůstane viset na potvrzení, které nikdo neuvidí. Změnu významu `allowedMcpServers` je rozumné před nasazením ověřit na existujících konfiguracích. Dokumentace: [Managed MCP](https://code.claude.com/docs/en/managed-mcp). (v2.1.259)

**Claude Fable 5.1 jako výchozí model Fable.** Claude Fable 5.1 (`claude-fable-5-1`) je nově výchozím modelem řady Fable. Má kontextové okno 1M a stojí 10/50 USD za Mtok, čtení z cache vychází na 0,25 USD za Mtok. V relacích přes Claude apps gateway se aliasy `fable` a `best` zatím stále překládají na Fable 5, takže Fable 5.1 je nutné vybrat v `/model`. *Interpretace:* nový výchozí model je nejviditelnější změna týdne a dotýká se všech, kdo pracují s řadou Fable. Uživatelé za gateway si ji ale musí zapnout ručně, jinak poběží dál na starší verzi. Dokumentace: [Model config](https://code.claude.com/docs/en/model-config). (v2.1.257)

**Hooks pro přepnutí modelu a bohatší hooks při obnovení relace.** Nové události hooks `PreModelSwitch` a `PostModelSwitch` umožňují přepnutí modelu zablokovat, potvrdit nebo opatřit poznámkou. Hooks `SessionStart` při obnovení relace nově dostávají také údaj o zastaralosti relace a odhadovanou cenu opětovného nacachování. *Interpretace:* týmy, které hlídají náklady, mohou přepínání na dražší modely podřídit vlastním pravidlům. Data z obnovení relace zase umožňují rozhodnout, zda se starou relaci vyplatí vůbec otevírat. Obojí zapadá do tématu týdne, tedy do řízení nákladů. Dokumentace: [Hooks](https://code.claude.com/docs/en/hooks). (v2.1.251)

**Kontrola nad modely a systémovými prompty subagentů.** Proměnná `CLAUDE_CODE_SUBAGENT_MODEL` nově nastavuje jen výchozí model subagentů, takže přednost má `model:` v definici agenta nebo model zadaný při konkrétním spuštění. Nová proměnná `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` vynutí zvolený model pro všechny subagenty bez ohledu na přepsání. Přepínač `--append-subagent-system-prompt-file` načte systémový prompt subagentů ze souboru, což pomůže u promptů příliš velkých pro příkazovou řádku. *Interpretace:* kdo se na dřívější chování `CLAUDE_CODE_SUBAGENT_MODEL` spoléhal, měl by pravděpodobně přejít na variantu s `_FORCE`. Pro ostatní je nová hierarchie přirozenější, protože konkrétní definice agenta má přednost před globální volbou. Dokumentace: [Sub-agents](https://code.claude.com/docs/en/sub-agents). (v2.1.257)

**Diagnostika prompt cache v `/cost` a na stavovém řádku.** Příkaz `/cost` nově zobrazuje řádek o prompt cache pro aktuální relaci: poměr zásahů, počet minutí, znovu nacachované tokeny a stav warm/cold. Od verze 2.1.260 navíc uvádí pravděpodobnou příčinu minutí, například změněné definice nástrojů či systémový prompt nebo nečinnost přesahující TTL. Stejná data dostanou skripty stavového řádku v objektu `prompt_cache`. *Interpretace:* prompt cache dosud fungovala převážně nepozorovaně a její selhání se projevilo až na účtu. Teď je vidět, kdy a proč k němu došlo, což pomůže hlavně těm, kdo ladí dlouhé relace nebo vlastní nástroje a systémové prompty. Dokumentace: [Prompt caching](https://code.claude.com/docs/en/prompt-caching). (v2.1.260)

**Panel s rozdíly vedle konverzace v celoobrazovkovém režimu.** Celoobrazovkový režim nově otevře vedle konverzace panel s rozdíly. Zobrazuje necommitnuté změny průběžně, jak je Claude upravuje, a přepíná se příkazem `/diff`. *Interpretace:* jde hlavně o pohodlí. Sledování změn v reálném čase vedle konverzace zkracuje cestu od zadání ke kontrole výsledku. Dokumentace: [Fullscreen](https://code.claude.com/docs/en/fullscreen). (v2.1.260)

Drobnosti:
- `/skill-doctor` ukáže, které načtené skills se nepoužívají a kolik stojí kontextu, takže je lze odstranit.
- Nová nastavení `bashOutputMaxChars` a `taskOutputMaxChars` zvyšují objem výstupu příkazů a úloh
