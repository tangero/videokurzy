# PRD: Videokurz platforma — kurzy.vibecoding.cz

## Co to je
Distribuční platforma pro placený videokurz "Claude Code s Patrickem". Součást ekosystému vibecoding.cz. Běží na Cloudflare Workers jako samostatný worker na subdoméně kurzy.vibecoding.cz. Zároveň technologické demo vibe codingu — edge-first architektura bez JS frameworku.

## Pro koho
- **B2C:** Jednotlivci (neprogramátoři, začínající vibe codeři), kteří si koupí roční přístup.
- **B2B:** Firmy, které koupí roční doménovou licenci — kdokoliv s emailem na dané doméně má přístup (bez limitu počtu uživatelů).

## Hlavní user flow

### B2C nákup a přihlášení
1. Návštěvník přijde na landing page → vidí obsah kurzu, ceník, free preview epizody.
2. Klikne "Koupit" → zadá email → přesměrován na Stripe Checkout (CZK).
3. Stripe webhook → Cloudflare Queue → vytvoří purchase + pošle magic link na email.
4. Uživatel klikne na magic link → je přihlášen, má přístup k placeným epizodám.
5. Při dalším přihlášení: zadá email → dostane nový magic link → klikne → přihlášen.

### B2B nákup a přihlášení
1. Firma klikne "Koupit firemní licenci" → zadá firemní email + doménu (např. firma.cz) → Stripe Checkout.
2. Stripe webhook → vytvoří organization se status `pending` a doménou.
3. Admin (Patrick) schválí doménu v admin GUI → status se změní na `active`.
4. Zaměstnanec firmy: zadá email jan@firma.cz → systém najde aktivní organizaci pro doménu → pošle magic link → přihlášen, má přístup.

### Sledování kurzu
1. Po přihlášení vidí dashboard: seznam modulů a epizod, progress bar.
2. Klikne na epizodu → video player (Bunny Stream embed, signed URL, 4h expiry).
3. Po dokončení epizody ji označí jako dokončenou (htmx, bez page reload) → progress se aktualizuje.
4. Navigace: předchozí/další epizoda.

### Free preview
- První 2 epizody jsou dostupné všem bez přihlášení i bez platby (B2C i B2B).

### Admin
1. Admin spravuje kurzy, moduly a epizody přes admin GUI.
2. Admin schvaluje B2B doménové licence (pending → active).
3. Admin vidí statistiky: počet uživatelů, tržby, dokončené epizody.

## Obsah kurzu (10 epizod, 3 moduly)

### Modul 1: Začínáme
- Ep. 1: Nápad a zadání (free preview)
- Ep. 2: Kostra aplikace za 20 minut (free preview)
- Ep. 3: První feature a iterace

### Modul 2: Stavíme aplikaci
- Ep. 4: Databáze a data
- Ep. 5: Když se to rozbije
- Ep. 6: API a integrace
- Ep. 7: Autentizace a bezpečnost

### Modul 3: Produkce a polish
- Ep. 8: Deployment
- Ep. 9: Design — moodboard a vizuální identita
- Ep. 10: Co dál — údržba, vylepšení, limity

## Tech stack

| Vrstva | Technologie | Účel |
|--------|------------|------|
| Runtime | Cloudflare Workers | Edge compute, levné, zero cold start |
| Framework | Hono (TypeScript) | Lehký, Workers-native router + middleware |
| UI rendering | Hono JSX (server) + htmx | Server-rendered HTML + interaktivita bez JS bundlu |
| Styling | Tailwind CSS | Utility-first CSS |
| ORM | Drizzle ORM | Typed queries, migrations, D1 adapter |
| Databáze | Cloudflare D1 (SQLite) | Primární storage |
| Cache | Cloudflare KV | Landing page, kurz katalog (data se mění zřídka) |
| Async processing | Cloudflare Queues | Stripe webhook processing, odesílání emailů |
| Auth | Better Auth (magic link plugin) | JWT sessions, bezheselné přihlášení, CSRF ochrana |
| Platby | Stripe Checkout + Customer Portal | B2C roční, B2B subscription |
| Video | Bunny Stream | Signed embed URLs, HLS streaming |
| Email | Resend (Pro plán) | Magic linky, purchase confirmation |
| Monitoring | Cloudflare Workers Analytics + Logpush | Metriky, logy do R2 |

### Proč tento stack
- **Hono + htmx** místo React SPA: žádný JS bundle, server-rendered, rychlé, edge-native. Jako vibe coding demo ukazuje moderní alternativu k SPA.
- **Better Auth + JWT sessions**: Auth se ověřuje na edge kryptograficky (Web Crypto API), bez DB dotazu na každý request. Magic link jako plugin, rate limiting a CSRF ochrana built-in.
- **Drizzle ORM**: Typed queries a migrations pro D1. Požadavek Better Auth, ale přináší i lepší DX než raw SQL.
- **Cloudflare Queues**: Stripe webhook vrátí 200 okamžitě, zpracování (create purchase, send email) běží asynchronně s built-in retry.
- **Cloudflare KV**: Landing page a katalog kurzů se mění zřídka — cache v KV eliminuje D1 queries na každý page load.
- **htmx**: Progress tracking, označení epizody, navigace — vše přes partial HTML responses bez full page reload.

## Databázové entity

Primární klíče jsou integer autoincrement. Pro URL a frontend expozici slouží `publicId` (nanoid, 21 chars). Better Auth spravuje vlastní tabulky (user, session, account, verification) — níže jsou jen aplikační entity.

### organization
| Sloupec | Typ | Popis |
|---------|-----|-------|
| id | integer | PK, autoincrement |
| publicId | text | nanoid, unique, pro URL |
| domain | text | unique, např. 'firma.cz' |
| stripeSubscriptionId | text | |
| status | text | 'pending' / 'active' / 'expired' |
| createdAt | timestamp | |

### course
| Sloupec | Typ | Popis |
|---------|-----|-------|
| id | integer | PK, autoincrement |
| title | text | |
| slug | text | unique |
| description | text | |
| published | boolean | |

### module
| Sloupec | Typ | Popis |
|---------|-----|-------|
| id | integer | PK, autoincrement |
| courseId | integer | FK → course |
| title | text | |
| slug | text | unique within course |
| sortOrder | integer | |

### lesson
| Sloupec | Typ | Popis |
|---------|-----|-------|
| id | integer | PK, autoincrement |
| moduleId | integer | FK → module |
| publicId | text | nanoid, unique, pro URL |
| title | text | |
| slug | text | unique within module |
| bunnyVideoId | text | |
| durationSeconds | integer | |
| isFree | boolean | free preview flag |
| sortOrder | integer | |

### progress
| Sloupec | Typ | Popis |
|---------|-----|-------|
| userId | text | FK → Better Auth user.id, composite PK |
| lessonId | integer | FK → lesson, composite PK |
| completed | boolean | |
| completedAt | timestamp | nullable |

### purchase
| Sloupec | Typ | Popis |
|---------|-----|-------|
| id | integer | PK, autoincrement |
| userId | text | FK → Better Auth user.id |
| courseId | integer | FK → course |
| type | text | 'individual' / 'organization' |
| stripePaymentId | text | **unique** — idempotence pro webhook retry |
| status | text | 'active' / 'expired' / 'refunded' |
| expiresAt | timestamp | +1 rok |
| createdAt | timestamp | |

## Technické detaily

### Auth (Better Auth)
- Better Auth instance se vytváří per-request v Hono middleware (D1 binding je dostupný jen v request contextu).
- JWT session uložený v HttpOnly, Secure, SameSite=Lax cookie.
- Worker ověřuje JWT podpis přes Web Crypto API — žádný DB dotaz při ověřování.
- Magic link plugin pro bezheselné přihlášení přes Resend.
- Better Auth spravuje tabulky: `user`, `session`, `account`, `verification`.

### Autorizace (přístup k obsahu)
- JWT řeší autentizaci (kdo jsi), ale autorizace (máš zaplaceno?) vyžaduje DB lookup.
- **MVP:** Přímý D1 dotaz na `purchase` / `organization` při každém přístupu k placenému obsahu. D1 read repliky jsou na edge, SELECT s indexem je < 5ms. Pro očekávaný provoz (desítky–tisíce uživatelů/den) plně dostačující.
- **Budoucí optimalizace (pokud potřeba):** KV cache s klíčem `access:{userId}`, TTL 5 minut. Stripe webhook / admin akce smaže KV záznam → další request jde do D1 a uloží čerstvý stav. JWT claims pro autorizaci nepoužívat — invalidace je příliš složitá.

### Stripe webhook idempotence
- Queue consumer při zpracování webhooků vždy kontroluje existenci záznamu.
- `purchase.stripePaymentId` má UNIQUE constraint — duplicitní INSERT selže.
- Při `checkout.session.completed`: INSERT OR IGNORE do purchase tabulky.
- Idempotentní = bezpečné při at-least-once delivery od Stripe i při Queue retry.

### htmx a expired session
- Auth middleware detekuje htmx requesty přes hlavičku `HX-Request: true`.
- Pokud JWT expiroval a jde o htmx request: vrátí `HX-Redirect: /login` (HTTP 200 s hlavičkou).
- Pokud JWT expiroval a jde o normální request: standardní 302 redirect na `/login`.
- Tím se zabrání vložení login stránky dovnitř dashboardu.

### KV cache invalidace
- KV je eventual-consistent — po update v D1 může KV vracet stará data.
- Admin API endpointy pro úpravu obsahu (kurzy, moduly, epizody) musí explicitně volat `env.KV.delete('cache:catalog')`.
- Tím se zajistí, že další request vygeneruje čerstvý obsah z D1.

### Edge kompatibilita
- **nanoid:** Použít `nanoid` v3+ nebo `crypto.getRandomValues` (Web Crypto API, nativní ve Workers). Nepoužívat import závislý na Node `crypto`.
- **Better Auth:** Ověřit edge-compatible importy. Workers mají `nodejs_compat` flag, ale preferovat nativní Web API kde to jde.
- **Drizzle ORM:** Inicializace per-request je v pořádku — D1 binding je synchronní reference, overhead < 1ms.

### D1 zápisy (progress tracking)
- Progress se zapisuje přímo do D1 (INSERT OR REPLACE) při označení epizody jako dokončené.
- Pro očekávaný provoz je přímý zápis dostatečný.
- Queue pro progress zápisy je over-engineering — přidáme, jen pokud se ukáže bottleneck.

## Access control logika

Uživatel má přístup k placené epizodě, pokud splňuje **alespoň jedno**:
1. Má aktivní individuální purchase (`purchase.status = 'active'` a `expiresAt > now`)
2. Jeho emailová doména odpovídá aktivní organizaci (`organization.status = 'active'`)

Epizody s `isFree = true` jsou přístupné všem bez přihlášení.

## Ceník

| Plán | Cena | Model | Přístup |
|------|------|-------|---------|
| Jednotlivec | 2 000 Kč/rok | roční subscription | 1 osoba, 1 rok |
| Firma | 15 000 Kč/rok | roční subscription | celá doména, bez limitu uživatelů |

### Stripe specifika
- Stripe Checkout v CZK, český Stripe účet
- B2C: subscription s ročním cyklem
- B2B: subscription s ročním cyklem + custom field pro doménu
- Stripe Customer Portal: self-service pro správu subscription (cancel, update payment)
- Webhook eventy: `checkout.session.completed`, `invoice.paid`, `customer.subscription.deleted`
- Grace period: 7 dní po expiraci subscription před deaktivací přístupu

## Ochrana obsahu
- Bunny Stream signed URLs s 4h expirací
- Referer check (video jen z kurzy.vibecoding.cz)
- Žádné download tlačítko (UI only, ne skutečná ochrana)

## Co musí MVP umět
- [ ] Landing page s obsahem kurzu a ceníkem (cached v KV)
- [ ] Free preview: první 2 epizody bez přihlášení
- [ ] Better Auth: magic link přihlášení s JWT sessions
- [ ] Stripe Checkout (B2C roční + B2B roční s doménou)
- [ ] Stripe webhooky přes Cloudflare Queues (idempotentní)
- [ ] Stripe Customer Portal pro self-service
- [ ] B2B: admin schválení domény (pending → active)
- [ ] Video player s Bunny Stream signed embed URLs
- [ ] Progress tracking přes htmx (označení epizody jako dokončené)
- [ ] Dashboard s přehledem epizod a progress barem
- [ ] Navigace mezi epizodami (předchozí/další) s hx-boost
- [ ] Access control: placený obsah jen pro aktivní purchase nebo doménu
- [ ] htmx auth handling (HX-Redirect při expired session)
- [ ] Admin GUI: správa kurzů/modulů/epizod, schvalování domén, statistiky
- [ ] SEO: OG tagy, meta description pro landing page
- [ ] GDPR: privacy policy, souhlas se zpracováním emailu
- [ ] Error monitoring (Cloudflare Logpush → R2)
- [ ] Drizzle ORM migrations
- [ ] Rate limiting na API

## Co může počkat
- Watermark s emailem uživatele přes Bunny
- Certifikáty o dokončení
- Kvízy a cvičení v platformě
- Diskuze pod videi
- Team admin dashboard (firma vidí progress zaměstnanců)
- Notifikace o novém obsahu
- SCORM export pro firemní LMS
- Vícedoménová B2B licence

## Provozní náklady
Bunny Stream ~100–250 Kč/měs, Cloudflare Workers paid plan ~$5/měs (pro Queues), Resend Pro (již placeno), Stripe 1,4 % + 0,25 € za transakci. Celkem ~600–900 Kč/měs.
