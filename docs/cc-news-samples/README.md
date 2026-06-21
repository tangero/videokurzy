# Sample článek „Novinky v Claude Code" (R8)

`2026-w24-sample.md` je ukázka vygenerovaná pipeline z **reálného aktuálního**
whats-new záznamu `https://code.claude.com/docs/en/whats-new/2026-w24.md`.

## Co tento sample dokládá

Sample je výstup **deterministické vrstvy** editoru (`renderArticleSkeleton`).
Dokládá strukturní část redakčních pravidel (R2), kterou lze ověřit bez LLM:

- `#` nadpis → YAML front matter (`author`, `categories`, `layout`, `title`,
  `post_excerpt`, `summary_points`);
- věcný perex **bez** disclaimeru o changelogu;
- bodový přehled velkých změn, u každé **číslo verze v závorce**;
- velké změny jako **odstavce** (ne odrážky), **řazené dle váhy** — bezpečnost
  (safe mode) nahoře, komfortní `/cd` dole — každá zakončená verzí a **odkazem na
  konkrétní sekci dokumentace**;
- drobnosti na konci jako **odrážky**, odkazy převedené na markdown.

## Jazyková redakce (LLM)

Fakta v této kostře jsou v původním (anglickém) znění. **Plný převod do spisovné
češtiny** dle jazykových pravidel (`redakcni-pravidla.md`) zajišťuje **LLM
vrstva** (`renderArticle` s `CC_NEWS_LLM=1`, Anthropic klíč v repu) — schváleno
architektem jako varianta C (deterministická kostra + LLM). LLM se drží
naparsovaných faktů a nehalucinuje.

Sample je záměrně deterministický, aby byl **reprodukovatelný** a šel ověřit v
testech; produkční článek projde navíc LLM jazykovou vrstvou.

## Reprodukce

```bash
# z kořene repo videokurzy
node --input-type=module -e '
import { parseDigest, renderArticleSkeleton } from "./src/lib/cc-news/editor.ts";
import { readFileSync } from "fs";
const md = readFileSync("/tmp/w24.md","utf8"); // stažený …/2026-w24.md
console.log(renderArticleSkeleton(parseDigest(md)));
'
```
