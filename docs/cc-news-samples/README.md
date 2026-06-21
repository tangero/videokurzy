# Sample článek „Novinky v Claude Code" (R8)

`2026-w23-w24-sample.md` je ukázkový redakční článek za týdny 23–24 (verze
v2.1.158–v2.1.176), připravený k lidskému publikačnímu posouzení (R8).

## Co tento sample dokládá

Sample je **český redakční výstup** dle `redakcni-pravidla.md` — tedy výstup
**LLM vrstvy** editoru (`renderArticle` s `CC_NEWS_LLM=1`), schválené architektem
jako varianta C (deterministická kostra + LLM). Dokládá kompletní redakční
zpracování:

- `#` nadpis → YAML front matter (`author`, `categories`, `layout`, `title`,
  `post_excerpt`, `summary_points`);
- věcný **rámující perex** bez disclaimeru o changelogu, se seřazením podle váhy;
- bodový přehled velkých změn, u každé **číslo verze v závorce**;
- velké změny jako **souvislé odstavce** (ne odrážky), řazené dle váhy —
  bezpečnostní a provozní hardening i rozšíření schopností (vnořené subagenty)
  nahoře, kosmetika dole — každá s **odkazem na konkrétní sekci dokumentace**;
- drobnosti na konci jako **odrážky**, každá na jeden řádek;
- spisovná čeština, vykání, pomlčky s mezerami, „subagenti" jako životné, české
  výrazy s ponecháním zavedených termínů (prompt cache, hooks, MCP, auto mode,
  safe mode, …);
- rámující **interpretační věty** na začátku a konci, oddělené od faktického výčtu.

## Jak vzniká

1. **Detekce** stáhne týdenní `.md` digest z `code.claude.com/docs/en/whats-new`.
2. **Editor** (`parseDigest`) naparsuje fakta na strukturovaný model a
   deterministicky sestaví kostru — to je technický mezikrok, který drží
   strukturu a zabraňuje halucinaci faktů.
3. **LLM vrstva** (`renderArticle`, `CC_NEWS_LLM=1`) převede kostru do plné
   spisovné češtiny podle jazykových pravidel přes **OpenRouter**
   (`OPENROUTER_API_KEY`, model `anthropic/claude-sonnet-4.6`). LLM se drží
   naparsovaných faktů.

Tento sample je výstup kroku 3 — finální článek, jaký pipeline produkuje a jaký
jde Patrickovi ke schválení.

## Reprodukce přes pipeline

V běhu zpracuje pipeline automaticky: cron detekuje nový digest → fronta
`cc-news.detected` → `processCcNewsItem` (`lib/cc-news/pipeline.ts`) zavolá editor
s LLM a uloží draft + připraví schvalovací e-mail (dry-run). Ručně:

```bash
# z kořene repo videokurzy (s nastaveným OPENROUTER_API_KEY)
node --input-type=module -e '
import { renderArticle } from "./src/lib/cc-news/editor.ts";
import { readFileSync } from "fs";
const md = readFileSync("/tmp/digest.md","utf8"); // stažený …/<rok>-wNN.md
const { markdown } = await renderArticle(md, { CC_NEWS_LLM: "1", OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY });
console.log(markdown);
'
```
