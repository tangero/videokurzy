---
author: Patrick Zandl
categories:
- AI
- Claude Code
- Anthropic
- Vývojářské nástroje
layout: post
title: "Claude Code: relace si píšou mezi sebou, subagenti dědí kontext a marketplace se otevírá GitLabu"
post_excerpt: "Devět verzí Claude Code (v2.1.225–v2.1.233) staví na komunikaci mezi relacemi: lze je oslovit přes @ a zprávy putují i mezi stroji. Vedle toho přibyly zdroje a podpora GitLabu v marketplacích pluginů, zpřísnění sandboxu a oprávnění a změny ve výchozím chování subagentů a nástrojů pro správu úkolů."
summary_points:
- Jiné relace Claude lze oslovit přes @ a SendMessage, od verze v2.1.225 i na jiných strojích přes Remote Control.
- V /config se dá nastavit, zda příchozí zprávy z jiných relací přijímat, podržet, nebo odmítat.
- Forkující subagenti ve výchozím stavu dědí celou konverzaci i prompt cache.
- Nejnovější modely už nemají nástroje pro správu úkolů, zpět je vrátí proměnná CLAUDE_CODE_ENABLE_TODO_TOOLS=1.
- Marketplacy pluginů umí zdroje typu command a klonují repozitáře z gitlab.com stejně jako z github.com.
- Postranní panel ve VS Code podporuje skupiny relací.
---

# Claude Code: relace si píšou mezi sebou, subagenti dědí kontext a marketplace se otevírá GitLabu

Týden 33 přinesl devět verzí Claude Code, od v2.1.225 do v2.1.233. Hlavní linií je komunikace mezi relacemi: jiné relace Claude lze oslovit přes @ a zprávy putují i mezi stroji. Druhou linií je rozšíření marketplaců pluginů o příkazové zdroje a podporu GitLabu. Třetí tvoří řada zpřísnění kolem sandboxu, oprávnění a maskování tajných údajů. K tomu se mění výchozí chování subagentů a sada nástrojů na nejnovějších modelech.

- Oslovení jiných relací Claude přes @-zmínky a `SendMessage` (v2.1.232)
- Nastavení příchozích zpráv z jiných relací v `/config` (v2.1.232)
- Forkování subagentů zapnuté ve výchozím stavu (v2.1.232)
- Odebrání nástrojů pro správu úkolů na nejnovějších modelech a uvolnění nástroje Write (v2.1.233)
- Marketplacy pluginů: příkazové zdroje a podpora GitLabu (v2.1.229)
- Skupiny relací v postranním panelu VS Code (v2.1.229)

**Oslovení jiných relací Claude přes @-zmínky a `SendMessage`.** V promptu stačí napsat `@` a jméno jiné relace Claude, Claude ji pak osloví přímo přes `SendMessage`. Nástroj `SendMessage` nově doručí zprávu na holé jméno, které přesně odpovídá jedné živé relaci. Interaktivní relace na jednom stroji mají unikátní jména, a pokud je jméno obsazené, vznikne varianta ve tvaru `name-word-word`. Od verze v2.1.225 umí `SendMessage` podle jména zahájit konverzaci také s vašimi relacemi Remote Control na jiných strojích. Interpretace: souběžně běžící relace se tím mění z izolovaných ostrůvků v adresovatelné účastníky. Nejvíc si polepší ten, kdo drží rozpracované úlohy na více strojích a dosud je musel propojovat ručně. Dokumentace: [Cross-session messaging](https://code.claude.com/docs/en/cross-session-messaging). (v2.1.232)

**Nastavení příchozích zpráv z jiných relací v `/config`.** Nabídka `/config` získala řádek „Messages from your other sessions“, kde lze příchozí zprávy z jiných relací přijímat, podržet, nebo odmítat. Přibyl i řádek „Dialog expiry“. Zprávy mezi relacemi navíc od v2.1.228 ukazují odesílatele a text přímo v řádku, místo aby byly sbalené do jediné řádky. Interpretace: jakmile mohou relace psát jedna druhé, potřebuje uživatel pojistku, která řídí, co do jeho relace smí doputovat. Tohle nastavení ji dodává a zároveň zlepšuje čitelnost toho, kdo co poslal. Dokumentace: [Cross-session messaging](https://code.claude.com/docs/en/cross-session-messaging). (v2.1.232)

**Forkování subagentů zapnuté ve výchozím stavu.** Subagent se `subagent_type: "fork"` nyní zdědí celou konverzaci i prompt cache. Spouštění agentů, kteří nejsou teammate, běží v interaktivních relacích ve výchozím stavu na pozadí. Paralelní rozvětvení workflow navíc zpožďují souběžné sesterské agenty se shodným prefixem, takže pozdější z nich čtou prefix promptu z cache a neplatí ho znovu. Interpretace: kdo rozděluje práci mezi několik subagentů nad společným kontextem, může počítat s nižšími náklady na opakované zpracování téhož prefixu. Běh na pozadí zase mění rytmus práce, protože hlavní relace nečeká na každého spuštěného agenta. Dokumentace: [Subagenti](https://code.claude.com/docs/en/sub-agents). (v2.1.232)

**Odebrání nástrojů pro správu úkolů na nejnovějších modelech a uvolnění nástroje Write.** Nástroje pro sledování úkolů (TaskCreate, TaskGet, TaskUpdate, TaskList a TodoWrite) už nejsou dostupné na modelech Opus 4.8, Sonnet 5, Fable 5, Mythos 5 a novějších. Vrátí je nastavení `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`. Nástroj Write dále umožňuje novějším modelům přepsat existující soubor, který v dané relaci nečetly, v souladu s pravidly nástroje Edit. Interpretace: kdo má v promptech, skriptech nebo vlastních workflow vazbu na tyto nástroje, měl by změnu otestovat, proměnná prostředí slouží jako záchranná cesta. Uvolněné Write lze číst jako sjednocení pravidel obou zapisovacích nástrojů. Dokumentace: [Tools reference](https://code.claude.com/docs/en/tools-reference). (v2.1.233)

**Marketplacy pluginů: příkazové zdroje a podpora GitLabu.** Marketplacy pluginů mohou používat zdroje typu `command`. Lokální příkaz, například z IDE, vypíše adresář pluginu, ten se při každé relaci znovu vyhodnotí a použije bez restartu. S `mode: "link"` se plugin používá přímo na místě. Od v2.1.232 se holé URL repozitářů z `gitlab.com`, včetně vnořených podskupin, klonují stejně jako URL z `github.com`. `/plugin install plugin@marketplace` také nejprve obnoví daný marketplace. Interpretace: příkazové zdroje zkracují cestu mezi vývojem pluginu v IDE a jeho vyzkoušením v Claude Code. Týmy hostující kód na GitLabu se přestávají cítit jako druhá kategorie. Dokumentace: [Plugins](https://code.claude.com/docs/en/plugins/overview). (v2.1.229)

**Skupiny relací v postranním panelu VS Code.** Postranní panel ve VS Code nově podporuje skupiny relací. Pravým tlačítkem je možné skupinu vytvořit, přejmenovat nebo smazat, a kliknutím s Cmd/Ctrl nebo Shiftem lze přesouvat více relací najednou. Interpretace: jde o komfortní změnu, která oceníte až s růstem počtu relací. Přichází v týdnu, kdy se relace díky vzájemné komunikaci množí. Dokumentace: [VS Code](https://code.claude.com/docs/en/vs-code). (v2.1.229)

Drobnosti:
- Upozornění na využití podporuje limity útraty na gateway: zpráva o dosažení limitu uvádí strop, čas obnovení a zprávu operátora (vyžaduje gateway ve verzi 2.1.225).
- `claude agents` nově zobrazuje pro nedůvěryhodné adresáře výzvu k potvrzení důvěry v pracovní prostor, stejně jako `claude`.
- Fotografie přiložené z aplikace Claude přes Remote Control se nově ukazují Claudovi přímo, bez čtení z disku samostatným voláním nástroje.
- Fable 5 je opět nabízen jako advisor v `/advisor` pro organizace s přístupem k Fable.
- URL merge requestů z GitLabu fungují s `--worktree` i v zobrazení `claude agents`, kde se MR zobrazují jako `!N`.
- Volitelná proměnná `CLAUDE_CODE_TOOL_MEMORY_LIMIT` přidává na Linuxu paměťovou cgroup pro příkazy nástroje Bash, takže splašený build nezablokuje relaci.
- Nová proměnná `CLAUDE_CODE_WEBFETCH_CACHE_TTL_MS` nastavuje TTL relační URL cache nástroje WebFetch (výchozí hodnota zůstává 15 minut).
- Remote Control se po výpadku sítě snaží znovu připojit zhruba 30 minut a terminál hlásí, zda byla relace převzata, ukončena jinde, nebo smazána.
- Průběh komprimace nově ukazuje odpočet opakování a nápovědu při zaseknutí a chyby „prompt is too long“ vysvětlují, proč automatická komprimace nepomohla.
- Maskování tajných údajů pokrývá rodiny tokenů GitLabu a konfigurační úložiště CLI `glab` má stejnou ochranu sandboxu a cest k přihlašovacím údajům jako `gh`.
- Chybějící nebo prošlé přihlašovací údaje Google Cloud na Vertex AI nyní selžou během vteřin, místo aby se minuty opakovaly.
- Panel vedlejších otázek `/btw` ve VS Code lze zvětšovat a zmenšovat tažením za hranici.
- `/code-review` na úrovních high, xhigh a max nově běží v agentovi na pozadí jako ostatní úrovně.

Celkově je to týden, ve kterém se Claude Code učí pracovat s více relacemi a agenty najednou, a zároveň k tomu přidává kontrolní prvky. Nejzajímavější je to pro uživatele, kteří provozují několik souběžných relací nebo subagentů: ti získají adresné zprávy mezi relacemi, nastavení příchozí komunikace a levnější sdílení kontextu díky cache. Týmy na GitLabu ocení marketplacy a podporu merge requestů, autoři pluginů příkazové zdroje. Vývojáři postavení na nástrojích pro správu úkolů
