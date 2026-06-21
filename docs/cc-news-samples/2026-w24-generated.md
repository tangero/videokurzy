---
author: Patrick Zandl
categories:
- AI
- Claude Code
- Anthropic
- Vývojářské nástroje
layout: post
title: "Bezpečný režim, zanořené subagenti a přesun sezení: Claude Code Week 24"
post_excerpt: "Týden 24 (8.–12. června 2026) přinesl do Claude Code tři výraznější změny: diagnostický safe mode pro odhalení problematické konfigurace, schopnost subagentů spouštět vlastní subagenty až do pěti úrovní hloubky, a příkaz /cd pro přesun sezení do jiného adresáře bez ztráty prompt cache. Vedle toho přibyla řada menších vylepšení kolem bezpečnosti, správy modelů a uživatelského pohodlí."
summary_points:
- "Safe mode (--safe-mode nebo CLAUDE_CODE_SAFE_MODE) spustí Claude Code bez všech přizpůsobení — CLAUDE.md, hooks, MCP servery ani vlastní příkazy se nenačtou — a umožní rychle izolovat vadnou konfiguraci."
- "Subagenti nyní mohou spouštět vlastní subagenty; panel subagentů zobrazuje celý strom s počty potomků, přičemž řetězec je omezen na pět úrovní."
- "Příkaz /cd přesune aktivní sezení do jiného pracovního adresáře, aniž by přestavěl prompt cache — CLAUDE.md nového adresáře se připojí jako zpráva, nikoli jako nový systémový prompt."
- "Záložní modely lze nově konfigurovat přes fallbackModel až jako trojici, a --fallback-model funguje i v interaktivních sezeních."
- "Cross-session zprávy přenesené přes SendMessage již neobnáší uživatelská oprávnění; auto mode je blokuje."
---

# Bezpečný režim, zanořené subagenti a přesun sezení: Claude Code Week 24

Týden 24 (8.–12. června 2026) pokrývají verze v2.1.166 až v2.1.176. Nejde o velký release s jediným dominantním tématem — spíše o trojici věcně odlišných přírůstků, z nichž každý řeší jinou část práce s nástrojem: diagnostiku konfigurace, orchestraci agentů a mobilitu sezení. Vedle toho přibylo přes deset drobnějších oprav a rozšíření.

## Přehled hlavních změn

- Diagnostický safe mode — spuštění bez všech přizpůsobení (v2.1.169)
- Subagenti mohou spouštět vlastní subagenty, strom viditelný v panelu (v2.1.172)
- Příkaz `/cd` přesune sezení do jiného adresáře bez přestavby prompt cache (v2.1.169)

---

## Velké změny

### Zanořené subagenty — orchestrace na více úrovních

Subagenti nyní mohou spouštět vlastní subagenty. Panel subagentů pod promptem zobrazuje celý strom: každý řádek nese počet přímých i nepřímých potomků a cestu zpět k hlavnímu sezení. Řetězec je omezen na pět úrovní hloubky, aby se zabránilo nekontrolovanému souběžnému větvení.

*Proč na to:* Dosud bylo agentní větvení plošné — subagent mohl delegovat práci jen modelu, nikoli dalšímu subagentovi. Pětistupňový strom otevírá hierarchické dekompozice úloh, kde každá vrstva řeší jiný granularitu problému. Největší přínos pocítí ti, kdo stavějí složitější automatizační pipelines; vizualizace stromu v panelu je rovněž praktická pomůcka při ladění, kde a proč se větvení zaseklo. Omezení na pět úrovní je rozumná pojistka — do té doby většina reálných úloh vejde.

[Dokumentace: Spawn nested subagents](https://code.claude.com/docs/en/sub-agents#spawn-nested-subagents) (v2.1.172)

---

### Safe mode — izolace vadné konfigurace

Spuštění s přepínačem `--safe-mode` nebo nastavením proměnné `CLAUDE_CODE_SAFE_MODE` spustí Claude Code bez všech přizpůsobení: CLAUDE.md, skills, pluginy, hooks, MCP servery a vlastní příkazy ani agenti se nenačtou. Autentizace, výběr modelu, vestavěné nástroje a oprávnění fungují i nadále. Pokud problém v safe mode zmizí, příčina leží v jedné z vypnutých vrstev.

*Proč na to:* Komplexní konfigurace s více MCP servery, hooks a vlastními příkazy může být obtížně laditelnná — chyba v jedné vrstvě se projeví symptomy, které nevedou přímo ke zdroji. Safe mode poskytuje jednoznačný výchozí bod: buď problém přetrvá (a hledáme jinde), nebo zmizí (a postupně zapínáme vrstvy zpět). Jde o standardní diagnostický přístup, jehož absence dosud chyběla.

[Dokumentace: Test against a clean configuration](https://code.claude.com/docs/en/debug-your-config#test-against-a-clean-configuration) (v2.1.169)

---

### Příkaz `/cd` — přesun sezení bez ztráty kontextu

Nový příkaz `/cd` přesune aktivní sezení do jiného pracovního adresáře. Prompt cache se nepřestavuje: CLAUDE.md nového adresáře se připojí jako zpráva, nikoli jako náhrada systémového promptu. Sezení se přemístí do úložiště projektu nového adresáře, takže `--resume` a `--continue` jej tam najdou. Pokud v daném adresáři ještě nepracoval, Claude vyzve k udělení důvěry.

*Proč na to:* Dosud přechod do jiného adresáře znamenal nové sezení — nový kontext, nová cache. `/cd` zachovává konverzační historii i accumulated kontext, takže přechod mezi moduly monorepa nebo mezi projekty téhož klienta nemusí začínat od nuly. Zachování prompt cache je ekonomicky i časově nezanedbatelné u dlouhých sezení. Automatická výzva k důvěře adresáři je správné bezpečnostní chování, nikoli obtíž.

[Dokumentace: All commands](https://code.claude.com/docs/en/commands#all-commands) (v2.1.169)

---

## Drobnosti

- `fallbackModel` konfiguruje až trojici záložních modelů zkoušených postupně při přetížení nebo nedostupnosti primárního; `--fallback-model` nově funguje i v interaktivních sezeních — [dokumentace](https://code.claude.com/docs/en/model-config#fallback-model-chains)
- Názvy sezení se generují v jazyce konverzace; konkrétní jazyk lze připnout nastavením `language`
- `claude agents --json` přijímá `--all` pro zahrnutí dokončených sezení, přibyly pole `id` a `state`, blokovaná ani čerstvě odeslaná sezení se již nevynechávají
- Procházení pluginů na tržišti v `/plugin` má nyní vyhledávací pole
- Nové nastavení `disableBundledSkills` a proměnná `CLAUDE_CODE_DISABLE_BUNDLED_SKILLS` skryjí vestavěné skills, workflows a příkazy před modelem
- Pravidla Deny nyní přijímají glob na pozici názvu nástroje — `"*"` zamítne všechny nástroje; neznámé názvy nástrojů v pravidlech Deny nyní varují při spuštění
- Cross-session zprávy přenášené přes `SendMessage` z jiných sezení již neobnáší uživatelská oprávnění; auto mode je blokuje
- Amazon Bedrock čte region AWS ze souborů `~/.aws/config`, pokud `AWS_REGION` není nastavena; `/status` ukáže, odkud region pochází
- Nové spravované nastavení `enforceAvailableModels` zajistí, že allowlist `availableModels` omezuje i výchozí model
- Nástroje prohlížeče Chrome pro Claude se nyní načítají jedním dávkovým voláním místo jednoho volání na nástroj
- `claude update` oznámí cílovou verzi před zahájením stahování — přestane mlčet
- Nové nastavení `footerLinksRegexes` přidává do zápatí odznaky s odkazy odpovídajícími regulárním výrazům

---

Týden 24 je charakteristický pragmatismem: žádná dramatická přestavba, ale tři změny, které každá odstraňuje konkrétní třecí plochu. Nejvýznamnější je pravděpodobně zanořování subagentů — otevírá architektonické možnosti, které dosud nebyly dostupné, a jeho omezení na pět úrovní svědčí o záměrném designu. Safe mode ocení každý, kdo spravuje rozsáhlejší konfiguraci a setkal se s těžko lokalizovatelnou chybou. Příkaz `/cd` pak nejvíce pomůže těm, kdo v průběhu dne přecházejí mezi více projekty a nechtějí kvůli tomu ztrácet kontext sezení.
