# Služba „Novinky v Claude Code"

Newsletter pro platící uživatele kurzy.vibecoding.cz. Z nového týdenního záznamu
na changelogu Claude Code (`code.claude.com/docs/en/whats-new`) vznikne redakčně
zpracovaný přehled, uloží se jako koncept, pošle ke schválení člověku, po
schválení se publikuje v gated sekci a rozešle platícím uživatelům.

> **Stav: fáze 1 — kompletní pipeline jako PR, bez produkčního nasazení a bez
> reálného odesílání e-mailů.** Všechny e-mailové a rozesílací cesty běží v
> **dry-run** režimu (výchozí). Publikace nastává jen po explicitním lidském
> kliknutí na schvalovací link.

## Pipeline (6 kroků)

| # | Krok | Modul | Požadavek |
|---|------|-------|-----------|
| 1 | **Detekce** nového whats-new záznamu (idempotentní) | `lib/cc-news/detect.ts` (cron v `scheduled.ts`) | R1 |
| 2 | **Redakční zpracování** dle `redakcni-pravidla.md` | `lib/cc-news/editor.ts` | R2 |
| 3 | **Uložení konceptu + schvalovací e-mail** (dry-run) | `lib/cc-news/draft.ts`, `lib/email.ts` | R3, R4 |
| 4 | **Publikace** v gated sekci po schválení | `routes/cc-news.tsx` (`approveItem`) | R4, R5 |
| 5 | **Rozeslání** (dry-run) + **odhlášení** (GDPR) | `lib/cc-news/newsletter.ts` | R6 |
| 6 | **Odkazy na nové CC články** z vibecoding.cz | `parseCcArticleLinks` v `newsletter.ts` | R7 |

## Datový model (D1)

- **`cc_news_item`** (migrace `0025`, `0027`) — jeden whats-new digest.
  Idempotence detekce stojí na `UNIQUE(sourceId)` (= canonical URL detailu, např.
  `/docs/en/whats-new/2026-w24`). `contentHash` (SHA-256) zachytí re-edit téhož
  týdne. `status`: `draft → published`. `approveNonce` = jednorázovost schválení.
  `pendingContentHash` — když se re-edituje **už publikovaný** týden, živá verze
  zůstává viditelná (nedepublikuje se) a nový obsah čeká ve `pendingContentHash`
  na lidské schválení. Žádné PII.
  - **KV oddělení obsahu:** `cc-news:draft:{id}` drží rozpracovaný koncept
    (přepisuje se re-editem), `cc-news:published:{id}` drží živou publikovanou
    verzi (čte gated detail). `approveItem` při schválení promotuje draft →
    published.
- **`newsletter_suppression`** (migrace `0026`) — GDPR opt-out. Klíč `emailHash`
  = HMAC-SHA256(normalizovaný e-mail, účel `claude_code_news`). **Žádné plain
  PII**; samostatná tabulka, aby suppression přežil GDPR výmaz uživatele.

## Detekce (R1)

Strojový zdroj, ne HTML scraping: cron stáhne RSS `…/whats-new/rss.xml`, z první
položky vytáhne odkaz na týdenní digest **z `content:encoded`** (ne z `<link>`,
který míří na index s kotvou), normalizuje na `sourceId`, stáhne `.md` detail a
spočítá `contentHash`. Idempotence: anti-join proti `cc_news_item`. `guid` a
`pubDate` se na klíč nepoužívají (sousední týdny sdílejí `pubDate`). Nový/změněný
záznam se zařadí do fronty `cc-news.detected` (`WEBHOOK_QUEUE`).

Konzument fronty (`handleCcNewsDetected` v `queue.ts` → `processCcNewsItem` v
`lib/cc-news/pipeline.ts`) na zprávu navazuje **automaticky**: stáhne `.md`
detail, zavolá editor (krok 2), uloží draft a připraví schvalovací e-mail v
dry-run (kroky 3–4). Tím je detekce zřetězená s celou redakční pipeline.

## Redakční zpracování (R2, varianta C dle schválení architekta)

- **Deterministická vrstva** (`parseDigest` + `renderArticleSkeleton`): naparsuje
  digest na model a sestaví kostru dle `redakcni-pravidla.md` (nadpis, YAML
  frontmatter, perex bez changelog disclaimeru, bodový přehled s verzemi, velké
  změny řazené dle váhy jako odstavce s odkazem na dokumentaci, drobnosti jako
  odrážky). Plně testovatelné, bez sítě.
- **LLM vrstva** (`renderArticle`, flag `CC_NEWS_LLM=1`): převede kostru do plné
  češtiny dle jazykových pravidel přes **OpenRouter** (`OPENROUTER_API_KEY`, model
  `anthropic/claude-sonnet-4.6`, override `CC_NEWS_LLM_MODEL`). Bez flagu se vrací
  deterministická kostra. **Fakta se nehalucinují** — staví na naparsovaném modelu.

## Schvalování (R4) a publikace (R5)

`prepareDraftAndApproval` uloží markdown do KV, zapíše `approveNonce` na řádku a
vytvoří **podepsaný jednorázový** schvalovací link (HMAC-SHA256, doménová
separace `cc-news-approve:`, expirace 7 dní). Schvalovací e-mail se v **dry-run**
režimu jen sestaví a zaloguje, **neodesílá**.

Route `GET /internal/cc-news/approve?token=…` — lidský klik z e-mailu (NE za
internal secret, bezpečnost nese token). Ověří podpis + nonce z DB →
`status=published`, smaže nonce (druhý klik je odmítnut). Gated sekce
`GET /novinky-cc` a `/novinky-cc/:slug` je za `authMiddleware` + `hasAccess()`:
nepřihlášený → login, bez přístupu → ceník, admin bypass.

## Rozeslání (R6) a odhlášení (GDPR)

Cílová množina (`buildRecipientSet`): aktivní `paid`/`manual` purchase ∪ ověření
uživatelé aktivní org domény, **mínus** comp/staff/expired/neověření, **mínus**
suppression (anti-join přes `emailHash`), deduplikováno. `sendNewsletterDryRun`
**neodesílá** — loguje jen počet a maskovaný vzorek adres.

Odhlášení: podepsaný link s odděleným účelem `cc-news-unsub:`. Route
`GET /novinky-cc/unsubscribe?token=…` vloží suppression (jen `emailHash`).

## Odkazy na CC články (R7)

`parseCcArticleLinks` vybere z RSS feedu vibecoding.cz články rubriky Claude
Code. *Follow-up po MVP:* nahradit RSS parsing dedikovaným JSON API v
`vibecoding-site` (Astro route); newsletter pak jen přepne fetcher.

## Provozní přepínače

- `CC_NEWS_DRY_RUN` — výchozí dry-run; `"0"` by zapnul live odeslání, ale to je
  ve fázi 1 **zakázané** (kód vyhodí chybu — bod eskalace).
- `CC_NEWS_LLM` — `"1"` zapne LLM redakční vrstvu (jinak deterministická kostra).
- `OPENROUTER_API_KEY` — klíč pro LLM vrstvu (OpenRouter). V `.dev.vars` lokálně,
  v Cloudflare Secrets za běhu.
- `CC_NEWS_LLM_MODEL` — override modelu (default `anthropic/claude-sonnet-4.6`).

## Sample článek (R8)

Ukázka vygenerovaná z reálného aktuálního whats-new záznamu je v
`docs/cc-news-samples/` — viz tamní `README`.

## Testy

`npm test` (Vitest + miniflare). Pokrytí: detekce/idempotence (R1), editor a
struktura (R2), schvalování + jednorázovost (R3/R4), gating (R5), cílová množina
+ dry-run + suppression + odhlášení (R6), CC odkazy (R7).
