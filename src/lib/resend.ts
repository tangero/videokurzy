/**
 * Send a Resend Automation event.
 * Uses raw fetch to match the existing pattern in auth.ts.
 * @see https://resend.com/docs/api-reference/events/send
 */
export async function sendResendEvent(
  apiKey: string,
  event: string,
  email: string,
  payload?: Record<string, unknown>
): Promise<void> {
  try {
    const res = await fetch("https://api.resend.com/events", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ event, email, payload }),
    });
    if (!res.ok) {
      console.error(`Resend event '${event}' failed: ${res.status}`);
    }
  } catch (err) {
    console.error(`Resend event '${event}' error:`, err);
  }
}
