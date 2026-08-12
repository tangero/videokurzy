/**
 * Send a Resend Automation event.
 * Uses raw fetch to match the existing pattern in auth.ts.
 * Endpoint je /events/send (ne /events) — jinak event nedorazí a automation
 * se nikdy nespustí (Runs zůstanou na 0).
 * @see https://resend.com/docs/api-reference/events/send-event
 */
/**
 * Výsledek pokusu o odeslání události.
 *
 * `"failed"` a `"unknown"` se musí rozlišovat: u `"failed"` server odpověděl
 * chybou, takže událost prokazatelně neprošla a je bezpečné ji poslat znovu.
 * U `"unknown"` (timeout, přerušené spojení) se požadavek mohl doručit a jen
 * se ztratila odpověď — opakování by pak znamenalo druhý onboarding.
 */
export type ResendEventOutcome = "sent" | "failed" | "unknown";

export async function sendResendEvent(
  apiKey: string,
  event: string,
  email: string,
  payload?: Record<string, unknown>
): Promise<ResendEventOutcome> {
  try {
    const res = await fetch("https://api.resend.com/events/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ event, email, payload }),
    });
    if (!res.ok) {
      console.error(`Resend event '${event}' failed: ${res.status}`);
      // 5xx a 429 mohou znamenat, že událost přesto proběhla (proxy/timeout na
      // straně serveru), takže je bereme jako neurčité; 4xx je jednoznačné
      // odmítnutí (validace, autentizace) a událost prokazatelně nevznikla.
      return res.status >= 500 || res.status === 429 ? "unknown" : "failed";
    }
    return "sent";
  } catch (err) {
    // Síťová chyba: nevíme, jestli požadavek dorazil.
    console.error(`Resend event '${event}' error:`, err);
    return "unknown";
  }
}

/** Přehled běhů jedné automation pro admin/Statistiky. */
export interface ResendAutomationStat {
  id: string;
  name: string;
  status: string;
  running: number;
  completed: number;
  failed: number;
  cancelled: number;
  total: number;
}

interface ResendListItem {
  id: string;
  name: string;
  status: string;
}
interface ResendRun {
  status: string;
}

/**
 * Načte z Resend API přehled automations a počty jejich běhů per status.
 * Volá GET /automations + paralelně GET /automations/{id}/runs.
 * @see https://resend.com/docs/api-reference/automations/list-automations
 * @see https://resend.com/docs/api-reference/automations/list-automation-runs
 *
 * Vrací null při jakékoli chybě (chybějící klíč, výpadek Resendu, restricted
 * klíč) — volající (admin/stats) tím jen vynechá sekci, zbytek statistik jede.
 */
export async function fetchResendAutomationStats(
  apiKey: string,
): Promise<ResendAutomationStat[] | null> {
  if (!apiKey) return null;
  const auth = { Authorization: `Bearer ${apiKey}` };
  try {
    const listRes = await fetch("https://api.resend.com/automations", {
      headers: auth,
    });
    if (!listRes.ok) {
      console.error(`Resend automations list failed: ${listRes.status}`);
      return null;
    }
    const list = (await listRes.json()) as { data?: ResendListItem[] };
    const automations = list.data ?? [];

    return await Promise.all(
      automations.map(async (a): Promise<ResendAutomationStat> => {
        const counts = { running: 0, completed: 0, failed: 0, cancelled: 0 };
        // total = VŠECHNY běhy, ne jen čtyři známé statusy — kdyby Resend přidal
        // nový status (queued/scheduled…), nesmí vypadnout z celkového počtu.
        let total = 0;
        try {
          // Limit nahoru, ať jedna stránka pokryje i automation s mnoha běhy
          // (Resend default page je malý → bez toho by se počty podhodnotily).
          const runsRes = await fetch(
            `https://api.resend.com/automations/${a.id}/runs?limit=100`,
            { headers: auth },
          );
          if (runsRes.ok) {
            const runs = (await runsRes.json()) as { data?: ResendRun[] };
            for (const r of runs.data ?? []) {
              total++;
              if (r.status in counts) counts[r.status as keyof typeof counts]++;
            }
          }
        } catch (err) {
          console.error(`Resend runs for ${a.id} failed:`, err);
        }
        return { id: a.id, name: a.name, status: a.status, ...counts, total };
      }),
    );
  } catch (err) {
    console.error("Resend automations stats error:", err);
    return null;
  }
}
