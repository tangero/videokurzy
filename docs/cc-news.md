# Služba „Novinky v Claude Code"

Newsletter pro platící uživatele kurzy.vibecoding.cz. Z položek skutečného
`anthropics/claude-code/CHANGELOG.md`, dat verzí a změn dokumentace vzniká vlastní
redakčně zpracovaný přehled, který se publikuje v gated sekci a rozešle platícím
uživatelům.

> **Automatické vydávání (od 18. 10. 2026, rozhodnutí Patricka): lidské schválení
> před publikací se NEvyžaduje.** S přepínačem `cc_news_autopublish` (výchozí
> zapnuto, `/admin/settings`) se týdenní článek ze changelogu po napsání sám
> publikuje a autor ho upravuje zpětně (admin → Newsletter). Místo e-mailu „Ke
> schválení“ přijde oznámení „Vydáno“ s odkazy na úpravy a nálezy kontrol v kódu.
> Anglické přehledy (Claude Code i Grok Build) se samy sloučí na vibecoding.cz/en,
> jakmile projde build webu (fronta `cc-news.en-merge`); upravují se v Keystatic.
> Newsletter předplatitelům se rozesílá **ručně** tlačítkem v adminu. Po vypnutí
> přepínače platí původní tok se schvalovacím odkazem popsaný níže.

> **Novinky osobních asistentů (od 25. 10. 2026):** Grok Bot (`TOOLS[].kind = "assistant"`)
> nemá anglickou řadu ani výběr Novinek v CC. Z changelogu týdne (přes Exa, `src/lib/tools/grok-bot.ts`)
> vzniká český zápis do webu `/novinky/<tool>/<rok>-w<NN>/` (`src/lib/tools/assistant-cs.ts`, fronta
> `tools.assistant-week`). Model píše body s citacemi ID položek; kód hlídá citace, oddíl podle typu
> položky, pokrytí všech položek a povolené oblasti (`ASSISTANT_AREAS`, musí sedět s
> `ASSISTANTS[<tool>].areas` webu), model ověří fakta (jedna opravná iterace, neověřený bod vypadne a je
> vidět v PR). Z ověřených bodů pak model napíše redakční článek ve stylu Novinek v CC (`ARTICLE_SYSTEM_CS`,
> od 26. 10. 2026 tělo souboru místo seznamu bodů); kód z něj odstraní h1, em dash, poznámky editoru a odkazy
> mimo changelog, chybné verze hlásí v PR a poznámku o zdrojích doplní sám. Obecný popis asistenta do článku
> nepatří, je v pevné hlavičce stránky (`ASSISTANTS[<tool>].about` webu). `summary` a `highlights`
> ve frontmatteru zůstávají z ověřených bodů. Starý formát uložený v KV se napíše znovu (`MD_FORMAT`);
> vydaný zápis přepíše jen PR s `force` (zaškrtávátko v adminu). Cron zařadí uzavřený týden od úterka 03:00 UTC (pokryje nedělní vydání v americkém čase),
> týden bez položek nic nezapisuje. PR se při automatickém vydávání sloučí po buildu webu
> (`cc-news.en-merge`, itemId `assistant-<tool>-<rok>-wNN`). Ručně: `/admin/tools/grok-bot` (synchronizace,
> náhled nanečisto, PR, zpětné doplnění týdnů od verze 0.68.0).

> Periodické skenování historických `whats-new` digestů je od 24. 10. 2026
> vypnuté. Jejich publikované články zůstávají zachované, ale cron už z jejich
> re-editací nevyrábí schvalovací e-maily.

> Odesílání e-mailů má dvě brány (`CC_NEWS_DRY_RUN=0` + `cc_news_live_send`);
> bez nich běží v **dry-run** režimu.

## Pipeline (6 kroků)

| # | Krok | Modul | Požadavek |
|---|------|-------|-----------|
| 1 | **Synchronizace** `CHANGELOG.md` a dat verzí (idempotentní) | `lib/cc-news/changelog-source.ts`, `classify.ts`, `changelog-week.ts` (cron v `scheduled.ts`) | R1 |
| 2 | **Výběr a redakční zpracování** včetně kontroly faktů | `lib/cc-news/weekly.ts` | R2 |
| 3 | **Uložení konceptu** + automatické vydání (`autoPublishDraft`), nebo schvalovací e-mail při vypnutém přepínači | `lib/cc-news/draft.ts`, `lib/email.ts` | R3, R4 |
| 4 | **Publikace** v gated sekci (automaticky, nebo po schválení) | `lib/cc-news/draft.ts`, `routes/cc-news.tsx` (`approveItem`) | R4, R5 |
| 5 | **Ruční rozeslání** z adminu + **odhlášení** (GDPR) | `lib/cc-news/newsletter.ts` | R6 |
| 6 | **Odkazy na nové CC články** z vibecoding.cz | `parseCcArticleLinks` v `newsletter.ts` | R7 |

## Datový model (D1)

- **`cc_news_item`** (migrace `0025`, `0027`) — jedno týdenní vydání.
  Idempotence stojí na `UNIQUE(sourceId)`, pro aktuální pipeline např.
  `/changelog/2026-w42`; historické záznamy mají `/docs/en/whats-new/2026-w37`.
  `status`: `draft → published`. `approveNonce` = jednorázovost schválení.
  `pendingContentHash` — když se re-edituje **už publikovaný** historický digest,
  živá verze zůstává viditelná a nový obsah čeká na lidské schválení. Žádné PII.
  - **KV oddělení obsahu:** `cc-news:draft:{id}` drží rozpracovaný koncept
    (přepisuje se re-editem), `cc-news:published:{id}` drží živou publikovanou
    verzi (čte gated detail). `approveItem` při schválení promotuje draft →
    published.
- **`newsletter_suppression`** (migrace `0026`) — GDPR opt-out. Klíč `emailHash`
  = HMAC-SHA256(normalizovaný e-mail, účel `claude_code_news`). **Žádné plain
  PII**; samostatná tabulka, aby suppression přežil GDPR výmaz uživatele.

## Synchronizace a založení vydání

Cron stáhne `CHANGELOG.md` z GitHubu a datum vydání každé verze z dokumentace.
`parseReleaseDates` čte původní `<Update>` značky i nový Markdown s tučnou verzí
a datem na samostatném řádku. Chybí-li datum některé verze v synchronizačním
okně, `fetchChangelog` selže s poplachem a vydání se nezaloží z neúplných dat.

Položky se idempotentně ukládají do `cc_change_item` a zařazují k dotřídění.
Po uzavření týdne `createChangelogWeekItem` založí `/changelog/<rok>-w<týden>`
a zařadí zprávu `cc-news.detected` (`WEBHOOK_QUEUE`). Konzument fronty
(`handleCcNewsDetected` → `processCcNewsItem`) sestaví článek v `weekly.ts` z
changelogu a snímků dokumentace, uloží koncept a podle přepínače ho publikuje
nebo připraví ke schválení.

## Redakční zpracování (R2)

Aktuální pipeline v `weekly.ts` vybere hlavní novinky a drobnosti, kontroluje
povinné zařazení zásadních změn, ověřuje tvrzení proti citovaným položkám a teprve
potom vytváří český článek přes OpenRouter. Deterministické kontroly hlídají čísla
verzí a odkazy na existující dokumentaci.

Historické `whats-new` digesty zpracovává původní `editor.ts`: deterministická
kostra (`parseDigest` + `renderArticleSkeleton`) a volitelný LLM přepis
(`renderArticle`, `CC_NEWS_LLM=1`). Tato větev slouží už jen pro archivní obsah a
explicitní ruční akce, ne pro periodickou tvorbu nových vydání.

## Schvalování (R4) a publikace (R5)

Platí jen při vypnutém automatickém vydávání (`cc_news_autopublish=false`) a pro
nový koncept už vydaného článku (ten se automaticky nepřepíše).

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

## Odeslání e-mailů přes Resend — dvě brány

Reálné odeslání (schvalovací e-mail adminovi i rozeslání newsletteru) běží přes
sdílený `lib/email.ts` → `sendEmail()` (Resend API), stejný kanál jako ostatní
transakční e-maily. Aby k němu došlo, musí platit **obě** brány současně:

1. **Provozní přepínač** `CC_NEWS_DRY_RUN="0"` (env / secret),
2. **Admin přepínač** `cc_news_live_send="true"` v `site_config` — nastavitelný
   v `/admin/settings` („Novinky v Claude Code — odesílání e-mailů").

Vyhodnocuje to `isCcNewsLiveSend(db, env)` v `lib/cc-news/settings.ts`, které
navíc vyžaduje neprázdný `RESEND_API_KEY` (bez něj by Resend dostal prázdný
Bearer a tiše selhal — radši zůstat v dry-run). Dokud kterákoli podmínka chybí,
běží **dry-run** (e-maily se jen logují, NEodejdou). Dvě nezávislé brány =
produkce nejde zapnout omylem jediným přepnutím (mantinel fáze 1). Obě odesílací
cesty (`prepareDraftAndApproval` i `sendNewsletter`) volají `isCcNewsLiveSend`
**uvnitř** — bránu nelze obejít argumentem volajícího.

Selhání reálného odeslání se **eskaluje výjimkou** (queue retry), ne tiše: u
schvalovacího e-mailu by jinak novinka uvízla nepublikovaná. Rozeslání
newsletteru izoluje selhání per-příjemce (jeden pád neshodí celou dávku) a
odesílá po dávkách (`SEND_CONCURRENCY`), ne striktně sériově.

## Odběr na profilu (opt-in / opt-out)

Na `/profile` má přihlášený uživatel přepínač „Novinky v Claude Code" (default
**zapnuto** = přijímat). `POST /api/profile/cc-news` `{subscribed}` zapíše/smaže
suppression nad **všemi adresami účtu** (`userNewsletterEmails`: `user.email` +
fakturační `purchase.email` z aktivních nákupů) — `buildRecipientSet` totiž cílí
i na `purchase.email`, takže opt-out jen nad primární adresou by doručovanou
nákupní adresu minul. Opt-out → `unsubscribeUserAll` (suppression řádky, jen
`emailHash`), opt-in → `resubscribeUserAll` (řádky se **smažou**). Stav přes
`isUserSuppressed` (účet je odhlášen, je-li odhlášená kterákoli jeho adresa;
anti-join přes `emailHash`, žádné plain PII). Odhlášení přes e-mailový link
(`/novinky-cc/unsubscribe`) i přes profil zapisují do téže suppression tabulky.

## Provozní přepínače

- `CC_NEWS_DRY_RUN` — výchozí dry-run; `"0"` je **první brána** live odeslání
  (druhá je admin přepínač `cc_news_live_send`, viz výše).
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
