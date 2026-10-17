---
author: Patrick Zandl
categories:
- AI
- Claude Code
- Anthropic
- Vývojářské nástroje
layout: post
title: "Fork mode jako výchozí stav a podpora GitLabu: novinky Claude Code z týdne 33"
post_excerpt: "Týden 33 (10.–14. srpna 2026) přinesl do Claude Code tři větší změny: fork mode se zapíná automaticky ve všech interaktivních relacích, GitLab se dostává na roveň GitHubu co do integrace merge requestů i tržišť pluginů, a desktopová aplikace si po vypršení limitu relace dokáže sama znovu rozběhnout přerušenou práci. Vydány verze v2.1.225 až v2.1.233."
summary_points:
- "Fork mode je od v2.1.232 zapnutý ve výchozím nastavení — subagenti dědí celou konverzaci a prompt cache, takže kontext předávat znovu není třeba."
- "GitLab merge requesty a tržiště pluginů jsou od v2.1.232 plně integrovány na úroveň srovnatelnou s GitHubem, včetně maskování tokenů a ochrany konfigurace nástroje glab."
- "Desktopová aplikace nabízí automatické pokračování po resetování limitu relace — přerušená akce se spustí znovu bez ručního zásahu."
---

# Fork mode jako výchozí stav a podpora GitLabu: novinky Claude Code z týdne 33

Týden 33 pokrývá vydání v2.1.225 až v2.1.233 a přinesl tři výraznější změny, z nichž každá cílí na jiný aspekt práce: správu kontextu při větvení úloh, paritu mezi GitLabem a GitHubem a komfort při práci s denními limity. Charakter období je spíše zaokrouhlovací než průlomový — žádná změna nepřevrací model práce, ale každá odstraňuje tření, které zkušení uživatelé dobře znají.

## Přehled hlavních změn

- Fork mode zapnutý ve výchozím nastavení (v2.1.232)
- GitLab merge requesty a tržiště pluginů (v2.1.232)
- Automatické pokračování po vypršení limitu relace v desktopové aplikaci (Desktop)

---

## Velké změny

### Fork mode zapnutý ve výchozím nastavení

Od v2.1.232 se fork mode aktivuje automaticky v každé interaktivní relaci. Subagent typu fork nespouští prázdnou konverzaci, ale přebírá celou historii a prompt cache volající relace. Vedlejší úlohu tak lze zadat bez opakovaného vysvětlování kontextu, který Claude v hlavní větvi již zná. Subagenti spouštění přímo interaktivní relací — nikoli spoluhráčem v týmu agentů — navíc nyní běží na pozadí jako výchozí chování.

**Interpretace:** Změna nejvíce pomůže těm, kdo rozčleňují složité úlohy do paralelních dílčích kroků. Dosud bylo ruční zapnutí fork mode nutnou administrativou; nyní se kontextová kontinuita stává základním stavem. Pozor — subagenti spuštění jiným agentem v rámci týmu sdílené chování nezdědí, takže chování vícestupňových pipeline se nezmění automaticky.

[Dokumentace: Sub-agents – Fork mode](https://code.claude.com/docs/en/sub-agents#turn-fork-mode-on-or-off) (v2.1.232)

---

### GitLab merge requesty a tržiště pluginů

GitLab se v této verzi dostává na srovnatelnou úroveň s GitHubem hned v několika rovinách. Tržiště pluginů nyní správně klonují holé adresy URL z gitlab.com včetně vnořených podskupin. Od v2.1.233 lze předat URL GitLab merge requestu přepínači `--worktree` a Claude Code z něj vytvoří větev; zobrazení `claude agents` označuje relace svázané s merge requestem jako `!N`. Bezpečnostní stránka nechybí: Claude Code maskuje rodiny tokenů jako `glpat-` a `glrt-` a chrání konfigurační úložiště nástroje `glab` stejným způsobem, jakým dosud chránil `gh`.

**Interpretace:** Pro týmy pracující výhradně nebo souběžně v GitLabu jde o zásadní praktický krok — doposud chyběla nativní integrace na úrovni, která existovala pro GitHub. Maskování tokenů a ochrana konfigurace `glab` jsou tichým, ale důležitým bezpečnostním doplněním; projekty s CI/CD přes GitLab přestávají být vůči únikům citlivých údajů v nevýhodě.

[Dokumentace: Worktrees – Branch from a pull/merge request](https://code.claude.com/docs/en/worktrees#branch-from-a-pull-request) (v2.1.232)

---

### Automatické pokračování po vypršení limitu relace v desktopové aplikaci

Narazíte-li na limit relace v záložce Code desktopové aplikace, zobrazí se nová možnost: zaškrtávací políčko „Automaticky pokračovat po resetování limitu". Po zaškrtnutí aplikace sama zopakuje přerušenou akci v době resetu, kterou karta rovnou zobrazí. Týdenní limit tuto možnost nenabízí.

**Interpretace:** Drobná UX změna s výrazným dopadem na dlouho běžící automatizované relace — přerušení limitu přestává vyžadovat ruční dohled. Limit týdenní zůstává mimo dosah automatiky, což má zřejmě důvody na straně cenových plánů; uživatelé provozující náročné nočními dávkové úlohy si tuto hranici musí hlídat sami.

[Dokumentace: Errors – Session limit](https://code.claude.com/docs/en/errors#youve-hit-your-session-limit) (Desktop)

---

## Drobnosti

- Zadáním `@` v promptu [lze zmínit jinou relaci Claude](https://code.claude.com/docs/en/cross-session-messaging#message-another-session) jménem a Claude jí přímo odešle zprávu přes `SendMessage`; pokud jméno jednoznačně odpovídá jedné živé relaci, potvrzovací krok odpadá
- [Unikátní názvy relací](https://code.claude.com/docs/en/cross-session-messaging#see-which-sessions-claude-can-reach): pojmenujete-li relaci stejně jako jiná živá relace, Claude Code automaticky vygeneruje variantu ve tvaru `název-slovo-slovo` a uživatele o tom informuje
- Tržiště pluginů nově podporují [zdroje příkazů](https://code.claude.com/docs/en/plugin-marketplaces#command-sources): lokální příkaz vypíše adresář pluginu, který Claude Code při každém spuštění relace znovu vyhodnotí a aplikuje bez restartu
- Na Linuxu a v prostředí WSL lze proměnnou [`CLAUDE_CODE_TOOL_MEMORY_LIMIT`](https://code.claude.com/docs/en/tools-reference#memory-limit-on-linux-and-wsl) (například `4G`) omezit paměť dostupnou příkazům nástroje Bash a PowerShell
- Nástroje pro sledování úloh (`TaskCreate`, `TaskUpdate`, `TodoWrite` a podobné) [nejsou nadále dostupné na modelech Opus 4.8, Sonnet 5, Fable 5, Mythos 5 a novějších v těchto rodinách](https://code.claude.com/docs/en/tools-reference#task-tool-availability); proměnná `CLAUDE_CODE_ENABLE_TODO_TOOLS=1` je vrátí zpět
- [`/code-review`](https://code.claude.com/docs/en/code-review#review-a-diff-locally) na úrovních `high`, `xhigh` a `max` nyní běží v agentovi na pozadí stejně jako ostatní úrovně
- [`/plugin install plugin@marketplace`](https://code.claude.com/docs/en/discover-plugins#install-plugins) před instalací automaticky aktualizuje tržiště, takže nově publikované pluginy nevyžadují ruční obnovení
- Nastavení přijímají [`additionalMarketplaces` a `allowedMarketplaces`](https://code.claude.com/docs/en/settings-reference#marketplace-key-aliases) jako aliasy pro `extraKnownMarketplaces` a `strictKnownMarketplaces`
- Na novějších modelech Claude dokáže [přepsat existující soubor nástrojem Write](https://code.claude.com/docs/en/tools-reference#write-tool-behavior) bez předchozího čtení v aktuální relaci — stejná pravidla jako u nástroje Edit; starší modely čtení stále vyžadují
- Rozšíření pro VS Code umožňuje [uspořádat seznam relací do skupin](https://code.claude.com/docs/en/vs-code#organize-sessions-into-groups): pravým tlačítkem skupinu vytvoříte, přejmenujete nebo smažete, kombinací Cmd/Ctrl nebo Shift s kliknutím přesunete více relací najednou
- Pokud vaše organizace provozuje Claude Code přes [bránu Claude apps s limity útraty](https://code.claude.com/docs/en/claude-apps-gateway-spend-limits), Claude Code při dosažení limitu zobrazí období limitu, čas jeho resetování a zprávu operátora

---

Týden 33 je charakteristický scelováním — GitLab dorovnává GitHub, fork mode přestává být volitelnou funkcí a stává se základem, desktopová aplikace přebírá rutinní dohled po resetování limitu. Pro týmy s GitLabem ve workflow jde o nejvýznamnější moment tohoto vydání; pro ostatní je nejzajímavější změnou výchozí fork mode, který prospěje každému, kdo práci dělí do paralelních větví. Drobností přibylo mnoho — žádná sama o sobě nepřevrací pracovní postup, ale dohromady snižují počet situací, kdy je třeba sahat mimo Claude Code.
