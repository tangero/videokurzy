# Changelog

Větší změny v `kurzy.vibecoding.cz`. Formát volně podle
[Keep a Changelog](https://keepachangelog.com/). Datumy jsou
nasazení na produkci.

## 2026-05-19 — Fakturoid, FIO automatika, slevy a další

### Přidáno

- **Fakturoid integrace** pro Stripe i FIO nákupy. Po každé úspěšné
  platbě se automaticky vystaví faktura, pošle e-mailem zákazníkovi
  a zaeviduje jako Zaplacená. ID faktury a odběratele se ukládá do
  `purchase.fakturoidInvoiceId` / `fakturoidSubjectId` pro audit a
  budoucí dobropisy. Dokumentace: `docs/fakturoid-integration.md`.
- **Zaváděcí sleva** — admin v `/admin/settings` nastaví procento,
  limit slotů a volitelný promo kód. Landing zobrazuje strikethrough
  cenu + badge s počtem zbývajících slotů. Po vyčerpání slotů sleva
  buď skončí, nebo zůstane aktivní jen pro lidi s promo kódem
  (volitelná druhá fáze).
- **Bunny Transcribe AI** — admin spustí přepis lekce jedním
  tlačítkem; po dokončení se VTT stáhne z CDN a uloží do
  `lesson.transcript` (pro fulltext / SEO / AI fíčury). Player
  automaticky zobrazí CC titulky.
- **Nový Bunny Stream player** — přepnutí z `iframe.mediadelivery.net`
  na `player.mediadelivery.net`. Lepší UX, accessibility, konzistence
  napříč prohlížeči.
- **Admin CRUD nad uživateli** — list s vyhledáváním a stránkováním,
  detail s e-maily a nákupy, editace jména/role, mazání, správa
  grantů (přidat/prodloužit/odebrat).
- **Uvítací e-mail při zakládání uživatele adminem** —
  editovatelný text z `patrick@vibecoding.cz`, s automatickou patičkou
  o parametrech účtu.
- **Cloudflare Web Analytics** — beacon snippet v layoutu, data se
  sbírají od `b5412e2`.
- **FIO matching cron** — denně v 03:00 UTC nasčítává FIO transakce
  a páruje s pending objednávkami. Po spárování přepne status na
  active, pošle confirmation e-mail a vystaví fakturu ve Fakturoidu.
- **FIO sync karta v adminu** — manuální tlačítko se 60s cooldownem,
  live JS odpočet, historie posledního běhu (čas + počty + chyby).
- **Tabulka uživatelů na `/admin`** ukazuje stav objednávky per
  uživatel: „jen registrace", „čekáme na FIO" (VS), „zaplaceno" (typ
  + platnost + varování pro test mode / admin grant).
- **Fotka Patricka v bio sekci** landingu.
- **CHANGELOG.md** (tento soubor).

### Změněno

- **Stripe přepnut na live mode** — secret key `sk_live_*` a nový
  webhook secret nastaveny v Cloudflare. Reálné karty se teď účtují.
- **Admin bypass paywall centralizovaný v `hasAccess`** — odstraněna
  duplicita `user.role === "admin" || ...` ze 4 míst. Admini
  automaticky vidí všechna placená videa.
- **Deploy konsoliduje na worker `videokurzy`** — `npm run deploy`
  už nepoužívá `--env production`. Custom doména `kurzy.vibecoding.cz`
  i secrets jsou na jednom workeru.
- **Sleva badge na `/#cenik`** se zobrazuje až od ≤ 25 zbývajících
  slotů, s českou pluralizací („zbývá poslední objednávka" / „zbývají
  3 objednávky" / „zbývá 8 objednávek").
- **Po Uložit v admin formulářích** se zobrazuje zelený banner
  „Změny uloženy.", uživatel zůstává na editaci.

### Opraveno

- **Vnořené `<form>` v Transcribe sekci** rozbíjely lesson edit
  formulář (chapters/moments/popis se neukládaly). Sekce přesunuta
  pod hlavní `</form>`.
- **Fakturoid status** — faktury končily ve stavu Odeslaná / Vystavená
  místo Zaplacená. Příčina: `paid_on` v invoice POST neřídí status
  (řídí ho payments tabulka) a email-send přepínal `paid` → `sent`.
  Fix: vždy posledním krokem je `POST /payments.json`, e-mail
  předtím.
- **Orphan Fakturoid faktury** z FIO scanu — `fire-and-forget` volání
  worker zabíjel před uložením `fakturoidInvoiceId` do DB. Fix: scan
  awaituje Fakturoid call.
- **Stripe webhook nelinkoval purchase k existujícímu uživateli** —
  pokud user existoval před webhookem, `purchase.userId` zůstal
  NULL. Fix: webhook si user dohledá podle e-mailu při insertu.
- **`listAdminUsers` zachycuje purchases i podle e-mailu**, ne jen
  podle userId, takže historicky neslinkované Stripe nákupy se v
  adminu zobrazují jako placené.
- **FIO diagnostic endpoint** odhalil prázdný / chybný token v
  Cloudflare secret (uložilo se doslova „FIO_API_TOKEN" místo
  hodnoty). Bez tohohle by FIO API vracelo 500 bez vysvětlení.
- **Nový player** ponechává existující `playerjs` postMessage bridge
  pro skok na kapitoly (ověřeno v dokumentaci, beze změn v UI).

### Bezpečnost / produkční hygiena

- **Smazán worker `videokurzy-production`** (osiřelý duplicit).
- **`videokurzy-production` test Stripe mode purchases** vyčištěny
  z DB (vaclav@duclair.org `cs_test_*` row).
- **8 historických orphan faktur** v Fakturoidu navázáno na DB +
  označeno zaplaceno (admin opraveno ručně po fix flow).

## Před 2026-05-19

Vývoj projektu — auth (Better Auth, magic link, OIDC), checkout
(Stripe Subscriptions, FIO QR), lekce/moduly/kurzy, FIO manuální
verify, base landing, administrativní rozhraní pro kurzy/moduly/lekce,
e-maily přes Resend (Andrea Maloveczká). Detaily v `git log`.
