import { env } from "cloudflare:test";
import { describe, expect, it, vi, afterEach } from "vitest";
import { handleQueue } from "../src/queue";

/**
 * Stripe nákup zakládá purchase až ve webhooku, takže potvrzovací e-mail musí
 * odejít odsud — dřív se posílal jen Resend automation event (marketingová
 * sekvence), takže zákazník platící kartou nedostal poučení o odstoupení
 * na trvalém nosiči vůbec (§ 1824a odst. 1).
 */
describe("Stripe webhook — potvrzení nákupu s poučením", () => {
  afterEach(() => vi.restoreAllMocks());

  /** Zachytí odchozí Resend volání a vrátí odeslané HTML e-mailů. */
  function captureEmails() {
    const sent: { subject: string; html: string }[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.includes("resend.com/emails") && init?.body) {
        const body = JSON.parse(String(init.body));
        sent.push({ subject: body.subject ?? "", html: body.html ?? "" });
      }
      return new Response("{}", { status: 200 });
    });
    return sent;
  }

  async function runCheckout(metadata: Record<string, string>, email: string) {
    await handleQueue(
      {
        queue: "videokurzy-webhooks",
        messages: [
          {
            body: {
              type: "checkout.session.completed",
              data: {
                id: `cs_${Math.abs(email.length * 7919)}`,
                customer_email: email,
                amount_total: 200000,
                metadata,
              },
            },
            attempts: 1,
            ack: vi.fn(),
            retry: vi.fn(),
          },
        ],
      } as never,
      env as never,
    );
  }

  it("pošle spotřebiteli potvrzení včetně poučení a formuláře", async () => {
    const sent = captureEmails();
    await runCheckout({ type: "individual" }, "stripe-spotrebitel@example.cz");

    const confirmation = sent.find((e) => e.subject.includes("Platba přijata"));
    expect(confirmation).toBeDefined();
    expect(confirmation!.html).toMatch(/Poučení o právu na odstoupení/i);
    expect(confirmation!.html).toMatch(/Vzorový formulář/i);
  });

  it("nepřiloží poučení, když je nákup na IČO", async () => {
    const sent = captureEmails();
    await runCheckout(
      { type: "individual", b_ico: "43943420", b_name: "Firma s.r.o." },
      "stripe-firma@example.cz",
    );

    const confirmation = sent.find((e) => e.subject.includes("Platba přijata"));
    expect(confirmation).toBeDefined();
    expect(confirmation!.html).not.toMatch(/Poučení o právu na odstoupení/i);
    expect(confirmation!.html).not.toMatch(/Vzorový formulář/i);
  });
});
