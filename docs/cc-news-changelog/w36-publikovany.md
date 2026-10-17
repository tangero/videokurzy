---
author: Patrick Zandl
categories:
- AI
- Claude Code
- Anthropic
- Vývojářské nástroje
layout: post
title: "Claude Fable 5.1, živý diff panel a počítač na pozadí: novinky v Claude Code za 36. týden"
post_excerpt: "Za 36. týden (31. srpna – 4. září 2026) přinesl Claude Code čtyři velké změny a přibližně tucet drobnějších úprav. Nový model Fable 5.1 s milionovým kontextovým oknem, živý diff panel přímo v konverzaci, běh computer use na pozadí a diagnostický příkaz /skill-doctor tvoří páteř tohoto vydání. Paralelně přibyla zpřísnění bezpečnostního modelu auto mode a řada komfortních vylepšení."
summary_points:
- "Claude Fable 5.1 je dostupný s kontextovým oknem 1 M tokenů; alias fable na něj přepíná od verze v2.1.257."
- "Příkaz /diff v celoobrazovkovém zobrazení otevírá trvalý postranní panel vedle konverzace a obnovuje se při každé editaci."
- "Computer use na Desktopu (macOS) nyní pracuje na pozadí — Claude vidí a ovládá schválené aplikace, zatímco uživatel dál pracuje."
- "Příkaz /skill-doctor odhalí, které dovednosti zatěžují kontext, aniž je Claude kdy využívá."
- "Auto mode nově blokuje přístup k metadatovému endpointu cloudové instance a ptá se před prvním čtením souboru mimo pracovní adresáře."
---

# Claude Fable 5.1, živý diff panel a počítač na pozadí: novinky v Claude Code za 36. týden

Čtyři hlavní vydání a přibližně tucet drobných úprav — tak vypadá 36. týden (31. srpna – 4. září 2026) v Claude Code. Linie změn jsou tři: nový model s výrazně větším kontextem, dvě funkce, které rozšiřují schopnosti nástroje (živý diff panel, computer use na pozadí), a zpřísnění bezpečnostního rámce auto mode doplněné o diagnostický příkaz pro správu dovedností.

## Přehled velkých změn

- Nový model Claude Fable 5.1 s kontextovým oknem 1 M tokenů (v2.1.257)
- Živý diff panel v celoobrazovkovém zobrazení (v2.1.260)
- Computer use na pozadí v aplikaci Claude Code Desktop (macOS, beta)
- Diagnostika nepoužívaných dovedností příkazem /skill-doctor (v2.1.252)

---

## Velké změny

### Computer use na pozadí (Desktop, macOS)

Aplikace Claude Code Desktop nově spouští computer use na pozadí: Claude vidí a ovládá aplikace, ke kterým jste mu udělili přístup, zatímco vy pokračujete v práci v popředí. Funkce je v beta verzi a dostupná na plánech Pro a Max.

**Interpretace:** Dosud museli uživatelé přenechat obrazovku Claudovi po dobu, kdy prováděl úkony přes počítačové rozhraní. Práce na pozadí odstraňuje toto přerušení pracovního toku a činí z computer use nástroj použitelný při delších automatizovaných úkolech — například testování, vyplňování formulářů nebo ovládání desktopových nástrojů bez grafického API. Jde o kvalitativní posun ve využitelnosti funkce v reálném provozu.

[Dokumentace: desktop#let-claude-use-your-computer](https://code.claude.com/docs/en/desktop#let-claude-use-your-computer)

---

### Claude Fable 5.1

Claude Fable 5.1 je dostupný v Claude Code s kontextovým oknem 1 M tokenů. Alias `fable` na něj nově ukazuje. V relacích přes bránu Claude Apps alias `fable` nadále vybírá Fable 5 — pokud vaše brána obsluhuje Fable 5.1, přepněte ručně příkazem `/model claude-fable-5-1`. Vyžaduje verzi v2.1.257 nebo novější.

**Interpretace:** Milionové kontextové okno otevírá práci s rozsáhlými kódovými základnami najednou — bez nutnosti rozdělovat kontext nebo spoléhat na opakované načítání souborů. Pro týmy, které narážejí na limity kontextu při refaktoringu velkých projektů, může jít o zásadní změnu. Pozor na odlišné chování aliasu v prostředích s bránou — před nasazením do CI/CD pipeline ověřte, jakou verzi modelu brána skutečně servíruje.

[Dokumentace: model-config#work-with-fable](https://code.claude.com/docs/en/model-config#work-with-fable)

---

### Živý diff panel v celoobrazovkovém zobrazení (v2.1.260)

V celoobrazovkovém zobrazení příkaz `/diff` již neotevírá samostatný prohlížeč, který je třeba zavírat. Místo toho se vedle konverzace zobrazí trvalý postranní panel se seznamem změněných souborů včetně počtu přidaných a odebraných řádků. Panel se obnovuje při každé editaci souboru nebo spuštění shell příkazu. Řádky v panelu lze označit myší a připojit je přímo k dalšímu promptu.

**Interpretace:** Dřívější průběh — napsat příkaz, otevřít prohlížeč diffu, zavřít, pokračovat — přerušoval pozornost. Trvalý panel udržuje přehled o aktuálním stavu změn bez přepínání kontextu. Možnost přiložit vybrané řádky diffu k promptu pak přirozeně uzavírá smyčku: vidíte problém, okamžitě ho okomentujete.

[Dokumentace: interactive-mode#diff-panel](https://code.claude.com/docs/en/interactive-mode#diff-panel)

---

### Diagnostika dovedností příkazem /skill-doctor (v2.1.252)

Příkaz `/skill-doctor` zobrazí, kolik kontextových tokenů každá dovednost (skill) spotřebovává a jak často ji Claude skutečně využívá. Každá dovednost v seznamu totiž zatěžuje kontext při každém tahu — bez ohledu na to, zda ji Claude použije, nebo ne. Na základě těchto údajů lze rozhodnout, které dovednosti deaktivovat. Vyžaduje verzi v2.1.252 nebo novější; není dostupný v relacích, které přeskakují načítání příznaků funkcí (feature-flag fetching).

**Interpretace:** Uživatelé, kteří si postupem času nashromáždili velký počet dovedností, mohli nevědomky plýtvat kontextem na funkce, jež nikdy nepotřebují. `/skill-doctor` přináší viditelnost tam, kde dosud panovala nepřehlednost. Je to drobný nástroj s velkým dopadem na efektivitu u projektů s bohatou sadou dovedností.

[Dokumentace: skills#find-unused-skills](https://code.claude.com/docs/en/skills#find-unused-skills)

---

## Drobnosti

- Nové hooks [PreModelSwitch](https://code.claude.com/docs/en/hooks#premodelswitch) a [PostModelSwitch](https://code.claude.com/docs/en/hooks#postmodelswitch) umožňují zablokovat přepnutí modelu, případně přidat kontext po přepnutí.
- Příkaz [/cost](https://code.claude.com/docs/en/costs#prompt-cache-statistics) nově zobrazuje řádek *Prompt cache (main)*: podíl vstupních tokenů obsloužených z mezipaměti, výpadky mezipaměti, stav zahřátí a pravděpodobnou příčinu posledního výpadku; skripty stavového řádku dostávají odpovídající objekt `prompt_cache`.
- Organizace mohou v nastavení [managedMcpServers](https://code.claude.com/docs/en/managed-mcp#provide-servers-through-managed-settings) uvést HTTP a SSE MCP servery a distribuovat je automaticky všem uživatelům.
- Příkazy `/effort` a výběr modelu nyní [ukládají úroveň úsilí zvlášť pro každý model](https://code.claude.com/docs/en/model-config#adjust-effort-level); klávesou `s` místo Enter lze úroveň uložit jen pro aktuální relaci.
- Auto mode klasifikátor [nově blokuje](https://code.claude.com/docs/en/permission-modes#what-the-classifier-blocks-by-default) i požadavky na přihlašovací údaje z metadatového endpointu cloudové instance a připojení k sousedním kontejnerům, které Claude sám nespustil.
- V auto mode se Claude Code [ptá před prvním čtením souboru mimo pracovní adresáře](https://code.claude.com/docs/en/permission-modes#first-read-outside-the-working-directories) a nabízí možnost taková čtení od té chvíle trvale blokovat.
- Nastavení [bashOutputMaxChars](https://code.claude.com/docs/en/settings-reference#bashoutputmaxchars) a [taskOutputMaxChars](https://code.claude.com/docs/en/settings-reference#taskoutputmaxchars) lze navýšit až na 128 000 znaků, takže Claude dostává více výstupu příkazů a úloh přímo v kontextu.
- [Zkratky pro úpravu slov v promptu](https://code.claude.com/docs/en/interactive-mode#make-ctrl-w-delete-back-to-whitespace) se pro všechny řídí konvencí readline; nastavení `keybindingFlavor` již nemá efekt. Ctrl+W maže zpět k předchozímu prázdnému znaku, Alt+B, Alt+F a Alt+D považují interpunkci (/, .) za hranice slov.
- Nastavení `defaultMode` na hodnotu `"bypassPermissions"` v projektovém souboru `.claude/settings.json` nebo `.claude/settings.local.json` [již nemá vliv](https://code.claude.com/docs/en/permission-modes#which-mode-a-session-starts-in) — relace se spustí v režimu Manual. Toto nastavení přesuňte do uživatelských nebo spravovaných nastavení, případně použijte přepínač `--permission-mode`.
- Podnikové plány s licencováním na místa (seat-based Enterprise) [nově výchozně používají Opus 5](https://code.claude.com/docs/en/model-config#default-model-setting).
- V rozšíření pro VS Code lze kliknutím na název modelu ve spodní části pole pro prompt [otevřít výběr modelu](https://code.claude.com/docs/en/vs-code#use-the-prompt-box).
- V rozšíření pro VS Code lze v sekci *Customize* v příkazové nabídce vybrat *Output styles* a [zvolit styl výstupu](https://code.claude.com/docs/en/vs-code#use-the-prompt-box) včetně vlastních.

---

36. týden spojuje dvě roviny: rozšíření výkonu (Fable 5.1, computer use na pozadí) a kultivaci každodenního provozu (diff panel, /skill-doctor, zpřehlednění oprávnění). Pro týmy pracující s rozsáhlými projekty je nejzajímavější nástup Fable 5.1 s milionovým kontextem. Pro uživatele Desktopu na Macu je zásadní computer use na pozadí — konečně bez nutnosti odevzdávat obrazovku. A pro každého, kdo si za měsíce provozu nashromáždil desítky dovedností, stojí za to rovnou spustit `/skill-doctor`.
