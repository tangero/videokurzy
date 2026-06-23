import type { FC } from "hono/jsx";
import { Layout } from "./layout";
import { AdminNav } from "./admin-courses";
import type { ResendAutomationStat } from "../lib/resend";

export interface AdminStatsData {
  buyers: {
    paidCount: number;
    revenueCzk: number;
    stripeActive: number;
    fioActive: number;
    withIco: number;
    noAccount: number;
    notStarted: number;
    accounts: number;
  };
  funnel: { title: string; durationSeconds: number; completions: number }[];
  videos: {
    title: string;
    isFree: boolean;
    views: number;
    watchTimeSeconds: number;
    engagementScore: number;
    completions: number;
    retention: number[];
    syncedAt: number | null;
  }[];
}

function fmtDuration(seconds: number): string {
  if (!seconds || seconds < 0) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

function fmtDate(ts: number | null): string {
  if (!ts) return "nikdy";
  const d = new Date(ts * 1000);
  return d.toLocaleDateString("cs-CZ");
}

// Kompaktní metrika — definiční řádek (label vlevo, hodnota vpravo), ne
// "hero metric" karta. Plochá hierarchie dle .impeccable.md.
const Metric: FC<{ label: string; value: string; hint?: string; tone?: "warn" }> = ({
  label,
  value,
  hint,
  tone,
}) => (
  <div class="flex items-baseline justify-between gap-4 py-2">
    <div class="text-sm text-gray-600">
      {label}
      {hint ? <span class="ml-2 text-xs text-gray-500">{hint}</span> : null}
    </div>
    <div class={`text-base font-semibold tabular-nums ${tone === "warn" ? "text-amber-600" : "text-gray-900"}`}>
      {value}
    </div>
  </div>
);

// Retenční sparkline — 20 segmentů, výška = podíl diváků, kteří segment dosáhli
// (vůči segmentu 0). Vizuálně ukazuje, kde diváci odcházejí.
const Sparkline: FC<{ curve: number[] }> = ({ curve }) => {
  const top = curve[0] || 1;
  return (
    <div class="flex h-6 items-end gap-px" title="Retence po segmentech videa (kde diváci odcházejí)">
      {curve.map((v) => {
        const h = Math.max(6, Math.round((v / top) * 100));
        return <div class="w-1 rounded-sm bg-indigo-500" style={`height:${h}%`}></div>;
      })}
    </div>
  );
};

export const AdminStatsPage: FC<{
  user: { name: string | null; email: string };
  data: AdminStatsData;
  lastSync: number | null;
  videoStatsSynced?: number;
  videoStatsErrors?: number;
  videoStatsError?: string;
  resend?: ResendAutomationStat[] | null;
}> = ({ user, data, lastSync, videoStatsSynced, videoStatsErrors, videoStatsError, resend }) => {
  const { buyers, funnel, videos } = data;
  return (
    <Layout title="Statistiky" user={user}>
      <section class="max-w-5xl mx-auto px-4 py-8">
        <h1 class="text-2xl font-bold mb-6">Admin</h1>
        <AdminNav active="/admin/stats" />

        <div class="mt-6 space-y-10">
          {videoStatsSynced !== undefined && (
            <div class="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
              ✓ Bunny statistiky úspěšně aktualizovány. 
              Synced: <strong>{videoStatsSynced}</strong> videí
              {videoStatsErrors ? `, chyb: ${videoStatsErrors}` : ""}.
            </div>
          )}
          {videoStatsError && (
            <div class="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              ✕ Chyba při synchronizaci Bunny statistik: {videoStatsError}
            </div>
          )}

          <div class="flex items-center justify-between mb-2">
            <p class="text-sm text-gray-600">
              Profil kupujících, sledovanost a aktivace. Bunny data poslední sync:{" "}
              <strong>{fmtDate(lastSync)}</strong>.
            </p>
            <form method="post" action="/admin/api/video-stats/sync" hx-boost="false">
              <button
                type="submit"
                class="text-xs bg-gray-900 text-white px-3 py-1.5 rounded hover:bg-gray-700"
                title="Ručně stáhne aktuální statistiky ze všech videí na Bunny.net (stejně jako noční cron)"
              >
                Sync Bunny stats teď
              </button>
            </form>
          </div>

          {/* Kupující */}
          <section>
            <h2 class="mb-2 text-lg font-semibold text-gray-900">Kupující</h2>
            <div class="grid gap-x-10 sm:grid-cols-2">
              <div class="divide-y divide-gray-100">
                <Metric label="Platící objednávky" value={String(buyers.paidCount)} />
                <Metric label="Tržby" value={`${buyers.revenueCzk.toLocaleString("cs-CZ")} Kč`} />
                <Metric label="Stripe / FIO (aktivní)" value={`${buyers.stripeActive} / ${buyers.fioActive}`} />
                <Metric label="S IČO (chce fakturu)" value={String(buyers.withIco)} />
              </div>
              <div class="divide-y divide-gray-100">
                <Metric label="Účty celkem" value={String(buyers.accounts)} />
                <Metric
                  label="Zaplatil bez účtu"
                  hint="nepřihlásil se → nemá přístup"
                  value={String(buyers.noAccount)}
                  tone={buyers.noAccount > 0 ? "warn" : undefined}
                />
                <Metric
                  label="Nerozkoukáno"
                  hint="má účet, 0 dokončených lekcí"
                  value={String(buyers.notStarted)}
                  tone={buyers.notStarted > 0 ? "warn" : undefined}
                />
              </div>
            </div>
          </section>

          {/* Sledovanost videí (bunny) */}
          <section>
            <h2 class="mb-2 text-lg font-semibold text-gray-900">Sledovanost videí (bunny.net)</h2>
            {videos.length === 0 ? (
              <p class="text-sm text-gray-600">
                Zatím žádná data — cron je stáhne při dalším běhu (denně 03:00 UTC).
              </p>
            ) : (
              <div class="overflow-x-auto rounded-xl border border-gray-200">
                <table class="min-w-full divide-y divide-gray-200 text-sm">
                  <thead class="bg-gray-50 text-left text-xs uppercase text-gray-600">
                    <tr>
                      <th scope="col" class="px-4 py-2 font-semibold">Lekce</th>
                      <th scope="col" class="px-4 py-2 text-right font-semibold">Zhlédnutí</th>
                      <th scope="col" class="px-4 py-2 text-right font-semibold">Odsledováno</th>
                      <th scope="col" class="px-4 py-2 text-right font-semibold">Engagement</th>
                      <th scope="col" class="px-4 py-2 text-right font-semibold">Dokončení</th>
                      <th scope="col" class="px-4 py-2 font-semibold">Retence</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-gray-100">
                    {videos.map((v) => (
                      <tr class={v.isFree ? "bg-emerald-50/70" : ""}>
                        <td class="px-4 py-2 text-gray-900">
                          {v.title}
                          {v.isFree && (
                            <span class="ml-2 inline-block rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 align-middle">
                              ZDARMA
                            </span>
                          )}
                        </td>
                        <td class="px-4 py-2 text-right tabular-nums">{v.views}</td>
                        <td class="px-4 py-2 text-right tabular-nums">{fmtDuration(v.watchTimeSeconds)}</td>
                        <td class="px-4 py-2 text-right tabular-nums">{v.engagementScore}/100</td>
                        <td class="px-4 py-2 text-right tabular-nums">
                          {v.completions}
                          {v.views > 0 ? (
                            <span class="text-gray-500">
                              {" "}
                              ({Math.round((v.completions / v.views) * 100)} %)
                            </span>
                          ) : null}
                        </td>
                        <td class="px-4 py-2">
                          {v.retention && v.retention.length > 0 ? (
                            <Sparkline curve={v.retention} />
                          ) : (
                            <span 
                              class="text-gray-400 cursor-help" 
                              title="Zatím žádná data o sledování této lekce. Retenční křivka se začne plnit, jakmile uživatelé začnou video sledovat přes player."
                            >
                              —
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p class="mt-2 text-xs text-gray-500">
              Pozn.: jednotka „odsledováno" z bunny se ještě ověřuje — ber zatím relativně, ne absolutně.
            </p>
          </section>

          {/* Trychtýř dokončení */}
          <section>
            <h2 class="mb-3 text-lg font-semibold text-gray-900">Trychtýř dokončení</h2>
            <div class="space-y-3">
              {funnel.map((l) => {
                const top = funnel[0]?.completions || 1;
                const pct = Math.round((l.completions / top) * 100);
                return (
                  <div>
                    <div class="flex justify-between text-sm">
                      <span class="text-gray-700">{l.title}</span>
                      <span class="text-gray-600 tabular-nums">{l.completions}</span>
                    </div>
                    <div class="mt-1 h-2 rounded bg-gray-100">
                      <div class="h-2 rounded bg-indigo-600" style={`width:${pct}%`}></div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* E-mailové automatizace (Resend) — počty běhů per automation */}
          <section>
            <div class="mb-3 flex items-baseline justify-between">
              <h2 class="text-lg font-semibold text-gray-900">E-mailové automatizace</h2>
              <a
                href="https://resend.com/automations"
                target="_blank"
                rel="noreferrer"
                class="text-xs text-indigo-600 hover:underline"
              >
                Resend dashboard ↗
              </a>
            </div>
            {resend === undefined || resend === null ? (
              <p class="text-sm text-gray-500">
                Statistiky z Resendu se nepodařilo načíst (chybí klíč nebo výpadek API).
              </p>
            ) : resend.length === 0 ? (
              <p class="text-sm text-gray-500">V Resendu zatím nejsou žádné automatizace.</p>
            ) : (
              <div class="overflow-x-auto">
                <table class="w-full text-sm">
                  <thead>
                    <tr class="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                      <th class="py-2 pr-4 font-medium">Automatizace</th>
                      <th class="py-2 px-2 text-right font-medium">Běhů</th>
                      <th class="py-2 px-2 text-right font-medium">Dokončeno</th>
                      <th class="py-2 px-2 text-right font-medium">Probíhá</th>
                      <th class="py-2 px-2 text-right font-medium">Selhalo</th>
                      <th class="py-2 pl-2 text-right font-medium">Zrušeno</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resend.map((a) => (
                      <tr class="border-b border-gray-100">
                        <td class="py-2 pr-4">
                          <span class="text-gray-800">{a.name}</span>
                          {a.status !== "enabled" ? (
                            <span class="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700">
                              {a.status}
                            </span>
                          ) : null}
                        </td>
                        <td class="py-2 px-2 text-right font-semibold tabular-nums text-gray-900">{a.total}</td>
                        <td class="py-2 px-2 text-right tabular-nums text-gray-600">{a.completed}</td>
                        <td class="py-2 px-2 text-right tabular-nums text-gray-600">{a.running}</td>
                        <td class={`py-2 px-2 text-right tabular-nums ${a.failed > 0 ? "text-amber-600" : "text-gray-600"}`}>{a.failed}</td>
                        <td class="py-2 pl-2 text-right tabular-nums text-gray-600">{a.cancelled}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </section>
    </Layout>
  );
};
