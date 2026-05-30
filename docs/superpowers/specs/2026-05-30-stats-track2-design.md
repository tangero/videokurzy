# Track ② — Player.js watch-time + retenční křivka (spec)

> **Datum:** 2026-05-30
> **Cíl:** Měřit reálné sledování videí — kde přesně diváci odcházejí (retenční
> křivka), kolik odsledovali, a emitovat `lesson.started` pro re-engagement na
> early-droppery (ty, co video pustili ale nedokončili).

## Kontext / co už platí
- `watch.tsx` už player.js **používá** (ř. 334–367) — instance přehrávače,
  `timeupdate` handler (prázdný), volá se přes IIFE. Žádný bug.
- **Omezení:** skript je pod `embedUrl && chapters.length > 0` → lekce bez
  kapitol player.js vůbec nenačtou. Track ② to musí rozšířit na `embedUrl`.
- `progress` = jen „dokončeno". `video_stats` = agregát z bunny (Track ①).
- `lesson.completed` event už emitujeme (Track Resend). `lesson.started` chybí.
- Auth: `requireAuth`; progress endpoint vzor v `routes/progress.tsx`.

## Datový model

Jedna tabulka, per-user max pozice — z ní se spočítá retenční křivka i watch-time
bez záplavy řádků (dedup per uživatel automaticky).

```ts
export const lessonWatch = sqliteTable("lesson_watch", {
  userId: text("userId").notNull().references(() => user.id, { onDelete: "cascade" }),
  lessonId: integer("lessonId").notNull().references(() => lesson.id, { onDelete: "cascade" }),
  // Nejvyšší dosažený segment (0..SEGMENTS-1). Z toho retenční křivka:
  // pro segment s = count(userId WHERE maxSegment >= s).
  maxSegment: integer("maxSegment").notNull().default(0),
  // Suma reálně odsledovaného času v sekundách (přičítá se z heartbeatu;
  // přetáčení nezvyšuje uměle — počítáme jen postup reálného času).
  watchedSeconds: integer("watchedSeconds").notNull().default(0),
  startedAt: integer("startedAt", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull(),
}, (t) => [primaryKey({ columns: [t.userId, t.lessonId] })]);
```

- **SEGMENTS = 20** (křivka po 5 % délky). Segment = `floor(currentTime / duration * 20)`.
- Migrace ručně: `drizzle/migrations/0018_lesson_watch.sql` (drizzle-kit rozbité).

## Frontend (watch.tsx)
1. Načítat player.js **vždy při `embedUrl`** (ne jen s kapitolami). Refactor:
   oddělit „player + tracking" (vždy) od „chapter buttons" (jen když jsou).
2. Tracking v `timeupdate`:
   - z `event.seconds` + `event.duration` spočítat aktuální segment.
   - držet `maxSegment` v paměti; odhad `watchedSeconds` z postupu času
     (ignorovat skoky > prahu = přetáčení).
3. Na `play` (poprvé): označit start.
4. **Heartbeat**: poslat stav na endpoint periodicky (~každých 20 s) + na
   `pause`/`ended`/`visibilitychange`/`pagehide` přes `navigator.sendBeacon`
   (přežije zavření tabu).
5. Tracking jen pro přihlášené (`hasPaidAccess`/`user`) — anonym nemá userId.

## Backend
- `POST /api/watch/:lessonId` (`requireAuth`): body `{ maxSegment, watchedSeconds }`.
  Upsert do `lesson_watch` (`onConflictDoUpdate`): `maxSegment = max(staré, nové)`,
  `watchedSeconds = max(staré, nové)` (klient posílá kumulativ za session;
  max brání regresi při více tabech). Idempotentní, levné.
- První zápis pro daného usera+lekci → emit `lesson.started` (Resend
  re-engagement). Detekce: řádek ještě neexistoval.
- `lib/watch-stats.ts`: `recordWatch()` + `getRetentionCurve(lessonId)` →
  pole 20 čísel (kolik diváků dosáhlo segment s).

## Admin UI (rozšíření /admin/stats)
- Do tabulky „Sledovanost videí" přidat **mini retenční křivku** (sparkline
  z 20 segmentů) nebo „medián dosaženého %": kde polovina diváků skončila.
- Detail (volitelně později): plný graf křivky per lekce.

## Pořadí implementace (po krocích, s testy)
1. Migrace `0018` + schema `lessonWatch`.
2. `lib/watch-stats.ts` (`recordWatch`, `getRetentionCurve`) + testy.
3. Endpoint `POST /api/watch/:lessonId` + emit `lesson.started`.
4. Frontend: refactor player.js (vždy) + tracking + heartbeat/sendBeacon.
5. Admin UI: retence do /admin/stats.
6. `typecheck && test` → deploy → **`db:migrate:prod`**.

## Rizika / pozn.
- **Přesnost watchedSeconds**: timeupdate ~4×/s; akumulovat jen kladné malé
  přírůstky reálného času, skoky = seek, neúčtovat. Není to přesné na sekundu,
  ale na retenční křivku (segmentový max) stačí.
- **sendBeacon** posílá POST bez custom hlaviček snadno → endpoint musí brát
  cookie auth (better-auth session cookie jde s beaconem automaticky).
- **Bez kapitol dnes tracking neběží** → po refactoru poběží všude (bonus:
  i dříve netrackované lekce).
- SEGMENTS=20 je kompromis granularita/úložiště; lze zvýšit bez migrace
  (jen víc hodnot v maxSegment).
```
