# Resume Video Position — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Přihlášenému divákovi se zapamatuje poslední pozice ve videu lekce; při dalším otevření video naskočí na tu pozici a nad ním se ukáže lišta s volbou „od začátku".

**Architecture:** Pozice se ukládá do existující tabulky `lesson_watch` (nový sloupec `lastPositionSeconds`) přes už existující heartbeat na `/api/watch/:lessonId`. Server při renderu lekce rozhodne čistou funkcí `shouldResume`, jestli resumovat, a do podepsaného Bunny embed URL přidá parametr `&t=<vteřiny>`. Klientský `<script>` zobrazí lištu a tlačítkem „od začátku" zavolá `player.setCurrentTime(0)`.

**Tech Stack:** Hono + hono/jsx (SSR), Drizzle ORM, Cloudflare D1, Bunny Stream player.js, Vitest + `@cloudflare/vitest-pool-workers` (reálná D1 v testech, migrace aplikovány automaticky z `drizzle/migrations/`).

---

## File Structure

- `drizzle/migrations/0020_lesson_watch_position.sql` (nový) — přidá sloupec `lastPositionSeconds`.
- `src/db/schema.ts` (modify) — `lastPositionSeconds` do `lessonWatch`.
- `src/lib/watch-stats.ts` (modify) — `shouldResume()` (nová čistá funkce); `RecordWatchInput` + `recordWatch()` přijmou a uloží pozici (přepisem, ne max).
- `src/lib/bunny.ts` (modify) — `generateSignedEmbedUrl()` volitelný `startSeconds`.
- `src/routes/progress.tsx` (modify) — API přijme `positionSeconds`.
- `src/routes/watch.tsx` (modify) — načte pozici, spočítá resume, sestaví embed s `t`, předá `resumePosition` do view.
- `src/views/watch.tsx` (modify) — lišta „pokračuješ od…", klientské odeslání pozice a „od začátku".
- `tests/lib/watch-stats.test.ts` (modify) — testy `shouldResume`.
- `tests/lib/bunny.test.ts` (nový) — test `startSeconds` parametru.

---

## Task 1: DB migrace + schema pro `lastPositionSeconds`

**Files:**
- Create: `drizzle/migrations/0020_lesson_watch_position.sql`
- Modify: `src/db/schema.ts:175-190` (tabulka `lessonWatch`)

- [ ] **Step 1: Napiš migraci**

Create `drizzle/migrations/0020_lesson_watch_position.sql`:

```sql
ALTER TABLE lesson_watch ADD COLUMN lastPositionSeconds INTEGER NOT NULL DEFAULT 0;
```

- [ ] **Step 2: Přidej sloupec do schématu**

V `src/db/schema.ts` do definice `lessonWatch` (za `watchedSeconds`, řádek ~185) přidej:

```ts
    watchedSeconds: integer("watchedSeconds").notNull().default(0),
    lastPositionSeconds: integer("lastPositionSeconds").notNull().default(0),
    startedAt: integer("startedAt", { mode: "timestamp" }).notNull(),
```

- [ ] **Step 3: Ověř, že kód je v souboru a typecheck prochází**

Run: `grep -c "lastPositionSeconds" src/db/schema.ts drizzle/migrations/0020_lesson_watch_position.sql && npm run typecheck`
Expected: `2` (1 ve schema, 1 v migraci) a typecheck bez chyb.

- [ ] **Step 4: Commit**

```bash
git add drizzle/migrations/0020_lesson_watch_position.sql src/db/schema.ts
git commit -m "watch: DB sloupec lastPositionSeconds pro pamatování pozice videa"
```

---

## Task 2: Čistá funkce `shouldResume`

Rozhoduje, jestli při renderu lekce naskočit na uloženou pozici. Prahy: minimálně 15 s do videa, ne dokončená lekce, a aspoň 15 s před koncem.

**Files:**
- Modify: `src/lib/watch-stats.ts`
- Test: `tests/lib/watch-stats.test.ts`

- [ ] **Step 1: Napiš padající testy**

Na konec `tests/lib/watch-stats.test.ts` přidej (a doplň import):

```ts
import { WATCH_SEGMENTS, shouldResume } from "../../src/lib/watch-stats";
```

```ts
describe("shouldResume", () => {
  it("resumuje uprostřed nedokončené lekce", () => {
    expect(shouldResume(323, 600, false)).toBe(true);
  });

  it("neresumuje dokončenou lekci", () => {
    expect(shouldResume(323, 600, true)).toBe(false);
  });

  it("neresumuje, když je pozice příliš na začátku (<=15 s)", () => {
    expect(shouldResume(15, 600, false)).toBe(false);
    expect(shouldResume(5, 600, false)).toBe(false);
  });

  it("neresumuje, když je pozice blízko konce (<15 s do konce)", () => {
    expect(shouldResume(590, 600, false)).toBe(false);
    expect(shouldResume(600, 600, false)).toBe(false);
  });

  it("neresumuje při nulové/neznámé pozici nebo délce", () => {
    expect(shouldResume(0, 600, false)).toBe(false);
    expect(shouldResume(323, 0, false)).toBe(false);
  });
});
```

- [ ] **Step 2: Spusť testy — musí padat**

Run: `npm test -- watch-stats`
Expected: FAIL — `shouldResume is not a function` (export neexistuje).

- [ ] **Step 3: Implementuj `shouldResume`**

Na konec `src/lib/watch-stats.ts` (za `clampSegment`) přidej:

```ts
/** Práh (v s) od začátku a před koncem, kdy ještě má smysl resumovat. */
const RESUME_EDGE_SECONDS = 15;

/**
 * Rozhodne, jestli při otevření lekce naskočit na uloženou pozici.
 * Resume jen pro nedokončenou lekci, pozici aspoň RESUME_EDGE_SECONDS do videa
 * a aspoň RESUME_EDGE_SECONDS před koncem (jinak start od 0).
 */
export function shouldResume(
  positionSeconds: number,
  durationSeconds: number,
  completed: boolean
): boolean {
  if (completed) return false;
  if (!Number.isFinite(positionSeconds) || !Number.isFinite(durationSeconds)) return false;
  if (durationSeconds <= 0) return false;
  if (positionSeconds <= RESUME_EDGE_SECONDS) return false;
  if (positionSeconds >= durationSeconds - RESUME_EDGE_SECONDS) return false;
  return true;
}
```

- [ ] **Step 4: Spusť testy — musí projít**

Run: `npm test -- watch-stats`
Expected: PASS (všechny `shouldResume` i původní retenční testy).

- [ ] **Step 5: Commit**

```bash
git add src/lib/watch-stats.ts tests/lib/watch-stats.test.ts
git commit -m "watch: shouldResume — čistá logika pro nabídku pokračování"
```

---

## Task 3: `recordWatch` ukládá pozici (přepisem)

`maxSegment`/`watchedSeconds` se posouvají jen nahoru; `lastPositionSeconds` se **přepisuje** poslední hodnotou.

**Files:**
- Modify: `src/lib/watch-stats.ts:8-13` (`RecordWatchInput`), `:23-61` (`recordWatch`)
- Test: `tests/lib/watch-stats.test.ts`

- [ ] **Step 1: Napiš padající test (reálná D1)**

Na konec `tests/lib/watch-stats.test.ts` přidej. Doplň importy nahoře souboru — `recordWatch` přidej do **existujícího** importu z watch-stats (z Tasku 2), nepřidávej druhý řádek ze stejného modulu:

```ts
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { WATCH_SEGMENTS, shouldResume, recordWatch } from "../../src/lib/watch-stats";
```

```ts
describe("recordWatch — pozice", () => {
  it("ukládá lastPositionSeconds přepisem, segment/watched jen nahoru", async () => {
    const db = drizzle(env.DB);
    await env.DB.prepare(
      "INSERT INTO course (id, title, slug, description, published) VALUES (810, 'c', 'c-810', '', 1)"
    ).run();
    await env.DB.prepare(
      "INSERT INTO module (id, courseId, title, slug, sortOrder) VALUES (820, 810, 'm', 'm-820', 1)"
    ).run();
    await env.DB.prepare(
      "INSERT INTO lesson (id, moduleId, publicId, title, slug, durationSeconds, isFree, sortOrder) VALUES (830, 820, 'p-830', 'l', 'l-830', 600, 1, 1)"
    ).run();
    await env.DB.prepare(
      "INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES ('u-rw', 'U', 'u-rw@test.cz', 1, 0, 0)"
    ).run();

    const t = new Date(1_000_000);
    await recordWatch(db, { userId: "u-rw", lessonId: 830, maxSegment: 5, watchedSeconds: 120, positionSeconds: 150 }, t);
    // posun zpět (přetočení): pozice klesne, ale segment/watched zůstanou nahoře
    await recordWatch(db, { userId: "u-rw", lessonId: 830, maxSegment: 2, watchedSeconds: 60, positionSeconds: 40 }, t);

    const { results } = await env.DB.prepare(
      "SELECT maxSegment, watchedSeconds, lastPositionSeconds FROM lesson_watch WHERE userId='u-rw' AND lessonId=830"
    ).all<{ maxSegment: number; watchedSeconds: number; lastPositionSeconds: number }>();
    const row = results[0];

    expect(row.maxSegment).toBe(5); // jen nahoru
    expect(row.watchedSeconds).toBe(120); // jen nahoru
    expect(row.lastPositionSeconds).toBe(40); // přepis poslední hodnotou
  });
});
```

- [ ] **Step 2: Spusť test — musí padat**

Run: `npm test -- watch-stats`
Expected: FAIL — `recordWatch` neukládá `lastPositionSeconds` (sloupec zůstane 0 nebo TS chyba u `positionSeconds`).

- [ ] **Step 3: Rozšiř `RecordWatchInput` a `recordWatch`**

V `src/lib/watch-stats.ts`:

V `RecordWatchInput` (řádek ~8) přidej pole:

```ts
export interface RecordWatchInput {
  userId: string;
  lessonId: number;
  maxSegment: number;
  watchedSeconds: number;
  positionSeconds: number;
}
```

V `recordWatch` po `const watchedSeconds = ...` (řádek ~29) přidej:

```ts
  const watchedSeconds = Math.max(0, Math.floor(input.watchedSeconds));
  const lastPositionSeconds = Math.max(0, Math.floor(input.positionSeconds));
```

Do `.values({...})` přidej `lastPositionSeconds,` (za `watchedSeconds,`).

V `.onConflictDoUpdate({ set: {...} })` přidej řádek (pozice = přepis, ne max):

```ts
      set: {
        maxSegment: sql`max(${lessonWatch.maxSegment}, ${maxSegment})`,
        watchedSeconds: sql`max(${lessonWatch.watchedSeconds}, ${watchedSeconds})`,
        lastPositionSeconds: lastPositionSeconds,
        updatedAt: now,
      },
```

- [ ] **Step 4: Spusť test — musí projít**

Run: `npm test -- watch-stats`
Expected: PASS.

- [ ] **Step 5: Ověř obsah a commit**

Run: `grep -c "lastPositionSeconds" src/lib/watch-stats.ts`
Expected: `>= 3`

```bash
git add src/lib/watch-stats.ts tests/lib/watch-stats.test.ts
git commit -m "watch: recordWatch ukládá lastPositionSeconds (přepisem)"
```

---

## Task 4: API `/api/watch/:lessonId` přijme `positionSeconds`

**Files:**
- Modify: `src/routes/progress.tsx:126-155`

- [ ] **Step 1: Rozšiř parsování těla a volání `recordWatch`**

V `src/routes/progress.tsx` v handleru `post("/api/watch/:lessonId", ...)`:

Za `let watchedSeconds = 0;` (řádek ~132) přidej:

```ts
  let maxSegment = 0;
  let watchedSeconds = 0;
  let positionSeconds = 0;
  try {
    const body = (await c.req.json()) as {
      maxSegment?: unknown;
      watchedSeconds?: unknown;
      positionSeconds?: unknown;
    };
    maxSegment = Number(body.maxSegment) || 0;
    watchedSeconds = Number(body.watchedSeconds) || 0;
    positionSeconds = Number(body.positionSeconds) || 0;
  } catch {
    return c.body(null, 400);
  }
```

Uprav volání `recordWatch` (řádek ~142):

```ts
  const { started } = await recordWatch(
    db,
    { userId: user.id, lessonId, maxSegment, watchedSeconds, positionSeconds },
    new Date()
  );
```

- [ ] **Step 2: Ověř obsah a typecheck**

Run: `grep -c "positionSeconds" src/routes/progress.tsx && npm run typecheck`
Expected: `3` a typecheck bez chyb.

- [ ] **Step 3: Commit**

```bash
git add src/routes/progress.tsx
git commit -m "watch: API /api/watch přijímá positionSeconds"
```

---

## Task 5: `generateSignedEmbedUrl` volitelný `startSeconds`

**Files:**
- Modify: `src/lib/bunny.ts:5-22`
- Test: `tests/lib/bunny.test.ts` (nový)

- [ ] **Step 1: Napiš padající test**

Create `tests/lib/bunny.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { generateSignedEmbedUrl } from "../../src/lib/bunny";

describe("generateSignedEmbedUrl — startSeconds", () => {
  it("bez startSeconds nemá parametr t", () => {
    const url = generateSignedEmbedUrl("lib1", "vid1", "key1");
    expect(url).not.toContain("&t=");
  });

  it("se startSeconds > 0 přidá &t=<vteřiny>", () => {
    const url = generateSignedEmbedUrl("lib1", "vid1", "key1", 4, 323);
    expect(url).toContain("&t=323");
    expect(url).toContain("autoplay=false");
  });

  it("startSeconds = 0 nepřidá parametr t", () => {
    const url = generateSignedEmbedUrl("lib1", "vid1", "key1", 4, 0);
    expect(url).not.toContain("&t=");
  });
});
```

- [ ] **Step 2: Spusť test — musí padat**

Run: `npm test -- bunny.test`
Expected: FAIL — funkce ignoruje 5. argument, `&t=323` chybí.

- [ ] **Step 3: Přidej parametr `startSeconds`**

V `src/lib/bunny.ts` uprav signaturu a return:

```ts
export function generateSignedEmbedUrl(
  libraryId: string,
  videoId: string,
  tokenKey: string,
  expiryHours = 4,
  startSeconds = 0
): string {
  const expires = Math.floor(Date.now() / 1000) + expiryHours * 3600;
  const url = `${BUNNY_EMBED_BASE}/${libraryId}/${videoId}`;
  const hashableBase = `${tokenKey}${videoId}${expires}`;

  const token = createHmac("sha256", tokenKey)
    .update(hashableBase)
    .digest("hex");

  // autoplay=false: video se po načtení stránky NEspouští automaticky.
  let embed = `${url}?token=${token}&expires=${expires}&autoplay=false`;
  // t=<vteřiny>: video naběhne na uloženou pozici (resume).
  if (startSeconds > 0) embed += `&t=${Math.floor(startSeconds)}`;
  return embed;
}
```

- [ ] **Step 4: Spusť test — musí projít**

Run: `npm test -- bunny.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/bunny.ts tests/lib/bunny.test.ts
git commit -m "watch: generateSignedEmbedUrl podporuje startSeconds (t param)"
```

---

## Task 6: Watch route — načti pozici, spočítej resume, sestav embed

**Files:**
- Modify: `src/routes/watch.tsx`

- [ ] **Step 1: Doplň importy**

V `src/routes/watch.tsx` uprav import schématu a watch-stats:

```ts
import { lesson, module, progress, lessonWatch } from "../db/schema";
import { shouldResume } from "../lib/watch-stats";
```

- [ ] **Step 2: Načti pozici uživatele pro tuto lekci**

V `Promise.all([...])` (řádek ~99) přidej 4. položku, která načte záznam `lessonWatch` pro přihlášeného uživatele a tuto lekci (jinak `[]`):

```ts
  const [allLessons, allProgressRaw, moduleRow, watchRow] = await Promise.all([
    // ... allLessons (beze změny) ...
    // ... allProgressRaw (beze změny) ...
    // ... moduleRow (beze změny) ...
    user
      ? db
          .select({ lastPositionSeconds: lessonWatch.lastPositionSeconds })
          .from(lessonWatch)
          .where(
            and(eq(lessonWatch.userId, user.id), eq(lessonWatch.lessonId, found.id))
          )
          .limit(1)
      : Promise.resolve([] as { lastPositionSeconds: number }[]),
  ]);
```

Doplň `and` do importu z drizzle-orm (řádek 2):

```ts
import { eq, asc, and } from "drizzle-orm";
```

- [ ] **Step 3: Spočítej resume a sestav embed s `t`**

Sekci `const embedUrl = ... generateSignedEmbedUrl(...)` (řádek ~91) přesuň ZA výpočet `completed` a `watchRow` (potřebuje obě hodnoty), nebo nech načtení nahoře a embed sestav níž. Konkrétně — po výpočtu `const completed = ...` (řádek ~129) přidej:

```ts
  const lastPosition = watchRow[0]?.lastPositionSeconds ?? 0;
  const resumePosition = shouldResume(lastPosition, found.durationSeconds, completed)
    ? lastPosition
    : null;
```

A `embedUrl` sestav s `resumePosition` (nahraď původní definici embedUrl, řádek ~91; přesuň ji sem, pod výpočet `resumePosition`):

```ts
  const embedUrl = found.bunnyVideoId
    ? generateSignedEmbedUrl(
        c.env.BUNNY_LIBRARY_ID,
        found.bunnyVideoId,
        c.env.BUNNY_TOKEN_KEY,
        4,
        resumePosition ?? 0
      )
    : "";
```

> Pozn.: původní `const embedUrl` na řádku ~91 odstraň, ať není definovaný dvakrát.

- [ ] **Step 4: Předej `resumePosition` do view**

V `<WatchPage ... />` přidej prop:

```tsx
      loggedIn={Boolean(user)}
      resumePosition={resumePosition}
```

- [ ] **Step 5: Typecheck (selže na chybějícím propu — to je OK, doplníme v Task 7)**

Run: `npm run typecheck`
Expected: chyba „`resumePosition` does not exist on type WatchProps" — to je očekávané.

> **Task 6 se necommituje samostatně** — `src/routes/watch.tsx` je v mezi-stavu, který bez Tasku 7 nekompiluje. Oba soubory (`watch.tsx` route i view) commitne až Task 7 step 7.

---

## Task 7: View — odeslání pozice + lišta „pokračuješ od…"

**Files:**
- Modify: `src/views/watch.tsx`

- [ ] **Step 1: Přidej prop do `WatchProps` a destrukturuj**

V `src/views/watch.tsx` do interface `WatchProps` (řádek ~22) přidej:

```ts
  nearbyLessons?: SidebarLesson[];
  lessonGlobalIndex?: number;
  resumePosition?: number | null;
```

A do destrukturace komponenty (řádek ~90) přidej `resumePosition,`.

- [ ] **Step 2: Přidej lištu „pokračuješ od…" nad video**

Hned za `<div class="video-wrap"> ... </div>` (po řádku ~149, před `{/* Lesson info */}`) vlož:

```tsx
            {embedUrl && resumePosition ? (
              <div id="resume-bar" class="resume-bar">
                <span class="resume-bar-text">
                  <PlaySmIcon /> Pokračuješ od {formatDuration(resumePosition)}
                </span>
                <button type="button" id="resume-restart" class="btn btn-ghost btn-sm">
                  od začátku
                </button>
              </div>
            ) : null}
```

- [ ] **Step 3: Přidej styl lišty**

Do `<style>{`...`}</style>` bloku (řádek ~331) přidej:

```css
        .resume-bar {
          display: flex; align-items: center; justify-content: space-between;
          gap: 12px; margin-top: 10px; padding: 8px 12px;
          background: var(--surface, rgba(255,255,255,0.04));
          border: 1px solid var(--border); border-radius: 8px;
          font-family: var(--font-mono); font-size: 0.82rem; color: var(--muted);
        }
        .resume-bar-text { display: inline-flex; align-items: center; gap: 6px; }
```

- [ ] **Step 4: Klient — odesílej `positionSeconds` v heartbeatu**

V inline `<script>` v bloku watch-tracking (řádek ~408) uprav payload tak, aby obsahoval poslední pozici. `lastTime` už v handleru existuje. Najdi:

```js
                  var payload = JSON.stringify({ maxSegment: maxSegment, watchedSeconds: Math.round(watchedSeconds) });
```

a nahraď:

```js
                  var payload = JSON.stringify({ maxSegment: maxSegment, watchedSeconds: Math.round(watchedSeconds), positionSeconds: Math.round(lastTime) });
```

- [ ] **Step 5: Klient — „od začátku" a auto-schování lišty**

V inline `<script>`, uvnitř IIFE po vytvoření `var player = new window.playerjs.Player(iframe);` (řádek ~345) přidej:

```js
              var resumeBar = document.getElementById('resume-bar');
              var restartBtn = document.getElementById('resume-restart');
              if (restartBtn) {
                restartBtn.addEventListener('click', function () {
                  player.setCurrentTime(0);
                  if (resumeBar) resumeBar.style.display = 'none';
                });
              }
              if (resumeBar) {
                player.on('play', function () { resumeBar.style.display = 'none'; });
              }
```

- [ ] **Step 6: Ověř obsah, typecheck a testy**

Run: `grep -c "positionSeconds\|resume-bar\|resumePosition" src/views/watch.tsx && npm run typecheck && npm test`
Expected: `>= 4`, typecheck bez chyb, všechny testy zelené.

- [ ] **Step 7: Commit**

```bash
git add src/routes/watch.tsx src/views/watch.tsx
git commit -m "watch: auto-skok na uloženou pozici + lišta 'pokračuješ od…' s volbou od začátku"
```

---

## Po nasazení

Commit obsahuje novou migraci `drizzle/migrations/0020_*.sql`, takže **po `npm run deploy`** spusť:

```bash
npm run db:migrate:prod
```

Bez toho sloupec `lastPositionSeconds` na produkční D1 chybí a `/api/watch` i render lekce spadnou.

---

## Manuální ověření (po deployi)

1. Přihlas se, pusť libovolnou lekci, přehraj ~1 minutu, zavři tab.
2. Otevři lekci znovu → video stojí na ~1:00, nad ním lišta „Pokračuješ od 1:00".
3. Klikni „od začátku" → video skočí na 0:00, lišta zmizí.
4. Otevři lekci, kterou jsi nikdy nepustil → bez lišty, start od 0.
5. Dokonči lekbu (nebo dojeď ke konci) → příště start od 0, bez lišty.
