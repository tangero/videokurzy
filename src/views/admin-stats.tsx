import type { FC } from "hono/jsx";
import { Layout } from "./layout";
import { AdminNav } from "./admin-courses";

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
    views: number;
    watchTimeSeconds: number;
    engagementScore: number;
    completions: number;
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

export const AdminStatsPage: FC<{
  user: { name: string | null; email: string };
  data: AdminStatsData;
  lastSync: number | null;
}> = ({ user, data, lastSync }) => {
  const { buyers, funnel, videos } = data;
  return (
    <Layout title="Statistiky" user={user}>
      <section class="max-w-5xl mx-auto px-4 py-8">
        <h1 class="text-2xl font-bold mb-6">Admin</h1>
        <AdminNav active="/admin/stats" />

        <div class="mt-6 space-y-10">
          <p class="text-sm text-gray-600">
            Profil kupujících, sledovanost a aktivace. Bunny data poslední sync:{" "}
            {fmtDate(lastSync)}.
          </p>

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
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-gray-100">
                    {videos.map((v) => (
                      <tr>
                        <td class="px-4 py-2 text-gray-900">{v.title}</td>
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
        </div>
      </section>
    </Layout>
  );
};
