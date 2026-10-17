---
author: Patrick Zandl
categories:
- AI
- Claude Code
- Anthropic
- Vývojářské nástroje
layout: post
title: "Claude Code za 38. týden: Projects převezmou koordinaci, AGENTS.md přestává být problém"
post_excerpt: "Projects přebírají koordinaci paralelních cloudových sezení, Claude Code čte AGENTS.md, auto mode dostal serverový klasifikátor a síť po jednotlivých příkazech a skills z claude.ai se synchronizují do terminálu. Přehled verzí 2.1.270 až 2.1.278 (12.–19. září 2026)."
summary_points:
- Projects (beta pro Pro a Max) spouští z jedné konverzace paralelní cloudová vlákna; vyžadují GitHub App, nejdou sdílet a rychleji čerpají limity.
- Claude Code čte AGENTS.md jako projektové instrukce, když v projektu chybí CLAUDE.md; subagenti mohou CLAUDE.md vynechat.
- Ctrl+Enter odešle zprávy ve frontě okamžitě, skills a pluginy z claude.ai se synchronizují do terminálu.
- Auto mode ve výchozím stavu používá serverový klasifikátor a příkazy v sandboxu dostanou síť jen k vyžádaným adresám.
- Klient MCP v2 je výchozí i na Bedrocku, Vertexu a Foundry.
---

# Claude Code za 38. týden: Projects převezmou koordinaci, AGENTS.md přestává být problém

*Paralelní sezení Claude Code jsou užitečná jen do chvíle, kdy začnete ztrácet přehled, které z nich na co pracuje a které čeká na vaši odpověď. Anthropic v 38. týdnu přesouvá tuhle koordinaci na samotného Clauda: Projects. K tomu Claude Code začal číst AGENTS.md, auto mode dostal serverový klasifikátor a síť otevíranou po jednotlivých příkazech a skills z claude.ai se dostanou i do terminálu.*

Týden od 12. do 19. září 2026 přinesl verze 2.1.270 až 2.1.278, tedy devět vydání a přes 450 položek v changelogu. Většina z nich jsou opravy. Několik změn ale mění každodenní práci s Claude Code a jedna z nich se v changelogu vůbec neobjevila.

---

## Projects: Claude dělá dispečera

**Největší novinka týdne v changelogu chybí.** Projects žijí na claude.ai/code a v desktopové aplikaci mimo terminál, takže je najdete jen v [dokumentaci](https://code.claude.com/docs/en/claude-projects). Anthropic jim tam 18. září věnoval samostatnou stránku o skoro osmi tisících slovech.

**Princip.** Projekt je jedna dlouhá konverzace, do které posíláte práci: hlášení chyby, výpis z pádu aplikace, seznam úkolů. Claude ke každému úkolu spustí vlákno (thread), tedy samostatné cloudové sezení, které pracuje na vlastní větvi, podle potřeby otevře pull request a nahlásí výsledek zpátky do konverzace. Přehled (Overview) pak ukazuje, co je hotové, co čeká na review a které vlákno potřebuje vaši odpověď.

**Kontext zadáte jednou.** Každé nové vlákno startuje s repozitáři, instrukcemi a pamětí projektu. Pravidlo typu „pull requesty míří na větev develop" tedy řeknete jednou a dostane ho každé vlákno. Projekt nemusí být jen o kódu: dokumentace počítá i se složkou smluv nebo exportem zákaznických požadavků, nad kterými se opakovaně ptáte.

**Kde to dává smysl.** Anthropic uvádí jednu změnu napříč mnoha repozitáři (například novou konfiguraci linteru do všech služeb), průběžně přicházející chyby jedné služby, migraci, která se do jednoho sezení nevejde, a práci s dokumenty místo kódu. Na jeden úkol, který se vejde do sezení, stačí běžné cloudové sezení.

**Podmínky, se kterými je třeba počítat:**

- **Dostupnost.** Veřejná beta pro tarify Pro a Max, zpřístupňovaná postupně, nejdřív účtům, které už používaly cloudová sezení. Pro Team a Enterprise zatím není.
- **GitHub.** Pro práci s kódem musí být repozitář na github.com (ne GitHub Enterprise Server, GitLab ani Bitbucket), váš GitHub účet k němu musí mít právo zápisu a na repozitáři musí být nainstalovaná Claude GitHub App. U repozitáře organizace ji může nainstalovat jen vlastník organizace.
- **Jen pro vás.** Projekt patří jednomu uživateli. Nejde sdílet s kolegy, a to ani přepisy jednotlivých vláken. Organizační nastavení pro Projects během bety neexistuje.
- **Limity.** Projekt čerpá stejné limity tarifu jako ostatní sezení Claude Code, ale rychleji, protože běží několik vláken najednou. Na tarifu Pro podle dokumentace narazíte na limit dřív. Nad limit projekt nejde, pokud nemáte zapnuté placené kredity. Pevný strop je 200 nových vláken denně.
- **Jen cloud.** Vlákna nevidí nic, co existuje jen na vašem počítači: lokální databázi, emulátor, API za VPN. Pro takovou práci zůstávají lokální sezení.

---

## Změny pro každodenní práci

**AGENTS.md místo druhé sady instrukcí.** Když projekt nemá CLAUDE.md, vezme Claude Code za projektové instrukce [AGENTS.md](https://code.claude.com/docs/en/memory), tedy soubor, který používají jiné kódovací nástroje. Změnit to jde v `/config` v části Project instructions. Kdo v týmu kombinuje Claude Code s dalšími agenty, nemusí udržovat dvě sady instrukcí ani CLAUDE.md, který jen odkazuje na AGENTS.md.

**Instrukce pro subagenty.** Vlastní subagenti a subagenti z pluginů mohou nově nastavit `omitClaudeMd` a běžet bez uživatelského, projektového a lokálního CLAUDE.md. Hodí se pro úzce zaměřené pomocníky, kterým projektová pravidla jen zabírají kontext. Soubory spravovaných politik se načítají dál.

**Zprávy ve frontě odejdou hned.** Klávesová zkratka Ctrl+Enter (případně Ctrl+X Ctrl+S) přeruší rozpracovaný krok a odešle všechny zprávy, které jste mezitím napsali, najednou. Odeslané zprávy zůstávají šedé, dokud je model nepřevezme, takže vidíte, co Claude ještě nečetl.

**Skills a pluginy z claude.ai v terminálu.** Pokud jste přihlášení účtem claude.ai, terminálová sezení si stáhnou [skills](https://code.claude.com/docs/en/skills) a pluginy, které máte na účtu zapnuté, včetně těch, které zapnula vaše organizace. Kdo nechce, vypne synchronizaci nastavením `syncClaudeAiSkills: false` nebo `syncClaudeAiPlugins: false`. Totéž mohou nastavit správci ve spravovaných nastaveních.

**Auto mode: klasifikátor na serveru.** Auto mode nechává o bezpečnosti každého kroku rozhodovat pomocný model (klasifikátor). Pro uživatele Claude API a Enterprise a nově i na Bedrocku, Vertexu, Foundry a za firemními bránami teď ve výchozím stavu běží [na straně Anthropicu](https://code.claude.com/docs/en/auto-mode-classifier-billing) a jeho režii neúčtuje. Když Claude Code musí přejít na placenou záložní variantu, upozorní na to. Zda klasifikátor běží na serveru, ukáže `/status`.

**Auto mode: síť po jednom příkazu.** S izolovaným prostředím (sandboxem) v auto mode dostávají příkazy v terminálu přístup do sítě jen k adresám, které si samy vyžádají. [Klasifikátor posoudí](https://code.claude.com/docs/en/sandboxing) adresy spolu s příkazem a otevře je jen pro jeho běh. Ostatní adresy zůstanou zavřené.

**Cloud a vzdálená sezení.** V cloudu a na vlastních serverech (self-hosted runner) funguje [rychlý režim](https://code.claude.com/docs/en/fast-mode), pokud ho organizace povolí. Rozdíly v cloudovém sezení jde porovnat s libovolnou větví, nejen s výchozí. Sezení spuštěné přes [Remote Control](https://code.claude.com/docs/en/remote-control) jde z aplikace Claude rozdvojit a kopie pak běží na pozadí na vašem počítači.

---

## Technické poznámky

**MCP v2 jako výchozí všude.** Instalace pro Bedrock, Vertex a Foundry a instalace s vypnutou telemetrií teď ve výchozím stavu používají klienta MCP v2 a vyjednávání protokolu ve verzi 2026-07-28, stejně jako ostatní instalace. Kdo potřebuje původní chování, vrátí ho proměnnými `MCP_SDK_GENERATION=v1` nebo `MCP_PROTOCOL_NEGOTIATION=legacy`. Položky MCP typu `sdk` v konfiguračních souborech se nově přeskakují s varováním, protože procesní servery může registrovat jen hostitelská aplikace Agent SDK.

**Úklid nástrojů.** Zastaralý nástroj TaskOutput zmizel, výstup úloh na pozadí si Claude čte běžným čtením souboru. Sledování průběhu (nástroj Monitor) má nově vždy časový limit, nejvýš půl hodiny (v jednorázových bězích `-p` deset minut), a pak Clauda vyzve, ať sledování obnoví.

**Neviditelné znaky v promptu.** Claude Code odstraní z promptu neviditelné formátovací znaky Unicode a vyčištěný text vám ukáže před odesláním. Skrytý text v takových znacích je známý způsob, jak do vloženého obsahu propašovat instrukce.

**VS Code.** Navržené změny jde schvalovat po jednotlivých úpravách, mapa agentů ukazuje i úlohy na pozadí s tlačítkem pro zastavení a krok přerušený znovunačtením okna pokračuje.

---

## Co si z toho odnést

**Pracujete hlavně v terminálu?** Vyzkoušejte okamžité odeslání fronty zpráv (Ctrl+Enter) a zkontrolujte, co se vám synchronizuje z claude.ai. Pokud máte v repozitářích jen AGENTS.md, Claude Code ho teď přečte sám.

**Držíte víc sezení najednou?** Projects jsou přesně pro vás, pokud pracujete s repozitáři na github.com a máte tarif Pro nebo Max. Počítejte s rychlejším čerpáním limitů a s tím, že projekt nesdílíte s kolegy.

**Spravujete integrace a firemní nasazení?** Projděte přechod na MCP v2 a na serverový klasifikátor auto mode na Bedrocku, Vertexu a Foundry, rozhodněte o synchronizaci skills a pluginů z claude.ai ve spravovaných nastaveních a zvažte, kterým subagentům vypnout načítání CLAUDE.md.

---

*Zdroje: [changelog Claude Code](https://code.claude.com/docs/en/changelog), verze 2.1.270 až 2.1.278 (12. až 19. září 2026), a dokumentace Claude Code ve stavu archivovaném v týdnu vydání, zejména stránka [Projects](https://code.claude.com/docs/en/claude-projects) z 18. září 2026. Projects jsou v betě a jejich dostupnost, tarify i limity se mohou měnit.*
