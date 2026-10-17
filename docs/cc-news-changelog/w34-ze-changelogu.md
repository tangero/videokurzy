---
author: Patrick Zandl
categories:
- AI
- Claude Code
- Anthropic
- Vývojářské nástroje
layout: post
title: "Claude Code se po vyčerpání limitu sám rozběhne, mluví stručněji a lépe spolupracuje mezi relacemi"
post_excerpt: "Verze 2.1.234 až 2.1.239 přinášejí hlavně vylepšení každodenní práce: automatické pokračování po obnovení limitu, nový stručný styl výstupu, kontrolu pravopisu v promptu a chytřejší práci s cíli i zprávami mezi relacemi, nově i na Windows."
summary_points:
- Dialogy jako /permissions nebo /add-dir lze otevřít, i když Claude právě pracuje (v2.1.234).
- Zprávy mezi relacemi dostaly volbu notify_when_idle a podporu Windows (v2.1.236).
- Claude Code po obnovení limitu na claude.ai automaticky pokračuje v práci (v2.1.234).
- Přibyl vestavěný styl výstupu „Concise", který klade na začátek výsledek (v2.1.237).
- Prompt má volitelnou kontrolu pravopisu (v2.1.235).
- Příkaz /goal chytřeji kontroluje úlohy na pozadí a umí se zotavit z chyb (v2.1.239).
---

# Claude Code se po vyčerpání limitu sám rozběhne, mluví stručněji a lépe spolupracuje mezi relacemi

Verze 2.1.234 až 2.1.239 nepřinášejí žádný převratný release, ale soustředěné vylepšení pracovního postupu. Linie změn jsou tři. První je větší samostatnost: Claude Code po obnovení limitu pokračuje sám a `/goal` si hlídá úlohy na pozadí. Druhá je lepší koordinace relací, včetně příchodu na Windows. Třetí je pohodlí při psaní a čtení: nový stručný styl výstupu, kontrola pravopisu a dialogy dostupné i uprostřed běžícího kroku. Drobnosti pak zahrnují úsporu při načítání skillu `claude-api`, opravy prompt cache a podporu GitLabu.

## Přehled velkých změn

- Zprávy mezi relacemi: `notify_when_idle` a podpora Windows (v2.1.236)
- `/goal` s chytřejšími kontrolami a zotavením (v2.1.239)
- Automatické pokračování po obnovení limitu na claude.ai (v2.1.234)
- Dialogy otevřené za běhu práce Claudea (v2.1.234)
- Vestavěný styl výstupu „Concise" (v2.1.237)
- Kontrola pravopisu v promptu (v2.1.235)

## Zprávy mezi relacemi: `notify_when_idle` a podpora Windows

`SendMessage` získává volbu `notify_when_idle`. Požádá jinou relaci Claude Code na stejném stroji, aby poslala jedno upozornění, až bude příště nečinná. Je to volitelné, jednorázové, bez opakovaného dotazování a podporu mají macOS a Linux. Zprávy mezi relacemi nově fungují také na Windows. Odesílatel navíc dostane výslovnou zpětnou vazbu, když je zpráva odmítnuta nebo zahozena, a `ListAgents` vypíše aktivní členy týmu.

Interpretace: kdo provozuje více relací současně, dosud musel stav ostatních hlídat ručně. Jednorázové upozornění při nečinnosti je přesně ten mechanismus, který z paralelních relací dělá použitelný tým. Zpětná vazba při odmítnutí zprávy odstraňuje tiché selhávání. Největší přínos mají uživatelé Windows, kteří se k této funkci dostali poprvé. (v2.1.236) [Dokumentace](https://code.claude.com/docs/en/cross-session-messaging)

## `/goal` s chytřejšími kontrolami a zotavením

Pokud cíl čeká na úlohy na pozadí, Claude je nově sám zkontroluje po 30 minutách, pak v rozestupech 1 hodiny a 2 hodin. Cíl se také sám zruší s upozorněním, když krok skončí neopravitelnou chybou. Obnovení z výběru `claude --resume` vrátí aktivní cíl. Kontroly lze vypnout nastavením `CLAUDE_CODE_GOAL_CHECKIN_MINUTES=0`.

Interpretace: u dlouhých úloh se `/goal` dosud mohl zaseknout, aniž by si toho někdo všiml. Postupně řidnoucí kontroly řeší čekání na pozadí bez zbytečného zahlcování. Samočinné zrušení cíle po fatální chybě zase brání tomu, aby relace vypadala aktivně, zatímco už nic nedělá. Prospěje to všem, kdo nechávají Claude pracovat bez dozoru. (v2.1.239) [Dokumentace](https://code.claude.com/docs/en/goal)

## Automatické pokračování po obnovení limitu

Claude Code nově sám pokračuje v relaci, jakmile se obnoví limit využití na claude.ai. Chování lze vypnout v `/config` pod položkou „Continue automatically at usage limit".

Interpretace: spolu s `/goal` je to další krok k úlohám, které přežijí i narazení na limit, bez ručního „pokračuj". Kdo si spotřebu limitů hlídá pečlivě, měl by si nastavení v `/config` zkontrolovat, protože souvislá práce může znamenat rychlejší čerpání. (v2.1.234) [Dokumentace](https://code.claude.com/docs/en/settings)

## Dialogy otevřené za běhu práce Claudea

`/permissions` lze otevřít i uprostřed kroku a změny pravidel se uplatní na zbytek aktuálního kroku. Za běhu funguje také `/add-dir <path>`. V celoobrazovkovém TUI se uprostřed kroku otevřou i dialogy `/add-dir`, `/autocompact`, `/theme`, `/help`, `/config` a `/advisor`.

Interpretace: nejpraktičtější je možnost upravit oprávnění v okamžiku, kdy zjistíte, že Claude potřebuje přístup jinam nebo naopak míří příliš daleko. Nemusíte krok přerušovat a začínat znovu. Změna pravidel s okamžitým účinkem je užitečná i z bezpečnostního hlediska. (v2.1.234) [Dokumentace](https://code.claude.com/docs/en/permissions)

## Vestavěný styl výstupu „Concise"

Nový vestavěný styl výstupu vede Clauda k tomu, aby začínal výsledky a vynechával úvody i komentování vlastního postupu, přičemž práci odvádí stejně důkladně. Vybírá se v `/config` v části Output style. Související oprava zajišťuje, že vlastní styly, styly projektu a styly z pluginů se uprostřed relace nevracejí k výchozímu hlasu.

Interpretace: styl osloví hlavně ty, kdo čtou desítky odpovědí denně a výsledek potřebují vidět hned. Oprava driftu je důležitá pro týmy, které si styl výstupu definují vlastní a spoléhají na jeho stálost. (v2.1.237) [Dokumentace](https://code.claude.com/docs/en/output-styles)

## Kontrola pravopisu v promptu

Nové volitelné nastavení `spellcheck` podtrhává chybně napsaná slova v promptu během psaní. Využívá nainstalovaný `aspell`, `hunspell` nebo `ispell`.

Interpretace: jde o drobné pohodlí, které ale může pomoci tam, kde překlep v promptu změní zadání. Zda půjde dobře používat s češtinou, závisí na slovnících nainstalovaných v systému. Zdroj to neuvádí, před tiskem doporučuji ověřit. (v2.1.235) [Dokumentace](https://code.claude.com/docs/en/settings-reference)

## Drobnosti

- Nová proměnná prostředí `ANTHROPIC_DEFAULT_MODEL` určuje model, na kterém začínají nové relace; volba přes `/model` ji stále přebije a přetrvá i restart, na rozdíl od `ANTHROPIC_MODEL`.
- Nastavení `keybindingFlavor: "readline"` nechává Ctrl+W mazat zpět po předchozí mezeru jako v Bashi a sjednocuje s Bashem i Alt+F, Ctrl/Option+→ a Alt+D.
- Odznak merge requestu z GitLabu se objeví v patičce a ve stavovém řádku u repozitářů s GitLab remote a přihlášeným `glab` CLI.
- Vestavěný skill `claude-api` se načítá za zhruba 25 tisíc tokenů místo více než 200 tisíc a `/claude-api upgrade` převádí projekty v Pythonu z `anthropic` 0.x na 1.x.
- Vlastní prompty v přepisu se nově vykreslují jako markdown (zvýrazněné bloky kódu, inline kód, seznamy) stejně jako odpovědi.
- Rozšíření pro VS Code přidává podporu čteček obrazovky pro přepis, s živým oznamováním a navigací po nadpisech jednotlivých kroků.
- Opravena prompt cache u relací s LLM gateway nebo vlastní base URL a při opětovném připojení language serveru uprostřed relace, které dříve zneplatnilo celou cache.
- Celoobrazovkový renderer se nově nabízí jednou i na Bedrocku, Vertexu, Foundry a dalších dříve vyloučených konfiguracích, kde nové instalace startují celoobrazovkově.
- Pluginové marketplaces podporují `headersHelper`, příkaz generující HTTP hlavičky (např. krátkodobé tokeny) pro stahování katalogu a archivů, spouštěný po schválení při instalaci či aktualizaci.
- `claude self-hosted-runner` přidává `--defer-shutdown-max-min` pro obsluhu relací po SIGTERM a `--proxy-authorization-command`/`--proxy-authorization-file` pro egress proxy.
- Odhady nákladů (`/cost`, stavový řádek, `--max-budget-usd`) nově zahrnují příplatek 1,1× za inferenci pouze v USA u workspaců s datovou rezidencí.
- Ctrl+L a Cmd+K v celoobrazovkovém režimu už jen překreslují; zkratka `/clear` dvojitým stiskem byla odstraněna.
- Remote Control lépe odolává výpadkům: toleruje krátká odmítnutí HTTP 403 až 3 minuty, opakuje pokusy po potížích s obnovou přihlášení a při ukončení CLI označí relaci jako offline během několika sekund.

## Závěr

Období není o jedné velké novince, ale o tom, že Claude Code snáší delší a samostatnější práci. Automatické pokračování po limitu, kontroly `/goal` a upozornění mezi relacemi míří stejným směrem: méně ručního dohlížení. Pro uživatele provozující více relací a dlouhé úlohy je proto nejzajímavější trojice `notify_when_idle`, `/goal` a pokračování po limitu. Správci a bezpečnostně orientované týmy ocení úpravu `/permissions` za běhu a podporu `headersHelper` či proxy autorizace. Ostatní si nejspíš nejdřív všimnou stručného stylu výstupu, kontroly pravopisu a úspory při načítání `claude-api`. Opravy prompt cache pak potichu snižují náklady tam, kde se používá gateway nebo vlastní base URL.
