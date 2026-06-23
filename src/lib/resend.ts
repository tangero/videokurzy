/**
 * Send a Resend Automation event.
 * Uses raw fetch to match the existing pattern in auth.ts.
 * Endpoint je /events/send (ne /events) — jinak event nedorazí a automation
 * se nikdy nespustí (Runs zůstanou na 0).
 * @see https://resend.com/docs/api-reference/events/send-event
 */
export async function sendResendEvent(
  apiKey: string,
  event: string,
  email: string,
  payload?: Record<string, unknown>
): Promise<boolean> {
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
      return false;
    }
    return true;
  } catch (err) {
    console.error(`Resend event '${event}' error:`, err);
    return false;
  }
}
