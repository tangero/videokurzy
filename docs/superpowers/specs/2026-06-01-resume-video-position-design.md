# Design: Pamatování pozice videa + nabídka pokračování

**Datum:** 2026-06-01
**Stav:** Schváleno k implementaci

## Cíl

Přihlášenému uživateli se zapamatuje, kam se v dané lekci dostal. Při příštím
otevření lekce video automaticky naskočí na tu pozici a nad videem se ukáže
nenásilná lišta s možností „od začátku".

## Rozsah a hranice

- **V rozsahu:** pamatování poslední pozice přehrávání per uživatel + lekce,
  auto-skok na pozici, UX volba „od začátku".
- **Mimo rozsah:** pamatování rychlosti přehrávání. Bunny iframe player rychlost
  zvenčí nepouští — player.js nemá `setPlaybackRate`/`getPlaybackRate` ani
  rate event a embed URL nemá parametr pro výchozí rychlost (`showSpeed` jen
  zobrazí ovladač v UI). Realizovatelné jen vlastním přehrávačem (hls.js),
  což je velký zásah a ztráta Bunny UI/heatmap/captions — vědomě vynecháno.

## Architektura

Přehrávač je Bunny iframe ovládaný přes player.js. Watch-tracking už dnes
posílá heartbeat `{ maxSegment, watchedSeconds }` na `/api/watch/:lessonId`
a ukládá do tabulky `lesson_watch` (PK `userId + lessonId`). Pozici přidáme
do téhož toku.

### 1. Databáze

Nový sloupec v existující tabulce `lesson_watch`:

- `lastPositionSeconds INTEGER NOT NULL DEFAULT 0`

Ruční migrace `drizzle/migrations/0020_lesson_watch_position.sql` (drizzle-kit
`db:generate` je v tomto repu rozbité kvůli kolizi meta snapshotů). Zároveň
upravit `src/db/schema.ts`, ať sedí typy. Po `npm run deploy` spustit
`npm run db:migrate:prod`.

### 2. Ukládání pozice (klient → server)

V inline `<script>` ve `src/views/watch.tsx` watch-tracking už drží proměnnou
`lastTime` (aktuální čas z `timeupdate`). Do payloadu odesílaného na
`/api/watch/:lessonId` přidáme `positionSeconds: Math.round(lastTime)`.

- `/api/watch/:lessonId` v `src/routes/progress.tsx` rozšíříme o čtení
  `positionSeconds` z těla requestu.
- `recordWatch()` v `src/lib/watch-stats.ts` dostane `positionSeconds`
  a uloží ho do `lastPositionSeconds`.

**Semantika upsertu — klíčové rozhodnutí:** `maxSegment` a `watchedSeconds` se
posouvají jen nahoru (`max(staré, nové)`). Pozice je naopak „poslední známá",
takže `lastPositionSeconds` ukládáme **přepisem na novou hodnotu** (ne max) —
když uživatel přetočí zpět, chceme respektovat, kde reálně je.

### 3. Auto-skok (server → embed)

V route `watch.get("/watch/:slug")` (`src/routes/watch.tsx`) načteme
`lastPositionSeconds` pro `user.id + found.id`. Rozhodovací logiku vyčleníme do
čisté funkce `shouldResume(pos, duration, completed)`:

- resume jen když `pos > 15` **a** lekce **není** dokončená **a**
  `pos < duration - 15` (ne když divák dojel skoro na konec).

Když `shouldResume` vrátí true, do `embedUrl` přidáme `&t=<pos>` → video naběhne
přímo na pozici. S `autoplay=false` (aktuální stav) video stojí připravené na
tom místě, žádné problikávání seekem. Do `WatchPage` pošleme
`resumePosition: number | null`.

### 4. UX „od začátku"

Když je `resumePosition` aktivní, nad videem se ukáže nenásilná lišta:

> ⏵ Pokračuješ od **5:23** · [od začátku]

Tlačítko „od začátku" je čistě klientské — v existujícím `<script>` zavolá
`player.setCurrentTime(0)` a lištu schová. Žádný reload stránky. Lišta zůstává
viditelná, dokud uživatel nespustí přehrávání (aby ji stihl přečíst), poté se
skryje.

### 5. Edge cases

- Nepřihlášený divák u free lekce → žádný DB záznam → bez resume (přijatelné,
  je to server-side feature vázaná na přihlášení).
- Lekce nezapočatá / `pos = 0` → bez `t`, bez lišty.
- Pozice blízko konce nebo dokončená lekce → `shouldResume` = false, start od 0.
- Více tabů: pozice = poslední heartbeat, konzistentní s tím, jak už tracking
  funguje.

### 6. Testy

- `recordWatch`: `lastPositionSeconds` se **přepisuje** (ne maxuje); ostatní
  pole (`maxSegment`, `watchedSeconds`) se nadále posouvají jen nahoru.
- `shouldResume(pos, duration, completed)`: prahy 15 s na začátku, 15 s před
  koncem, a `completed = true` → false. Čistá funkce, testovatelná bez DB.

## Dotčené soubory

- `drizzle/migrations/0020_lesson_watch_position.sql` (nový)
- `src/db/schema.ts` — sloupec `lastPositionSeconds`
- `src/lib/watch-stats.ts` — `recordWatch` přijme a uloží pozici; `shouldResume`
- `src/routes/progress.tsx` — API přijme `positionSeconds`
- `src/routes/watch.tsx` — načtení pozice, `t` param v embedUrl, `resumePosition`
- `src/views/watch.tsx` — lišta „pokračuješ od…", klientské „od začátku"
