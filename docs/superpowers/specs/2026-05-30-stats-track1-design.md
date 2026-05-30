# Track ① — Bunny statistiky → D1 → Admin dashboard (spec)

> **Datum:** 2026-05-30
> **Cíl:** Odpovědět „jak dlouho se lidé dívají" a konsolidovat Vlnu 0 do
> samoobslužného admin přehledu. Bunny statistiky se tahají server-side z workeru
> (ostré bunny creds jsou jen v Cloudflare secrets, ne v `.dev.vars`).

## Kontext / co už platí
- Lekce mají reálné bunny GUID v `lesson.bunnyVideoId` (ověřeno).
- Bunny API se v projektu volá přes `src/lib/transcribe.ts`: base
  `https://video.bunnycdn.com`, hlavička `AccessKey: env.BUNNY_API_KEY`,
  knihovna `env.BUNNY_LIBRARY_ID`.
- Cron běží denně (`0 3 * * *`) přes `handleScheduled` v `src/scheduled.ts`,
  který spouští joby přes `Promise.allSettled([...])`.
- Admin má `requireAdmin` middleware; admin routy v `src/routes/admin.tsx`.
- `progress` = jen „dokončeno" (žádný watch-time) → bunny doplní reálný čas.

## Komponenty

### 1. Migrace — tabulka `video_stats`
Snapshot agregátu na video (jedna řádka/video, upsert při každém synci).
YAGNI: zatím bez time-series.

```ts
export const videoStats = sqliteTable("video_stats", {
  videoGuid: text("videoGuid").primaryKey(),       // = lesson.bunnyVideoId
  views: integer("views").notNull().default(0),
  watchTimeSeconds: integer("watchTimeSeconds").notNull().default(0),
  engagementScore: integer("engagementScore").notNull().default(0), // 0–100
  syncedAt: integer("syncedAt", { mode: "timestamp" }).notNull(),
});
```
- `npm run db:generate` → nová migrace; po deployi **`npm run db:migrate:prod`**.

### 2. Lib `src/lib/bunny-stats.ts`
```ts
fetchVideoStatistics(env, videoGuid): Promise<{views; watchTimeSeconds; engagementScore}>
```
- `GET {BASE}/library/{LIBRARY_ID}/statistics?videoGuid={guid}&dateFrom={launch}`
  s `AccessKey`.
- Odpověď: `viewsChart`, `watchTimeChart` (mapy den→hodnota), `engagementScore`.
- Vrátit součet `viewsChart` a `watchTimeChart` + `engagementScore`.
- Pozor na jednotky `watchTimeChart` (ověřit při implementaci — pravděpodobně
  minuty nebo sekundy; podle toho normalizovat na sekundy).
- Síťové chyby: log + vrátit nuly, neshazovat cron.

### 3. Cron job v `src/scheduled.ts`
- Nová funkce `syncVideoStats(env)`, přidat do `Promise.allSettled` v `handleScheduled`.
- Načíst všechny `lesson.bunnyVideoId` (non-null), pro každé zavolat
  `fetchVideoStatistics`, upsert do `video_stats` (`onConflictDoUpdate` na `videoGuid`).
- Sekvenčně nebo malé dávky — neuDDOSovat bunny.

### 4. Admin stránka `GET /admin/stats`
View `src/views/admin-stats.tsx`, chráněno `requireAdmin`. Sekce:
- **Kupující** (z Vlny 0 dotazů): B2B/B2C split, platby Stripe/FIO, revenue,
  díry v aktivaci (zaplatil bez účtu, nerozkoukáno).
- **Trychtýř dokončení** lekcí (z `progress`, řazeno dle pořadí).
- **Bunny per-video** (join `lesson` × `video_stats`): views, watch-time,
  engagement, + completion rate (dokončení / views).
- Vše jen čtení; čísla z `video_stats` (poslední sync) + živé dotazy nad D1.

## Pořadí implementace (po krocích, s testy)
1. Migrace + schema (`video_stats`) → `db:generate`, `db:migrate` lokálně.
2. `bunny-stats.ts` + unit test (mock fetch, ověřit součet charts).
3. Cron job + zapojení do `handleScheduled`.
4. Admin view + route.
5. `npm run typecheck && npm test` → deploy → **`db:migrate:prod`** → ručně
   spustit/ověřit sync.

## Mimo rozsah (další Tracky)
- Granulární retenční křivka (kde v minutáži lidé odcházejí) → Track ② (player.js).
- `lesson.started` / play tracking → Track ②.
- Dotazník → Track ③.

## Rizika / pozn.
- **Jednotka watch-time** z bunny — ověřit empiricky při implementaci.
- Bunny rate limity — sync 6 videí denně je triviální, ale ošetřit chyby per-video.
- `engagementScore` je per-video (na úrovni knihovny chybí).
