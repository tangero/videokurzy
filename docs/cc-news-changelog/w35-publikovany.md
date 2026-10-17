---
author: Patrick Zandl
categories:
- AI
- Claude Code
- Anthropic
- Vývojářské nástroje
layout: post
title: "Omezený režim, pokračování relací a Claudem psané hlášení chyb: novinky Claude Code z 35. týdne"
post_excerpt: "Pětatřicátý týden přinesl do Claude Code tři větší novinky a bohatou vrstvu drobných vylepšení. Dominuje bezpečnostní restricted mode pro sdílená prostředí, možnost navázat CLI relaci v desktopové aplikaci a automatické drafty zpětné vazby. Souběžně dozrává řada funkcí kolem správy modelů, prompt cache a spolehlivosti neinteraktivních běhů."
summary_points:
- "Restricted mode spouští Claude Code bez nástrojů pro spouštění příkazů a kódu — vhodné pro sdílené stroje a evaluační postroje."
- "Desktopová aplikace nově umí navázat na libovolnou relaci spuštěnou z CLI, včetně celého kontextu konverzace."
- "Při opakovaných chybách nebo neřešitelných požadavcích Claude sám navrhne text zpětné vazby, kterou pak uživatel odešle nebo zahodí."
---

# Omezený režim, pokračování relací a Claudem psané hlášení chyb: novinky Claude Code z 35. týdne

Týden 35 (24.–28. srpna 2026) přinesl do Claude Code tři pojmenované novinky a přes deset drobných vylepšení rozložených napříč CLI, desktopovou aplikací i cloudovými backendy. Charakter vydání je smíšený: jedna změna míří do oblasti bezpečnosti a izolace prostředí, jedna zlepšuje práci s relacemi v desktopové aplikaci a jedna posouvá smyčku zpětné vazby přímo do chatu. Zbytek tvoří vrstva konzistentních kosmetických i výkonnostních úprav — od konfigurace prompt cache přes obnovu přerušených streamů po výrazně menší instalační balíček.

## Přehled velkých změn

- Restricted mode — izolovaný provoz bez nástrojů pro příkazy a kód (v2.1.248)
- Pokračování CLI relací v desktopové aplikaci příkazem `/resume` (Desktop)
- Claude automaticky navrhuje text hlášení chyb nástrojem SendFeedback (CLI)

---

## Velké změny

### Restricted mode: Claude Code pro sdílená prostředí a evaluační postroje (v2.1.248)

Restricted mode spustí Claude Code bez vestavěných nástrojů, které by mohly spouštět příkazy nebo kód. Konkrétně to znamená: Bash a podobné spouštěče jsou nedostupné, WebFetch je odstraněn, souborové nástroje jsou omezeny výhradně na pracovní adresáře, načítají se pouze spravovaná nastavení a soubory předané přes `--settings` a režim `bypassPermissions` je odmítnut. Aktivace je přímočará — přepínač `--restricted` nebo proměnná prostředí `CLAUDE_CODE_RESTRICTED=1`.

Restricted mode řeší scénáře, kde evaluační postroj nebo CI pipeline řídí claude na stroji sdíleném s jinými procesy a kde jakákoli náhodná nebo injektovaná instrukce vedoucí ke spuštění kódu představuje riziko. Šlo o chybějící článek pro týmy, které chtějí Claude Code využívat v automatizovaných hodnoceních bez toho, aby musely budovat vlastní sandbox kolem každého volání. Nejde o náhradu sandboxu na úrovni OS, ale o explicitní, auditovatelnou hranici na straně nástroje samotného.

[Dokumentace: CLI reference — přepínače](https://code.claude.com/docs/en/cli-reference#cli-flags)

---

### Pokračování CLI relací v desktopové aplikaci (Desktop)

Příkaz `/resume` v desktopové aplikaci nyní zobrazí seznam všech relací spuštěných z CLI. Každou relaci lze vyhledat podle názvu, složky nebo větve a před navázáním zobrazit náhled, kde konverzace skončila. Po výběru aplikace relaci obnoví se zachovaným celým kontextem a konverzací.

Přemostění mezi CLI a desktopovou aplikací odstraňuje dosud běžný problém: dlouhá relace zahájená v terminálu se nedala pohodlně prohlédnout ani pokračovat v grafickém rozhraní. Funkce ocení vývojáři, kteří střídají prostředí — například zahájí práci v terminálu na serveru nebo v CI smyčce a chtějí ji přezkoumat a rozvinout v aplikaci s plnohodnotným editorem.

[Dokumentace: Desktop — příchod z CLI](https://code.claude.com/docs/en/desktop#coming-from-the-cli)

---

### Claudem navržené hlášení chyb nástrojem SendFeedback (CLI)

Pokud nástroj opakovaně selhává, Claude nemůže s požadavkem pomoci, nebo uživatel upozorní na chybu, Claude nyní sám sestaví návrh hlášení prostřednictvím nástroje SendFeedback. Návrh se zobrazí jako karta nad promptem — uživatel jej může odeslat, upravit nebo zahodit. K Anthropicu nic neodesílá automaticky; odeslání vyžaduje explicitní potvrzení. Funkce vyžaduje verzi v2.1.238 nebo novější.

Jde o posun v ergonomii hlášení problémů. Hlášení chyb bývá nejslabší v okamžiku, kdy uživatel frustrovaný selháním zavře okno a k reportu se nedostane. Tím, že Claude sestrojí kontext sám ve chvíli selhání, klesá tření natolik, že zpětná vazba vzniká přirozeně. Pro Anthropic to zároveň znamená strukturovanější a kontextově bohatší vstupy než volný text.

[Dokumentace: Tools reference — chování nástroje SendFeedback](https://code.claude.com/docs/en/tools-reference#sendfeedback-tool-behavior)

---

## Drobnosti

- Nastavení [`modelPicker`](https://code.claude.com/docs/en/settings-reference#modelpicker) umožňuje rozšířit nebo nahradit vestavěný seznam příkazu `/model` vlastními pojmenovanými záznamy, včetně ID modelů z Amazon Bedrock nebo Google Cloud Agent Platform.
- [`promptCacheTtl`](https://code.claude.com/docs/en/prompt-caching#choose-the-ttl-yourself) nastavené na `1h` udržuje hodinovou prompt cache hlavní konverzace při použití API klíče nebo cloudového poskytovatele; `subagentPromptCacheTtl` nastavuje TTL pro subagenty a ostatní požadavky mimo hlavní konverzaci.
- Na plánech Pro, Max, Team a Enterprise přidává [`/usage`](https://code.claude.com/docs/en/costs#plan-usage-breakdown) přehled Loops: počet spuštění, celkové tokeny, tokeny na spuštění a čas posledního běhu pro `/loop` a naplánované úlohy s nejvyšší spotřebou.
- Organizace se smluvními sazbami mohou nastavením [`modelPricing`](https://code.claude.com/docs/en/costs#report-spend-at-your-contracted-rates) zajistit, aby `/usage`, stavový řádek i OpenTelemetry vykazovaly náklady podle jejich sazeb místo ceníkové ceny.
- `/login` nově nabízí přihlášení přes Console účet, takže členové Console organizací, které neumožňují API klíče, se mohou přihlásit bez jejich vytváření.
- Příkaz `/permissions` zpřístupňuje novou záložku [Auto mode](https://code.claude.com/docs/en/auto-mode-config#edit-rules-from-permissions), kde lze pravidla klasifikátoru auto mode prohlížet a upravovat bez otevírání souboru nastavení.
- Výzvy k oprávnění Bash v režimech Manual a acceptEdits nově nabízejí volbu [„Ano, a přepnout do auto mode"](https://code.claude.com/docs/en/permission-modes#switch-permission-modes), která příkaz schválí a zároveň relaci přepne do auto mode.
- Po přesunu relace příkazem [`/cd`](https://code.claude.com/docs/en/permissions#move-the-session-to-another-directory) se nastavení projektu, hooks, `.mcp.json` servery, skills a subagenti nového adresáře projeví okamžitě, nikoli až při příštím `--resume`.
- V neinteraktivních relacích (běhy `-p`, Agent SDK, cloudové relace) Claude Code [dokončí odpověď](https://code.claude.com/docs/en/errors#the-response-above-may-be-incomplete) přerušenou chybou serveru, výpadkem spojení nebo stálí, pokud přijatá část obsahuje text a žádná volání nástrojů.
- Subagent, který dosáhne limitu `maxTurns`, vrátí výstup označený jako neúplný s nápovědou, že [Claude jej může nechat pokračovat přes SendMessage](https://code.claude.com/docs/en/sub-agents#resume-subagents), místo aby se zobrazoval jako dokončený.
- Na Amazon Bedrock, Google Cloud Agent Platform a Microsoft Foundry si relace na stejném stroji nově [mohou posílat zprávy](https://code.claude.com/docs/en/cross-session-messaging#availability), `/loop` [může sám zvolit interval](https://code.claude.com/docs/en/scheduled-tasks#let-claude-choose-the-interval) a `/model` i `/effort` se projeví okamžitě, nikoli až po dokončení otočky.
- Nativní instalátor a auto-updater stahují build komprimovaný zstd — přibližně 75 MB místo 340 MB na Linux x64; nativní buildy načítají kód na vyžádání a používají zhruba o 40–70 MB méně paměti na relaci.

---

## Závěr

35. týden byl věcný a technicky vyspělý. Restricted mode je nejdůležitější změnou pro týmy provozující Claude Code v automatizovaných nebo sdílených prostředích — přidává jasně pojmenovanou, auditovatelnou hranici tam, kde dřív bylo potřeba improvizovat. Pokračování CLI relací v desktopové aplikaci ocení vývojáři pohybující se mezi terminálem a grafickým rozhraním, a funkce SendFeedback je nenápadná, ale promyšlená: vzniká ve chvíli frustrace, kdy je zpětná vazba nejcennější. Pod těmito třemi tématy leží solidní vrstva vylepšení spolehlivosti neinteraktivních běhů, konfigurovatelnosti modelů a výkonu instalátoru — dohromady signál, že Claude Code dozrává jako nástroj pro produkční nasazení.
