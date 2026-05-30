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

const Card: FC<{ label: string; value: string; hint?: string; tone?: "ok" | "warn" }> = ({
  label,
  value,
  hint,
  tone,
}) => (
  <div class="rounded-lg border border-gray-200 bg-white p-4">
    <div class="text-sm text-gray-500">{label}</div>
    <div
      class={`mt-1 text-2xl font-bold ${
        tone === "warn" ? "text-amber-600" : tone === "ok" ? "text-emerald-600" : "text-gray-900"
      }`}
    >
      {value}
    </div>
    {hint ? <div class="mt-1 text-xs text-gray-400">{hint}</div> : null}
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
      <AdminNav active="/admin/stats" />

      <div class="space-y-8">
        <div>
          <h1 class="text-2xl font-bold text-gray-900">Statistiky</h1>
          <p class="mt-1 text-sm text-gray-500">
            Profil kupujících, sledovanost a aktivace. Bunny data poslední sync:{" "}
            {fmtDate(lastSync)}.
          </p>
        </div>

        {/* Kupující */}
        <section>
          <h2 class="mb-3 text-lg font-semibold text-gray-900">Kupující</h2>
          <div class="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Card label="Platící objednávky" value={String(buyers.paidCount)} />
            <Card label="Tržby" value={`${buyers.revenueCzk.toLocaleString("cs-CZ")} Kč`} />
            <Card label="Stripe / FIO (aktivní)" value={`${buyers.stripeActive} / ${buyers.fioActive}`} />
            <Card label="S IČO (chce fakturu)" value={String(buyers.withIco)} />
          </div>
          <div class="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Card label="Účty celkem" value={String(buyers.accounts)} />
            <Card
              label="Zaplatil bez účtu"
              value={String(buyers.noAccount)}
              hint="nepřihlásil se → nemá přístup"
              tone={buyers.noAccount > 0 ? "warn" : "ok"}
            />
            <Card
              label="Nerozkoukáno"
              value={String(buyers.notStarted)}
              hint="má účet, 0 dokončených lekcí"
              tone={buyers.notStarted > 0 ? "warn" : "ok"}
            />
          </div>
        </section>

        {/* Sledovanost videí (bunny) */}
        <section>
          <h2 class="mb-3 text-lg font-semibold text-gray-900">Sledovanost videí (bunny.net)</h2>
          {videos.length === 0 ? (
            <p class="text-sm text-gray-500">
              Zatím žádná data — cron je stáhne při dalším běhu (denně 03:00 UTC).
            </p>
          ) : (
            <div class="overflow-x-auto rounded-lg border border-gray-200">
              <table class="min-w-full divide-y divide-gray-200 text-sm">
                <thead class="bg-gray-50 text-left text-xs uppercase text-gray-500">
                  <tr>
                    <th class="px-4 py-2">Lekce</th>
                    <th class="px-4 py-2 text-right">Zhlédnutí</th>
                    <th class="px-4 py-2 text-right">Odsledováno</th>
                    <th class="px-4 py-2 text-right">Engagement</th>
                    <th class="px-4 py-2 text-right">Dokončení</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-gray-100">
                  {videos.map((v) => (
                    <tr>
                      <td class="px-4 py-2 text-gray-900">{v.title}</td>
                      <td class="px-4 py-2 text-right">{v.views}</td>
                      <td class="px-4 py-2 text-right">{fmtDuration(v.watchTimeSeconds)}</td>
                      <td class="px-4 py-2 text-right">{v.engagementScore}/100</td>
                      <td class="px-4 py-2 text-right">
                        {v.completions}
                        {v.views > 0 ? (
                          <span class="text-gray-400">
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
          <p class="mt-2 text-xs text-gray-400">
            Pozn.: jednotka „odsledováno" z bunny se ještě ověřuje — ber zatím relativně, ne absolutně.
          </p>
        </section>

        {/* Trychtýř dokončení */}
        <section>
          <h2 class="mb-3 text-lg font-semibold text-gray-900">Trychtýř dokončení</h2>
          <div class="space-y-2">
            {funnel.map((l) => {
              const top = funnel[0]?.completions || 1;
              const pct = Math.round((l.completions / top) * 100);
              return (
                <div>
                  <div class="flex justify-between text-sm">
                    <span class="text-gray-700">{l.title}</span>
                    <span class="text-gray-500">{l.completions}</span>
                  </div>
                  <div class="mt-1 h-2 rounded bg-gray-100">
                    <div class="h-2 rounded bg-gray-900" style={`width:${pct}%`}></div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </Layout>
  );
};
