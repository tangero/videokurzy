# Novinky: více nástrojů (návrh)

Stav k 17. 10. 2026. Návrh, jak sledovat kromě Claude Code i Codex, Grok Build
a Muse Code (zatím interně, ne do newsletteru). Zapracovaná oponentura z téhož dne.

## Co už máme

Pipeline Claude Code je graf napsaný v kódu: sběr (kód) → třídění (Haiku) →
výběr (Sonnet) → kontrola faktů (Haiku) → psaní (Sonnet) → kontroly v kódu →
lidské schválení → publikace. Stav je v D1 a KV, spouští cron a fronta.
Přepis do grafového frameworku nic nepřinese. Přidáváme jen uzly, které dnes chybí.

Od 17. 10. se ověřený výběr týdne ukládá (`cc-news:selection:<itemId>`) a psaní
běží nad ním (`writeWeeklyArticle` + jazyková varianta). To je první hrana, která
je uložený artefakt místo živého předání: anglický přehled (`english.ts`) píše
z téhož výběru bez nového výběru.

## Principy

- **Deterministická práce zůstává kódem:** sběr, normalizace, ID, týdny, kontroly
  verzí a odkazů, idempotence, zámky, DLQ.
- **Uzel není fronta.** Sběrač na každý zdroj je samostatný uzel s vlastním stavem
  a stropem, ale všechny běží v jednom denním cronu. Frontu na zdroj zavedeme, až
  jeden zdroj začne ostatní zdržovat.
- **Uzly mají různé kadence.** Hrana mezi nimi je uložený artefakt. Analytik trendů
  počítá jednou za týden nebo měsíc a výběr do vydání jeho výstup jen čte. Když
  analýza selže, článek vyjde bez trendů.
- **Schéma hrany musí unést nejslabší zdroj.** Verze je volitelná, týden se pak
  určí z data.

## Krok 0: ověřit formát každého zdroje

Před implementací sběrače u každého nástroje zjistit:

| Nástroj | Odkud | Formát | Verze | Datum |
|---|---|---|---|---|
| Claude Code | CHANGELOG.md + stránka changelogu v docs | markdown | ano | z docs |
| Codex | ověřit (GitHub releases / CHANGELOG `openai/codex`) | ? | ? | ? |
| Grok Build | ověřit | ? | ? | ? |
| Muse Code | ověřit | ? | ? | ? |

Datum je povinné. Položka bez data se nezařadí do týdne a v revizi se ukáže jako
„bez data“. Datum neodhadujeme.

## Data

Aditivní migrace: `cc_change_item` → obecná `tool_change_item` se sloupcem `tool`
(stávající řádky `claude-code`). Do přechodu může zůstat pohled se starým názvem.

Hrana sběrač → normalizátor:

```
{ tool, sourceUrl, version?, publishedAt, text, scope?, type, hash }
```

- `id = <tool>:<version|datum>#<sha8(text)>`: stabilní vůči vsunutým řádkům.
- Týden = ISO týden `publishedAt` (UTC). U zdrojů s verzemi navíc rozsah verzí
  navazující na poslední vydání, jako dnes.

Taxonomie témat zůstává jedna pro všechny nástroje, jinak nepůjde srovnávat.
Témata specifická pro nástroj jdou do `other` a rozšíření seznamu je vědomé
rozhodnutí.

## Uzly

```
[sběrač CC] [sběrač Codex] [sběrač Grok] [sběrač Muse]   kód, denní cron
        └─────────┴────┬─────┴────────┘
                 [normalizátor]                          kód
                       ▼
                 [klasifikátor]                          Haiku, po dávkách
                       ▼
         tool_change_item (D1) ──────────► [analytik trendů]   vlastní kadence
                       │                         ▼
                       │                  trends:<období> (KV)
                       ▼                         │
              [výběr do vydání] ◄────────────────┘  jen čte, volitelné
                       ▼
               selection:<id> (KV)
                 ▼            ▼
          [autor CZ]      [autor EN]                     Sonnet
                 ▼            ▼
   [ověřovatel faktů, jiný výrobce] + [kontroly v kódu]
                 ▼
          [lidská brána] → publikace / PR do webu
```

## Analytik trendů

- Vstup: `tool_change_item` za delší období (např. 8 týdnů), všechny nástroje.
- Výstup do KV:
  `{ trendy: [{ téma, nástroje[], směr, období, důkazy: [id položek] }] }`.
- `důkazy` jsou povinné: každé tvrzení o trendu ukazuje na konkrétní položky.
  Kontrola v kódu ověří, že ID existují a patří k uvedeným nástrojům a období.
  Ověřovatel faktů pak kontroluje souhrnné tvrzení proti důkazům.

## Invarianty (kontroly v kódu)

1. **Žádný zdroj se neztratil:** počet zpracovaných položek za týden = počet
   sebraných, po nástrojích. Sběrač, který v týdnu nic nepřinesl, se uvede jako
   „bez změn“. Sběrač, který selhal, je chyba, ne prázdný týden.
2. Každé tvrzení o trendu ukazuje na existující položky napříč uvedenými nástroji.
3. Stávající: verze jen z citovaných položek, odkazy jen na existující stránky
   dokumentace daného nástroje, žádný em dash.

## Nezávislost ověřovatele

Ověřovatel faktů má běžet u jiného výrobce než autor. Na OpenRouteru je to jedna
proměnná (`CC_NEWS_CLASSIFY_MODEL` dnes sdílí třídění i kontrolu faktů, pro
kontrolu zavést vlastní `CC_NEWS_VERIFY_MODEL`). Vyplatí se i pro současný
newsletter.

## Otevřená rozhodnutí

- Které zdroje mají veřejný strojově čitelný changelog (krok 0).
- Kadence analytika: týdně, nebo měsíčně.
- Model ověřovatele (výrobce, cena).
- Jestli interní přehled dalších nástrojů bude stránka v adminu, nebo e-mail.
