# PRD v2: Videokurz platforma — kurz.vibecoding.cz

> Verze 2.0 | 7. dubna 2026
> Tento dokument je kanonický zdroj pravdy pro AI coding agenty pracující na projektu.

---

## 1. Vize a kontext

### Co to je
Distribuční platforma pro placené videokurzy o vibe codingu. Subdoména kurz.vibecoding.cz, součást ekosystému vibecoding.cz. Zároveň technologické demo schopností vibe codingu — edge-first architektura bez JS frameworku.

### Proč to stavíme
Patrick Zandl je uznávaný autor a lektor v české tech komunitě. Má 6 000 odběratelů newsletteru a aktivní komunitu Vibe Coding CZ. Potřebuje platformu pro monetizaci videokurzů o Claude Code a vibe codingu, která:
- Slouží jako příjmový kanál (B2C + B2B)
- Demonstruje možnosti vibe codingu jako produkt sám o sobě
- Je provozně levná a jednoduchá na údržbu

### Success metriky (3 měsíce od launche)
| Metrika | Cíl |
|---------|-----|
| Platící B2C zákazníci | 50 |
| Platící B2B (firemní licence) | 10 |
| Celkový roční příjem | 250 000 Kč |
| Churn (neobnovení po roce) | < 30 % |

---

## 2. User Personas

### Persona 1: Marek — Projektový manažer (B2C primární)
- **Věk:** 35–45
- **Pozice:** Projektový manažer ve střední firmě
- **Technická úroveň:** Netechnický, ale zvídavý. Zvládne terminál, pokud má návod.
- **Motivace:** Chce automatizovat části své práce s AI. Slyšel o vibe codingu, chce si to vyzkoušet.
- **Jak se dozví:** Newsletter Patricka Zandla, Vibe Coding CZ komunita
- **Nákupní rozhodnutí:** Důvěřuje Patrickovi osobně. Chce český obsah, strukturovaného průvodce, nechce hledat roztříštěné anglické YouTube tutoriály.
- **Obava:** "Dám 2 000 Kč a nebude to pro mě srozumitelné."
- **Co ho přesvědčí:** Free preview (2 epizody), reference od lidí z kurzu, Patrickův životopis a reputace.

### Persona 2: Jana — HR / L&D manažerka (B2B)
- **Pozice:** Zodpovídá za vzdělávání zaměstnanců ve firmě (50–500 lidí)
- **Motivace:** Firma potřebuje začít s AI, hledá strukturované školení v češtině.
- **Jak se dozví:** Doporučení, LinkedIn, konference
- **Nákupní rozhodnutí:** Potřebuje fakturu v CZK, jednoduché nasazení (žádné IT požadavky), a obsah, který pokryje základy pro netechnické lidi.
- **Obava:** "Bude to dost srozumitelné pro naše PM a analytiky?"
- **Co ho přesvědčí:** Reference firem, ukázka obsahu, jednoduchost (jen firemní email stačí).

### Persona 3: Tomáš — Začínající vývojář (B2C sekundární)
- **Věk:** 20–30
- **Pozice:** Junior dev nebo student, který se učí programovat
- **Motivace:** Chce vědět, jak AI mění vývoj softwaru a jak to využít.
- **Jak se dozví:** Kontextová reklama, Vibe Coding CZ server
- **Nákupní rozhodnutí:** Cenově citlivý. Free preview musí ukázat jasnou hodnotu.

### Persona 4: Patrick — Admin
- **Jediný admin systému (se zástupem na email notifikace).**
- **Workflow:** Nahraje video na Bunny → vyplní metadata v admin GUI → publikuje. Schvaluje B2B domény, sleduje statistiky.
- **Potřebuje:** Jednoduché GUI, email notifikace při nové B2B objednávce.

---

## 3. User Stories (Gherkin)

### Epic 1: Návštěvník a free preview

```gherkin
Feature: Landing page
  Scenario: Návštěvník vidí obsah kurzu
    Given jsem nepřihlášený návštěvník
    When otevřu kurz.vibecoding.cz
    Then vidím hero sekci s názvem kurzu a popisem
    And vidím seznam modulů a epizod s označením "zdarma" u free epizod
    And vidím ceník (jednotlivec 2 000 Kč/rok, firma 15 000 Kč/rok)
    And vidím reference od účastníků kurzu
    And vidím Patrickův profil a bio
    And vidím CTA tlačítko "Koupit kurz"

  Scenario: Návštěvník sleduje free preview
    Given jsem nepřihlášený návštěvník
    When kliknu na epizodu označenou "zdarma"
    Then vidím video player s Bunny Stream embedem
    And nemusím se přihlašovat ani platit

  Scenario: Konverzní moment po free preview
    Given sleduji poslední free epizodu (ep. 2)
    When video skončí
    Then vidím výrazný CTA "Odemknout zbývajících 8 epizod za 2 000 Kč/rok"
    And dostanu email s nabídkou upgradu a instrukcemi k předplacení
```

### Epic 2: B2C nákup a přihlášení

```gherkin
Feature: B2C nákup
  Scenario: Úspěšný nákup
    Given jsem na landing page
    When kliknu "Koupit" (jednotlivec)
    Then jsem přesměrován na Stripe Checkout (CZK, roční subscription)
    When dokončím platbu
    Then vidím success page s textem "Zkontrolujte email"
    And na stránce je kontakt na support pro případ problémů
    And do 60 sekund dostanu email s magic linkem
    When kliknu na magic link
    Then jsem přihlášen a přesměrován na dashboard

  Scenario: Magic link nepřijde
    Given jsem dokončil platbu
    And jsem na success page
    When kliknu "Nepřišel mi email"
    Then vidím formulář pro opětovné odeslání magic linku
    And vidím kontakt na support (patrick@vibecoding.cz)

  Scenario: Opakované přihlášení
    Given jsem existující platící uživatel
    When otevřu /login a zadám svůj email
    Then do 60 sekund dostanu magic link
    When kliknu na magic link
    Then jsem přihlášen a přesměrován na dashboard
```

### Epic 3: B2B nákup

```gherkin
Feature: B2B firemní licence
  Scenario: Firma kupuje licenci
    Given jsem na landing page
    When kliknu "Koupit firemní licenci"
    Then jsem přesměrován na Stripe Checkout
    And vidím pole pro zadání emailové domény firmy (např. firma.cz)
    When dokončím platbu
    Then vidím success page
    And admin dostane email notifikaci o nové organizaci ke schválení

  Scenario: Admin schvaluje doménu
    Given mám roli admin
    And existuje organizace se status "pending"
    When otevřu /admin
    Then vidím organizaci v seznamu s tlačítkem "Schválit"
    When kliknu "Schválit"
    Then status organizace se změní na "active"
    And změna proběhne bez reloadu stránky (htmx)

  Scenario: Zaměstnanec firmy se přihlásí
    Given moje firma má aktivní doménovou licenci pro firma.cz
    When otevřu /login a zadám jan@firma.cz
    Then dostanu magic link
    When kliknu na magic link
    Then jsem přihlášen a mám přístup ke všem placeným epizodám
    And nemusím nic platit
```

### Epic 4: Sledování kurzu

```gherkin
Feature: Dashboard
  Scenario: Uživatel vidí přehled kurzů
    Given jsem přihlášený platící uživatel
    When otevřu /dashboard
    Then vidím seznam všech kurzů (modulů)
    And u každého kurzu vidím počet dokončených / celkových epizod

  Scenario: Uživatel rozklikne kurz
    Given jsem na dashboardu
    When kliknu na kurz
    Then vidím seznam epizod daného kurzu
    And u každé epizody vidím, zda jsem ji dokončil
    And vidím progress bar kurzu

Feature: Sledování epizody
  Scenario: Uživatel sleduje placenou epizodu
    Given jsem přihlášený platící uživatel
    When otevřu epizodu
    Then vidím video player s Bunny Stream embedem (signed URL, 4h expiry)
    And vidím navigaci předchozí/další v rámci modulu
    And vidím tlačítko "Označit jako dokončené"

  Scenario: Označení epizody jako dokončené
    Given sleduji epizodu
    When kliknu "Označit jako dokončené"
    Then tlačítko se změní na "Dokončeno ✓" bez reloadu stránky (htmx)
    And progress bar na dashboardu se aktualizuje

  Scenario: Poslední epizoda v modulu
    Given jsem na poslední epizodě modulu
    Then tlačítko "Další" se nezobrazuje
    And navigace na další modul se nenabízí (moduly jsou tematicky nezávislé)
```

### Epic 5: Access control

```gherkin
Feature: Přístupová práva
  Scenario: Neplatící uživatel na placené epizodě
    Given jsem přihlášený ale nemám aktivní purchase ani firemní licenci
    When otevřu URL placené epizody
    Then jsem přesměrován na ceník (#cenik)

  Scenario: Nepřihlášený na placené epizodě
    Given nejsem přihlášen
    When otevřu URL placené epizody
    Then jsem přesměrován na /login

  Scenario: Free epizoda pro kohokoliv
    Given nejsem přihlášen
    When otevřu URL free epizody
    Then vidím video player bez omezení

  Scenario: Expired subscription
    Given moje subscription expirovala před 8+ dny (po grace period)
    When otevřu placenou epizodu
    Then jsem přesměrován na ceník s hláškou "Vaše předplatné vypršelo"
```

### Epic 6: Subscription lifecycle

```gherkin
Feature: Obnovení a expirace
  Scenario: Automatické obnovení
    Given mám aktivní subscription
    When se blíží konec ročního období
    Then 14 dní předem dostanu email "Vaše předplatné se brzy obnoví"
    And 7 dní předem dostanu druhý reminder
    When Stripe strhne platbu
    Then expirace se prodlouží o rok

  Scenario: Selhání platby při obnově
    Given platba při obnově selhala (expirovaná karta)
    Then dostanu email o selhání platby s odkazem na Stripe Customer Portal
    And začíná 7denní grace period
    When grace period uplyne a platba stále nebyla provedena
    Then status purchase se změní na "expired"
    And dostanu farewell email

  Scenario: Refund
    Given chci vrátit peníze
    And je méně než 14 dní od nákupu
    And dokončil jsem méně než 50 % epizod kurzu
    When požádám o refund (email na support)
    Then admin provede refund přes Stripe
    And přístup je okamžitě deaktivován

  Scenario: Odmítnutí refundu
    Given chci vrátit peníze
    And dokončil jsem více než 50 % epizod
    Then refund je odmítnut (obsah byl spotřebován)
```

### Epic 7: Admin

```gherkin
Feature: Admin správa
  Scenario: Přidání nové epizody
    Given jsem admin
    And nahrál jsem video na Bunny Stream
    When otevřu admin GUI
    Then mohu vytvořit novou epizodu s: název, slug, bunnyVideoId, délka, modul, pořadí, isFree
    When uložím
    Then epizoda je viditelná pro uživatele
    And KV cache se invaliduje

  Scenario: Notifikace o nové B2B objednávce
    Given firma dokončila platbu přes Stripe
    When webhook zpracuje checkout.session.completed pro organizaci
    Then na předdefinované emaily přijde notifikace
    And notifikace obsahuje: doménu, email kupujícího, odkaz na admin GUI

  Scenario: Statistiky
    Given jsem admin na /admin
    Then vidím: počet uživatelů, počet purchases, počet organizací
    And vidím seznam organizací s jejich statusem
```

---

## 4. Refund Policy

| Podmínka | Výsledek |
|----------|----------|
| Do 14 dní od nákupu AND < 50 % epizod dokončeno | Plný refund |
| Do 14 dní od nákupu AND ≥ 50 % epizod dokončeno | Refund odmítnut (obsah spotřebován) |
| Po 14 dnech od nákupu | Refund odmítnut |
| B2B licence | Refund jen na vyžádání, individuální posouzení |

Refund provádí admin ručně přes Stripe Dashboard. Po refundu se `purchase.status` změní na `refunded` a přístup je okamžitě deaktivován.

---

## 5. Email šablony

| Email | Trigger | Obsah |
|-------|---------|-------|
| **Magic link** | Uživatel požádá o přihlášení | CTA tlačítko, platnost 5 min |
| **Purchase confirmation** | Webhook `checkout.session.completed` | Děkujeme, přihlašte se přes magic link |
| **Free preview upgrade** | Uživatel dokončí poslední free epizodu | CTA "Odemknout zbývající epizody", cena, benefity |
| **Renewal reminder (14d)** | 14 dní před expirací subscription | Info o blížící se obnově, odkaz na Customer Portal |
| **Renewal reminder (7d)** | 7 dní před expirací | Druhé upozornění |
| **Payment failed** | Webhook `invoice.payment_failed` | Odkaz na Customer Portal pro update karty |
| **Farewell** | Subscription expirovala (po grace period) | Rozloučení, odkaz na opětovný nákup |
| **Admin: nová organizace** | Webhook `checkout.session.completed` (B2B) | Doména, email kupujícího, odkaz na admin schválení |

Všechny emaily: brandované HTML, logo vibecoding.cz, jeden jasný CTA, odesílatel `kurz@vibecoding.cz`.

---

## 6. Information Architecture

```
kurz.vibecoding.cz
├── / .......................... Landing page (veřejná)
│   ├── Hero + popis kurzu
│   ├── Obsah kurzu (moduly + epizody)
│   ├── Reference účastníků
│   ├── O autorovi (Patrick bio)
│   ├── Ceník (#cenik)
│   └── FAQ
├── /watch/:slug .............. Video player (free = veřejný, placený = auth)
├── /login .................... Magic link přihlášení
├── /login/sent ............... Potvrzení odeslání
├── /dashboard ................ Přehled kurzů (auth required)
│   └── Seznam modulů → klik → seznam epizod s progress
├── /checkout/success ......... Po úspěšné platbě
├── /privacy .................. GDPR / ochrana osobních údajů
├── /api/auth/* ............... Better Auth endpoints
├── /api/checkout/* ........... Stripe Checkout sessions
├── /api/webhooks/stripe ...... Stripe webhook receiver
├── /api/progress/:id ......... htmx progress update
├── /admin .................... Admin dashboard (admin only)
│   ├── Statistiky
│   ├── Organizace (schvalování)
│   └── /admin/courses ........ Správa kurzů/epizod
└── /health ................... Health check
```

---

## 7. Tech Stack

| Vrstva | Technologie | Účel |
|--------|------------|------|
| Runtime | Cloudflare Workers | Edge compute, levné, zero cold start |
| Framework | Hono (TypeScript) | Workers-native router + middleware |
| UI rendering | Hono JSX (server) + htmx 2.x | Server-rendered HTML + interaktivita bez JS bundlu |
| Styling | Tailwind CSS 4 (build step) | Utility-first, produkční CSS soubor ~15 KB |
| ORM | Drizzle ORM | Typed queries, migrations, D1 adapter |
| Databáze | Cloudflare D1 (SQLite) | Primární storage |
| Cache | Cloudflare KV | Landing page, katalog kurzů |
| Async | Cloudflare Queues | Webhook processing, email sending |
| Auth | Better Auth (magic link plugin) | JWT sessions, CSRF, rate limiting |
| Platby | Stripe Checkout + Customer Portal | Subscriptions v CZK |
| Video | Bunny Stream | Signed embed URLs, HLS, adaptive |
| Email | Resend (Pro plán) | Brandované HTML transakční emaily |
| Monitoring | Cloudflare Logpush → R2 | Logy a metriky |

### Tailwind produkční build
Místo CDN (runtime JIT, ~300ms blocking) použít Tailwind CLI build step:
- `npx @tailwindcss/cli -i src/styles/input.css -o public/styles.css --minify`
- Výstupní CSS servírovat jako static asset přes Workers
- Přidat do `pnpm dev` a `pnpm build` scriptů

---

## 8. Databázové entity

Primární klíče: integer autoincrement. Veřejné ID: nanoid (21 chars) v `publicId` sloupci.
Better Auth spravuje: `user`, `session`, `account`, `verification`.

### organization
| Sloupec | Typ | Constraints | Popis |
|---------|-----|-------------|-------|
| id | integer | PK autoincrement | |
| publicId | text | unique, not null | nanoid pro URL |
| domain | text | unique, not null | emailová doména |
| stripeSubscriptionId | text | | Stripe subscription ID |
| status | text | not null, default 'pending' | pending / active / expired |
| createdAt | integer (timestamp) | not null | |

### course
| Sloupec | Typ | Constraints | Popis |
|---------|-----|-------------|-------|
| id | integer | PK autoincrement | |
| title | text | not null | |
| slug | text | unique, not null | URL slug |
| description | text | not null, default '' | |
| published | integer (boolean) | not null, default false | |

### module
| Sloupec | Typ | Constraints | Popis |
|---------|-----|-------------|-------|
| id | integer | PK autoincrement | |
| courseId | integer | FK → course, cascade | |
| title | text | not null | |
| slug | text | not null | unique v rámci course |
| sortOrder | integer | not null, default 0 | |

### lesson
| Sloupec | Typ | Constraints | Popis |
|---------|-----|-------------|-------|
| id | integer | PK autoincrement | |
| moduleId | integer | FK → module, cascade | |
| publicId | text | unique, not null | nanoid pro URL |
| title | text | not null | |
| slug | text | not null | unique v rámci module |
| bunnyVideoId | text | nullable | vyplní admin po uploadu na Bunny |
| durationSeconds | integer | not null, default 0 | ručně, později z Bunny API |
| isFree | integer (boolean) | not null, default false | |
| sortOrder | integer | not null, default 0 | |

### progress
| Sloupec | Typ | Constraints | Popis |
|---------|-----|-------------|-------|
| userId | text | FK → user, composite PK | Better Auth user.id |
| lessonId | integer | FK → lesson, composite PK | |
| completed | integer (boolean) | not null, default false | |
| completedAt | integer (timestamp) | nullable | |

### purchase
| Sloupec | Typ | Constraints | Popis |
|---------|-----|-------------|-------|
| id | integer | PK autoincrement | |
| email | text | not null | email z Stripe Checkout |
| userId | text | nullable | propojeno po prvním přihlášení |
| courseId | integer | FK → course, cascade | |
| type | text | not null | individual / organization |
| stripePaymentId | text | unique, not null | idempotence |
| stripeSubscriptionId | text | nullable | pro lifecycle management |
| status | text | not null, default 'active' | active / expired / refunded |
| expiresAt | integer (timestamp) | not null | +1 rok |
| createdAt | integer (timestamp) | not null | |

---

## 9. Technické detaily a rozhodnutí

### Auth (Better Auth)
- Instance per-request (D1 binding je request-scoped)
- JWT v HttpOnly, Secure, SameSite=Lax cookie
- Ověření na edge přes Web Crypto API — žádný DB dotaz
- Magic link plugin + Resend pro odesílání
- Rate limiting přes KV (max 10 req/min na IP)

### Autorizace
- D1 dotaz na `purchase` / `organization` při přístupu k placenému obsahu
- Lookup přes userId i email (purchase se vytváří před existencí uživatele)
- Budoucí optimalizace: KV cache `access:{userId}` s TTL 5 min

### Stripe
- Checkout v CZK, český Stripe účet
- B2C: yearly subscription, 2 000 Kč
- B2B: yearly subscription, 15 000 Kč + custom field pro doménu
- Customer Portal: self-service cancel, update payment method
- Webhooky přes Cloudflare Queue (idempotentní, UNIQUE na stripePaymentId)
- Webhook eventy: `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.deleted`
- Grace period: 7 dní po selhání platby

### htmx patterns
- `hx-boost="true"` na body → SPA-like navigace bez JS
- Progress tracking: `hx-post` → partial HTML swap
- Admin org approval: `hx-post` → row swap
- Expired session: middleware vrací `HX-Redirect: /login` místo 302

### Video ochrana
- Bunny Stream signed embed URLs, 4h expiry
- Referer check (kurz.vibecoding.cz)
- Žádné download tlačítko (UI only)
- Watermark: odloženo na v2

### KV cache
- Landing page a katalog: cache v KV, TTL 5 min
- Invalidace: admin endpointy volají `env.KV.delete('cache:...')`
- KV je eventual-consistent — akceptovatelné pro tento use case

### Navigace epizod
- Předchozí/další funguje pouze v rámci jednoho modulu
- Moduly jsou tematicky nezávislé — nepropojují se
- Na stránce s videem: odkaz zpět na dashboard

---

## 10. Non-Negotiables (launch blocker)

- [ ] Landing page s obsahem, ceníkem, referencemi a bio
- [ ] Free preview (ep. 1 + 2) bez přihlášení
- [ ] Magic link auth (Better Auth) s resend fallbackem
- [ ] Stripe Checkout B2C (2 000 Kč/rok)
- [ ] Stripe Checkout B2B (15 000 Kč/rok + doména)
- [ ] Webhook processing přes Queue (idempotentní)
- [ ] Video player (Bunny Stream signed embed)
- [ ] Dashboard: seznam kurzů → klik → epizody s progress
- [ ] Access control (purchase + domain check)
- [ ] Konverzní CTA po poslední free epizodě
- [ ] Admin: schvalování organizací + email notifikace
- [ ] Privacy policy stránka
- [ ] Brandované HTML email šablony (minimálně: magic link, purchase confirmation, admin notifikace)
- [ ] Tailwind produkční build (ne CDN)

## 11. Nice-to-Have pro launch

- [ ] Stripe Customer Portal link v dashboardu
- [ ] Admin GUI pro CRUD kurzů/epizod (alternativa: seed SQL)
- [ ] SEO: OG tagy, structured data
- [ ] Renewal reminder emaily (14d + 7d)
- [ ] Payment failed + farewell emaily
- [ ] Cloudflare Logpush monitoring
- [ ] Rate limiting na API

## 12. Co může počkat (v2+)

- Watermark s emailem uživatele
- Automatické stahování délky videa z Bunny API
- Navigace mezi moduly po dokončení
- Admin CRUD pro kurzy (pokud ne v launch)
- Certifikáty o dokončení
- Kvízy a cvičení
- Diskuze pod videi
- Team admin dashboard pro firmy
- Notifikace o novém obsahu
- SCORM export
- Vícedoménová B2B licence
- Rozdělení na více Workers

---

## 13. Provozní náklady

| Služba | Cena/měs | Poznámka |
|--------|----------|----------|
| Bunny Stream | ~100–250 Kč | Závisí na počtu přehrání |
| Cloudflare Workers | ~$5 (125 Kč) | Paid plan pro Queues |
| Resend | Již placeno (Pro) | |
| Stripe | 1,4 % + 0,25 € / transakce | |
| **Celkem** | **~600–900 Kč** | |

---

## 14. Open Questions

| # | Otázka | Rozhodne | Deadline |
|---|--------|----------|----------|
| 1 | Přesný obsah referencí na landing page (jména, citace) | Patrick | Před launchem |
| 2 | Text Patrickova bio na landing page | Patrick | Před launchem |
| 3 | FAQ obsah pro landing page | Patrick | Před launchem |
| 4 | Předdefinované emaily pro admin notifikace | Patrick | Při deploymentu |
| 5 | Stripe účet — existující nebo nový? | Patrick | Při deploymentu |
| 6 | Bunny Stream library — existující nebo nový? | Patrick | Při deploymentu |
| 7 | Druhý a třetí kurz — témata a timeline | Patrick | Po launchi |

---

## Changelog

| Verze | Datum | Změny |
|-------|-------|-------|
| 1.0 | 2026-04-03 | Inicializace PRD, architektura, tech stack |
| 2.0 | 2026-04-07 | User personas, Gherkin stories, refund policy, email šablony, acceptance criteria, konverzní flow, IA, non-negotiables vs nice-to-have |
