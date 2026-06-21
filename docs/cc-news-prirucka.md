# Novinky v Claude Code — příručka

Kompletní dokumentace služby „**Novinky v Claude Code**" pro kurzy.vibecoding.cz
z pohledu lidí (admin, platící uživatel) i provozu. Technický popis kódu a
datového modelu je v [`cc-news.md`](./cc-news.md); ukázkový článek a způsob
generování v [`cc-news-samples/`](./cc-news-samples/).

> **Co to je:** newsletter pro platící uživatele. Z nového týdenního záznamu na
> changelogu Claude Code (`code.claude.com/docs/en/whats-new`) vznikne redakčně
> zpracovaný český přehled, uloží se jako koncept, pošle ke schválení člověku, a
> po schválení se publikuje v gated sekci „Novinky v CC" a rozešle platícím
> uživatelům (s možností odhlášení) + s odkazy na nové CC články z vibecoding.cz.

---

## 1. Tok od změny changelogu k publikaci

```
[cron 03:00] detekce nového whats-new digestu (idempotentní)
      │
      ▼
[fronta] stáhne .md detail → redakční editor (kostra + LLM do češtiny)
      │
      ▼
[koncept] uloží draft + PŘIPRAVÍ schvalovací e-mail adminovi   ← automatika KONČÍ
      │
      ▼  (čeká na lidský klik)
[admin] klikne „Schválit a publikovat" v e-mailu (HMAC link)
      │
      ▼
[publikace] článek v gated sekci /novinky-cc  +  připraví rozeslání
      │
      ▼
[newsletter] rozeslání platícím (dry-run) + odkazy na CC články + odhlášení
```

**Klíčový princip:** automatika vyrobí koncept, ale **nic nepublikuje ani
nerozesílá sama**. Publikace nastává výhradně lidským kliknutím na schvalovací
odkaz (mantinel kontraktu).

---

## 2. Pohled administrátora (Patrick)

### Schvalovací e-mail
Po detekci nového digestu se připraví e-mail (ve fázi 1 dry-run — viz §5):
- Předmět: „Ke schválení: Novinky v Claude Code — Week N".
- Tlačítko **„Schválit a publikovat"** → podepsaný **jednorázový** odkaz.
- Odkaz **„Otevřít koncept k editaci"** → admin náhled konceptu.
- Odesílatel: Andrea Maloveczká `andrea@vibecoding.cz`.

### Náhled konceptu
`GET /internal/cc-news/draft/:id` — **jen pro přihlášeného admina.** Zobrazí
vyrenderovaný český článek **před** publikací se žlutým upozorněním „Koncept
(zatím nepublikováno)". Skutečné úpravy textu se dělají na GitHubu (článek je
`.md` soubor v repu); po úpravě a re-schválení se promítnou.

### Schválení a publikace
`GET /internal/cc-news/approve?token=…` — lidský klik z e-mailu. Bezpečnost nese
**podepsaný HMAC token** v odkazu (ne service secret). Ověří se podpis +
jednorázovost (nonce) → článek se publikuje (koncept → živá verze) a stránka
potvrdí „Článek byl publikován". Druhý klik na stejný odkaz už neprojde (HTTP
409). Odkaz platí 7 dní.

### Re-edit už publikovaného týdne
Když se u zdroje změní obsah týdne, který je **už publikovaný**, živá verze
**nezmizí** — čtenáři dál vidí dříve schválenou verzi, nová verze čeká na další
schválení (`pendingContentHash`). Žádná tichá depublikace.

---

## 3. Pohled platícího uživatele

### Gated sekce „Novinky v CC"
`GET /novinky-cc` — **jen přihlášený uživatel s aktivním přístupem.**
- Nepřihlášený → přesměrování na `/login`.
- Přihlášený bez přístupu → přesměrování na ceník (`/#cenik`).
- Admin má přístup vždy.

Uživatel vidí **přehled publikovaných** článků (od nejnovějšího) s prokliky.

### Detail článku
`GET /novinky-cc/:slug` — vyrenderovaný český článek (perex, velké změny,
drobnosti, odkazy na dokumentaci). YAML hlavička se čtenáři **nezobrazuje**.
Stránka má `noindex` (gated obsah se neindexuje).

### Newsletter
Po publikaci se rozešle platícím (ve fázi 1 dry-run — viz §5). Cílová množina:
- aktivní platící (`purchase` se `status=active`, neexpirované, `kind` paid/manual),
- ověření uživatelé na aktivní firemní (org) doméně,
- **mínus** comp/staff granty, neověřené a nevalidní adresy,
- **mínus** odhlášení (suppression).

Newsletter obsahuje i **odkazy na nové CC články** z rubriky Claude Code na
vibecoding.cz.

### Odhlášení (GDPR)
`GET /novinky-cc/unsubscribe?token=…` — každý newsletter nese odhlašovací odkaz.
Klik zapíše uživatele do suppression (ukládá se **jen hash e-mailu**, nikdy
plain adresa) a newsletter mu přestane chodit. Odhlášení přežije i případný GDPR
výmaz účtu.

---

## 4. Adresy (routy) přehledně

| Routa | Kdo | Co |
|-------|-----|-----|
| `GET /novinky-cc` | přihlášený s přístupem | přehled publikovaných článků |
| `GET /novinky-cc/:slug` | přihlášený s přístupem | detail článku |
| `GET /novinky-cc/unsubscribe?token=` | kdokoli s platným tokenem | odhlášení z newsletteru |
| `GET /internal/cc-news/approve?token=` | admin (klik z e-mailu) | schválení + publikace |
| `GET /internal/cc-news/draft/:id` | přihlášený admin | náhled konceptu |

---

## 5. Fáze 1 vs. produkce

Celá pipeline je ve **fázi 1**: kompletně hotová jako PR, **bez produkčního
nasazení a bez reálného odesílání e-mailů**. Všechny e-mailové a rozesílací cesty
běží v **dry-run** režimu (výchozí).

| Akce | Fáze 1 (PR) | Produkce (po nasazení) |
|------|-------------|------------------------|
| Schvalovací e-mail | neodesílá se (dry-run log + příprava) | dorazí adminovi |
| Rozeslání newsletteru | neodesílá se (spočítá počet + maskovaný vzorek) | jde platícím |
| Publikace v gated sekci | funguje (po kliknutí approve) | funguje |
| `/novinky-cc` | funguje | funguje |

Reálné odeslání e-mailů a produkční nasazení jsou za mantinelem — vyžadují
samostatné lidské schválení (eskalaci), nejsou součástí fáze 1.

### Provozní přepínače
- `CC_NEWS_DRY_RUN` — výchozí dry-run; `"0"` by povolil live odeslání (ve fázi 1
  **zakázáno** — kód odmítne před jakoukoli prací).
- `CC_NEWS_LLM` — `"1"` zapne LLM redakční vrstvu (jinak deterministická kostra).
- `OPENROUTER_API_KEY` — klíč LLM (OpenRouter). V `.dev.vars` lokálně, v
  Cloudflare Secrets za běhu.
- `CC_NEWS_LLM_MODEL` — override modelu (default `anthropic/claude-sonnet-4.6`).

---

## 6. Bezpečnost a soukromí

- **Schvalovací i odhlašovací odkazy** jsou podepsané HMAC-SHA256 s doménovou
  separací (token jedné akce nelze použít na jinou). Schvalovací je navíc
  jednorázový (nonce).
- **Gating** přes `hasAccess()` — publikovaný obsah jen pro platící/přihlášené.
- **GDPR:** suppression tabulka drží jen hash e-mailu, žádné plain PII; odhlášení
  je povinné a přežije výmaz uživatele. Dry-run rozeslání loguje jen počty a
  maskované adresy.
- **Žádný nový placený poskytovatel mimo schválený OpenRouter** (LLM vrstva).

---

## 7. Sample článek

Ukázka českého výstupu pipeline z reálného whats-new digestu je v
[`cc-news-samples/`](./cc-news-samples/) — viz tamní `README` (jak vzniká,
reprodukce přes OpenRouter).

---

## 8. Testy

`npm test` (Vitest + miniflare). Pokrytí: detekce/idempotence (R1), editor a
struktura (R2), schvalování + jednorázovost (R3/R4), gating (R5), cílová množina
+ dry-run + suppression + odhlášení (R6), odkazy na CC články (R7).
