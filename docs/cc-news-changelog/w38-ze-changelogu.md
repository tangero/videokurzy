---
author: Patrick Zandl
categories:
- AI
- Claude Code
- Anthropic
- Vývojářské nástroje
layout: post
title: "Claude Code: Projects pro paralelní cloudové relace, podpora AGENTS.md a MCP v2 jako výchozí klient"
post_excerpt: "Týdenní řada verzí 2.1.270 až 2.1.278 přinesla beta Projects pro koordinaci paralelních cloudových relací z jedné konverzace. Většina ostatních změn se týká konfigurace a integrace: podpora AGENTS.md, synchronizace skills a pluginů z claude.ai, serverový klasifikátor v auto mode, nové řízení přihlášení přes gateway a klient MCP v2 jako výchozí."
summary_points:
- "Claude Code čte AGENTS.md a subagenti mohou běžet bez souborů CLAUDE.md (2.1.277)."
- "Klient MCP v2 je nově výchozí na všech platformách a bezpečněji zachází s konfigurací (v2.1.274)."
- "Auto mode ve výchozím stavu využívá serverový klasifikátor a umožňuje síťové hosty pro jednotlivé příkazy (v2.1.278)."
- "Projects umožňují řídit paralelní cloudové relace z jedné konverzace (web)."
- "Skills a pluginy z účtu claude.ai se synchronizují do terminálu (2.1.275)."
- "Claude apps gateway přidává přihlášení z interní sítě, potvrzení účtu a egress přes proxy (v2.1.277)."
---

# Claude Code: Projects pro paralelní cloudové relace, podpora AGENTS.md a MCP v2 jako výchozí klient

Od 12. do 19. září 2026 vyšlo devět verzí Claude Code, od 2.1.270 do 2.1.278. Hlavní novinkou je Projects, veřejná beta, v níž jedna dlouhodobá konverzace koordinuje paralelní cloudové relace. Zbytek týdne tvoří řada změn v konfiguraci a integraci. Claude Code čte AGENTS.md a subagenti mohou přeskočit CLAUDE.md. Skills a pluginy z účtu claude.ai se synchronizují do terminálu. Auto mode využívá serverový klasifikátor a klient MCP v2 se stává výchozím. K tomu přibyly nové možnosti řízení přihlášení a egressu přes gateway. Nejde tedy o jeden velký release, ale o několik souběžných linií, které posouvají nástroj směrem k organizacím a k práci s více agenty.

## Přehled velkých změn

- Projects: jedna konverzace koordinuje paralelní cloudové relace (web)
- Klient MCP v2 je výchozí všude, konfigurace se zpracovává bezpečněji (v2.1.274)
- Auto mode: serverový klasifikátor jako výchozí a síťoví hosté pro jednotlivé příkazy (v2.1.278)
- Podpora AGENTS.md a subagenti, kteří přeskočí CLAUDE.md (2.1.277)
- Claude apps gateway: přihlášení z interní sítě, potvrzení účtu a egress přes proxy (v2.1.277)
- Skills a pluginy z účtu claude.ai se synchronizují do terminálu (2.1.275)

## Velké změny

**Projects: jedna konverzace koordinuje paralelní cloudové relace.** Projects, veřejná beta pro tarify Pro a Max, svěřují proud souvisejících úkolů jedné dlouhodobé konverzaci s Claudem. Ten funguje jako koordinátor a pro každý úkol spustí vlastní vlákno v cloudové relaci. Každé vlákno má k dispozici repozitáře, instrukce a paměť projektu. Panel Overview ukazuje, která vlákna nebo PR čekají na vaši pozornost. Funkce je dostupná na claude.ai/code, v desktopové aplikaci (pohled Projects v postranním panelu) i v mobilních aplikacích. Vyžaduje repozitáře na GitHub.com s aplikací Claude GitHub App, není k dispozici pro tarify Team a Enterprise ani v CLI a počet nových vláken je omezen na 200 denně. **Význam:** Je to největší posun týdne, protože mění způsob práce. Místo ruční správy mnoha relací zadáváte práci na úrovni projektu a pozornost věnujete jen tomu, co si ji žádá. Omezení znamenají, že zatím osloví hlavně jednotlivce a menší týmy pracující na GitHubu, terminážní uživatele a velké organizace čeká jen pozorování zvenčí. Dokumentace: [Claude Projects](https://code.claude.com/docs/en/claude-projects). (web)

**Klient MCP v2 je výchozí všude, konfigurace se zpracovává bezpečněji.** Instalace pro Bedrock, Vertex, Foundry i instalace s vypnutou telemetrií nově používají klient MCP v2 a vyjednávání MCP 2026-07-28 s přímými HTTP servery. Návrat ke starému chování zajistí `MCP_SDK_GENERATION=v1` nebo `MCP_PROTOCOL_NEGOTIATION=legacy`. Položky `type: sdk` v konfiguračních souborech se nově přeskakují s varováním, protože procesní servery může registrovat jen hostitel SDK. Přihlašovací proměnné jako `ANTHROPIC_API_KEY` se ve vzdálených `url` a `headers` čtou jako prázdné a odkazy `${VAR}` se zobrazují jménem, ne rozloženou hodnotou. **Význam:** Změna výchozího klienta dopadne zejména na uživatele cloudových platforem a může odhalit nekompatibilitu některých serverů, takže se vyplatí ji vyzkoušet dřív, než začne bolet. Skrývání hodnot v konfiguraci zase snižuje riziko, že se tajné údaje objeví tam, kam nepatří. Dokumentace: [MCP](https://code.claude.com/docs/en/mcp). (v2.1.274)

**Auto mode: serverový klasifikátor jako výchozí a síťoví hosté pro jednotlivé příkazy.** Pro uživatele Claude API a Enterprise a také na Bedrocku, Vertexu, Foundry a gateway používá auto mode ve výchozím stavu serverový klasifikátor, který za svou režii neúčtuje. Na platformách třetích stran lze tuto volbu vypnout pomocí `CLAUDE_CODE_AUTO_MODE_SERVER=0`. Při zpoplatněném záložním režimu se zobrazí varování a `/status` má nový řádek „Auto mode server“. Při zapnutém sandboxingu mohou příkazy Bash, PowerShell a Monitor nést vlastní `allowed_domains`. Klasifikátor tyto hosty posoudí spolu s příkazem, otevře je jen pro daný příkaz a ostatní hosty odmítne. **Význam:** Pro každého, kdo auto mode používá denně, odpadá starost o náklady na klasifikaci. Síťový přístup lze navíc povolit úzce, jen pro jediný příkaz. Dokumentace: [Auto mode classifier billing](https://code.claude.com/docs/en/auto-mode-classifier-billing). (v2.1.278)

**Podpora AGENTS.md a subagenti, kteří přeskočí CLAUDE.md.** V projektu bez souboru CLAUDE.md teď Claude Code čte AGENTS.md. Nové nastavení Project instructions v `/config` určuje, které instrukční soubory Claude načítá. Hodnoty jsou například `claude-md-or-agents-md`, `claude-md-and-agents-md`, `claude-md` a `managed-only`. Vlastní subagenti a subagenti z pluginů mohou v hlavičce agenta nebo v JSON pro `--agents` nastavit `omitClaudeMd` a běžet bez uživatelských, projektových a lokálních souborů CLAUDE.md. Soubory spravované politikou se načítají dál. Totéž umí nová volba agenta v SDK. **Význam:** Týmy, které sdílejí instrukce s dalšími nástroji přes AGENTS.md, je nemusí duplikovat. Subagenti pak mohou dostat jen ty instrukce, které potřebují, a politiky organizace přitom zůstávají v platnosti. (2.1.277)

**Claude apps gateway: přihlášení z interní sítě, potvrzení účtu a egress přes proxy.** Přihlášení přes gateway dostává další možnosti řízení. Nové spravované nastavení `gatewayInternalNetworks` umožní, aby `/login` přijal gateway na veřejném bloku IPv4, který organizace vlastní. Pokud gateway pojmenuje přihlášený účet, uživatel ho před uložením přihlašovacích údajů potvrdí a `/status` ho zobrazí. Provozovatelé gateway získávají proměnnou `CLAUDE_GATEWAY_PROXY_IS_EGRESS_BOUNDARY=1` pro egress výhradně přes proxy, statické hlavičky pro jednotlivé upstreamy a cenové násobitele nad 1 (až do 10) pro interní přeúčtování. **Význam:** Změna míří na správce firemních nasazení. Potvrzení účtu pomáhá ověřit, že se přihlašujete tam, kam zamýšlíte, a násobitele ocení ti, kdo náklady rozúčtovávají mezi týmy. Dokumentace: [Claude apps gateway](https://code.claude.com/docs/en/claude-apps-gateway). (v2.1.277)

**Skills a pluginy z účtu claude.ai se synchronizují do terminálu.** Terminálové relace přihlášené účtem claude.ai nově načítají skills a pluginy zapnuté na tomto účtu, včetně pluginů, které zapne organizace. Skills se stahují na pozadí při startu a běžící relace zachytí změny bez restartu. Synchronizované pluginy se načítají jako `<name>@synced` a marketplace hostovaný na claude.ai lze přidat podle názvu příkazem `claude plugin marketplace add --claudeai`. Synchronizaci vypnete nastavením `syncClaudeAiSkills` nebo `syncClaudeAiPlugins` na `false`. Související změny: `/plugin install <plugin> --marketplace <source>` nabídne před instalací přidání marketplace a pluginy z npm zdroje se stahují přes `npm pack --ignore-scripts`, takže se jejich instalační skripty už nespouštějí. **Význam:** Stejná výbava je k dispozici na webu i v terminálu bez ruční správy. Zákaz instalačních skriptů u npm pluginů navíc zmenšuje prostor pro zneužití při instalaci. (2.1.275)

## Drobnosti

- Rychlý režim (fast mode) funguje v relacích Claude Code Remote (cloudové i vlastní runnery): platí nastavení hostitele nebo `/fast` zadané v relaci, pokud to organizace povolí.
- Panel `/config` v režimu celé obrazovky podporuje myš: seznam nastavení posouváte kolečkem a hodnotu změníte kliknutím.
- Klávesy ctrl+enter (nebo ctrl+x ctrl+s) přeruší aktuální tah a odešlou všechny zařazené zprávy najednou; odeslané a zařazené zprávy jsou šedé, dokud je model nepřijme.
- Hlídání přes Monitor má vždy lhůtu (výchozí 5 minut, nejvýše 30, v `-p` bězích 10) a Claude dostane upozornění k opětovnému zapnutí; volba „persistent“ bez časového limitu zmizela.
- Nové hlavičky požadavků pro LLM gateway (`x-claude-code-request-class`, `agent-type`, `prev-tool-durations`, `compaction`, `context-compacted`) se zapínají přes `CLAUDE_CODE_GATEWAY_HINT_HEADERS=1`.
- Relaci spuštěnou přes `claude --remote-control` nebo `/remote-control` lze z aplikace Claude rozvětvit; větev poběží jako relace na pozadí na vašem počítači.
- VS Code: po opětovném načtení okna Claude pokračuje v přerušeném kroku, označeném v chatu; vypíná se nastavením Claude Code: Continue After Reload.
- Claude Code na webu: výběr „Compare against“ v zobrazení diffu cloudové relace umožní porovnat s libovolnou větví, nejen se základní.
- VS Code: tlačítka přijmout a odmítnout pod každou změnou v záložce navržených změn umožňují revizi editace po jednotlivých změnách.
- VS Code: mapa agentů nově uvádí shelly na pozadí a další běžící úlohy, každou s tlačítkem Stop, a zadané `/tasks` ji otevře.
- Hooks PostToolUse pro Bash mohou v `tool_response.bashEditDiff` dostat soubory, které příkaz změnil v repozitáři Git; nastavení `bashEditDiffEnabled` zapne záznam v každém režimu oprávnění.
- Agent view: když smazání relace selže kvůli neodstranitelnému worktree, zpráva nově uvádí příčinu a odstranění lze vynutit dvojitým Ctrl+X na řádku nebo příkazem `claude rm <id> --force-remove-worktree <worktree-id>`.

## Závěr

Období 12. až 19. září ukazuje Claude Code, který roste dvěma směry. Projects posouvají práci od jedné relace ke koordinaci více paralelních vláken. Většina ostatních změn zlepšuje to, co je kolem: sjednocuje instrukce přes AGENTS.md, synchronizuje skills mezi webem a terminálem, zpřesňuje auto mode a zpřísňuje zacházení s konfigurací a pluginy. Pro jednotlivce a menší týmy na GitHubu je nejzajímavější Projects. Správci firemních nasazení ocení hlavně novinky kolem gateway, serverový klasifikátor a výchozí klient MCP v2. Týmy s větším počtem nástrojů a agentů zase podporu AGENTS.md a řízení kontextu subagentů.
