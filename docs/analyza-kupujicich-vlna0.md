# Analýza kupujících — Vlna 0

> **Snapshot:** 29. 5. 2026 · zdroj: produkční D1 (`videokurzy-db`, read-only) + ARES
> **Účel:** podklad pro produkci videa a marketing. „Vlna 0" = nula vývoje, jen dotazy nad
> tím, co už máme.

## TL;DR

- **72 placených objednávek, všechny z května 2026** → jsme 1 měsíc po launchi, tohle jsou
  early adopters. Žádná historie ani sezónnost.
- **111 000 Kč** tržby, průměr **1 542 Kč/objednávka**.
- Persona: **profesionál z IT nebo marketingu/agentury** (často OSVČ / malá s.r.o.),
  který chce AI-asistovaný vývoj („vibecoding") do reálné práce.
- **Dvě díry v aktivaci:** 13 zaplatilo bez založení účtu (nedostali se ke kurzu);
  z 54 s účtem jen 21 dokončilo aspoň 1 lekci.
- **Atribuce kanálu je zatím slepá** (žádné slevové kódy, plošná launch sleva). První
  vlna kupujících přišla z newsletteru na stávající zákazníky.

---

## 1) Kdo jsou kupující

| Dimenze | Zjištění |
|---|---|
| Typ | 100 % `individual`, **0 firemních licencí** (i lidé s IČO kupují jako jednotlivci) |
| E-mail | **34 firemní doména** / **38 freemail** (z toho 25× gmail) → silný profesní zájem |
| Fakturace | **13 vyplnilo IČO** (chce fakturu) → OSVČ + malé s.r.o. |

**Obory firem (ARES / NACE u 13 IČO):**

| Obor (NACE) | Příklady |
|---|---|
| IT / programování (62) | C3S, PolyWeb, MS Solution, STORMWARE, ARIGA — **dominuje** |
| Reklama / marketing (731) | agentura Fenek, Simplementa, OSVČ |
| Management consulting (70200) | ARIGA, agentura Fenek, MS Solution |
| Rozptyl | R-PHARMA (farma/velkoobchod), foto, vzdělávání, cestovka |

## 2) Na co se dívají + 3) Jak dlouho

Žebříček dokončení = učebnicový drop-off trychtýř (lidé ubývají, jak kurz technicky houstne):

| # | Lekce | Délka | Dokončilo |
|---|---|---|---|
| 1 | Od nápadu k profi zadání za čtvrt hodiny | 23 min | **21** |
| 2 | CLAUDE.md – mozek projektu | 9 min | 16 |
| 3 | Plánovací mód a CLAUDE.MD | 11 min | 12 |
| 4 | Stavíme appku čili z textu do prohlížeče | 24 min | 9 |
| 5 | Oživujeme aplikaci a řešíme chyby | 30 min | 6 |
| 6 | Nasazení aplikace a propojení databáze | 15 min | 5 |

- **4 lidé dokončili všech 6.** Rozložení dokončených lekcí na uživatele: 1→4, 2→4, 3→5,
  4→2, 5→2, 6→4.
- **Produkční signál:** čím dál v kurzu, tím vyšší odpad. Zvážit kratší díly / zjednodušení
  v technicky náročnější druhé půlce.

> ⚠️ **Limit dat:** `progress` měří jen „dokončeno", **ne odsledovaný čas**. Skutečnou
> retenční křivku (kde v minutáži lidé odcházejí) Vlna 0 neumí → bunny.net heatmapy / Vlna 1.

## 4) Co chtějí dál

Z dat **nezjistitelné** — vyžaduje dotazník. Viz Doporučení / Vlna 1.

---

## 🔴 Dvě díry v aktivaci

### Díra A — 13 zaplatilo, ale nemá účet (nedostali se ke kurzu)

Není to chyba sběru e-mailu. E-mail máme u všech 72 (`purchase.email`). Mechanika
(doloženo kódem):

1. Checkout vždy uloží e-mail, ale `userId: null` (`src/routes/checkout.tsx:418-420`) —
   účet se při platbě záměrně nezakládá.
2. `userId` se doplní automaticky až při **prvním přihlášení** — auth middleware
   (`src/middleware/auth.ts:46`) zavolá `linkPurchasesToUser` (`src/lib/access.ts:59`),
   který spáruje objednávku přes shodu e-mailu.
3. Přístup jede přes e-mail i userId (`src/lib/access.ts:29`), ale člověk se musí aspoň
   jednou přihlásit, jinak shoda nemá co porovnat.

→ `userId IS NULL` = **zaplatili, e-mail máme, ale nikdy si nezaložili účet.** Po platbě
dostávají odkaz `/login?email=…`, který těchto 13 nedotáhlo.

**13 e-mailů k oslovení (nudge „dokonči přihlášení"):**

```
FIO:    pavsyk@gmail.com, roman@faltyn.net, shubin@shubin.cz,
        martin.krajnak111@gmail.com, martin.matus@ms-solution.cz
Stripe: petr@takafata.cz, mk@backlogica.com, tadah@seznam.cz,
        radek@saturka.cz, martin.votava@gmail.com, karel.stach@gmail.com,
        r.suchanek.r@gmail.com, muzatko@stormware.cz
```

Systémový fix: po platbě poslat magic-link / „nastav heslo" a účet rovnou propojit.

### Díra B — slabá aktivace obsahu

Z 54 kupujících s účtem **jen 21 dokončilo aspoň 1 lekci** → 33 zatím nerozkoukáno.
(Část může koukat bez dokončení — `progress` to nepozná.)

---

## Slepá místa & platby

- **Atribuce kanálu:** 0 slevových kódů, launch sleva 50 % plošná (58× sleva, 14× plná
  cena za 33 000 Kč). Nevíme z dat, odkud lidé přišli. První vlna = newsletter na
  stávající zákazníky.
- **Platby:** Stripe 38 / FIO 29 aktivních → FIO (převod) překvapivě silný (43 %).
  **5 FIO objednávek nedotaženo** (4 expired, 1 pending); Stripe 0 selhání.

---

## Doporučení / další kroky

1. **Onboarding fix (utíkají peníze):** nudge 13 lidem bez účtu + magic-link po platbě.
2. **Aktivace obsahu:** oslovit 33 nerozkoukaných.
3. **Atribuce (Vlna 1):** UTM + first-touch cookie → `purchase` (Stripe `metadata`,
   FIO server-side) + sebe-deklarace „kde jste se o nás dozvěděli" + slevové kódy
   per kanál. Předtím nastavit konvenci pojmenování UTM.
4. **Co chtějí dál (Vlna 1):** dotazník — profilovací mikro-anketa po koupi +
   hlasování o tématech (uzavřený seznam + otevřené pole).
5. **Watch-time (Vlna 1):** bunny.net Statistics API + player.js `timeupdate` heartbeat
   pro skutečnou retenční křivku.

## Metodická pozn. k reprodukci dotazů

Všechny počty z `kind='paid'`. Klíčové dotazy: typ×platba×status, e-mailové domény,
distribuce slevy, IČO→ARES, aktivační trychtýř (`userId IS NULL`, `progress`), žebříček
dokončení lekcí. Spustitelné přes `wrangler d1 execute videokurzy-db --remote --command "…"`.
