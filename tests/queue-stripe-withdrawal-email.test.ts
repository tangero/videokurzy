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
    const ack = vi.fn();
    const retry = vi.fn();
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
            ack,
            retry,
          },
        ],
      } as never,
      env as never,
    );
    return { ack, retry };
  }

  it("pošle spotřebiteli potvrzení včetně poučení a formuláře", async () => {
    const sent = captureEmails();
    await runCheckout({ type: "individual" }, "stripe-spotrebitel@example.cz");

    const confirmation = sent.find((e) => e.subject.includes("Platba přijata"));
    expect(confirmation).toBeDefined();
    expect(confirmation!.html).toMatch(/Poučení o právu na odstoupení/i);
    expect(confirmation!.html).toMatch(/Vzorový formulář/i);
  });

  it("při selhání Resendu zprávu retryuje, místo aby poučení zahodil", async () => {
    // sendEmail chybu polyká a vrací false — bez explicitní kontroly by se
    // zpráva ackla a poučení podle § 1824a by zmizelo nenávratně.
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.includes("resend.com/emails")) {
        return new Response("rate limited", { status: 429 });
      }
      return new Response("{}", { status: 200 });
    });

    const { ack, retry } = await runCheckout(
      { type: "individual" },
      "stripe-resend-vypadek@example.cz",
    );

    expect(retry).toHaveBeenCalledOnce();
    expect(ack).not.toHaveBeenCalled();
  });

  it("nespustí onboardingovou automatizaci podruhé při retry", async () => {
    // sendResendEvent nemá idempotenci — každé volání spustí sekvenci znovu.
    // Retry (nově možný kvůli povinnému potvrzovacímu e-mailu) proto nesmí
    // událost poslat opakovaně, jinak zákazník dostane onboarding vícekrát.
    const events: string[] = [];
    let failEmail = true;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.includes("resend.com/events/send")) {
        events.push(String(JSON.parse(String(init?.body ?? "{}")).event));
        return new Response("{}", { status: 200 });
      }
      if (url.includes("resend.com/emails")) {
        // První průchod: e-mail selže → retry. Druhý: projde.
        if (failEmail) {
          failEmail = false;
          return new Response("rate limited", { status: 429 });
        }
      }
      return new Response("{}", { status: 200 });
    });

    const email = "stripe-retry-onboarding@example.cz";
    const first = await runCheckout({ type: "individual" }, email);
    expect(first.retry).toHaveBeenCalledOnce();
    expect(events).toEqual(["purchase.completed"]);

    // Retry doručí tutéž zprávu znovu — purchase řádek už existuje.
    const second = await runCheckout({ type: "individual" }, email);
    expect(second.ack).toHaveBeenCalledOnce();
    // Automation se NESMÍ spustit podruhé.
    expect(events).toEqual(["purchase.completed"]);
  });

  it("doručí onboarding při retry, když poprvé selhal i s e-mailem", async () => {
    // Scénář, který guard navázaný na insert řešit neuměl: insert projde,
    // odeslání události selže (400 = prokazatelné odmítnutí) a e-mail selže
    // taky → retry. Při něm už řádek existuje, takže guard „vložil se řádek?"
    // by událost přeskočil navždy. Idempotenci proto drží onboardingEventSentAt.
    const events: string[] = [];
    let failAll = true;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.includes("resend.com/events/send")) {
        if (failAll) return new Response("bad request", { status: 400 });
        events.push(String(JSON.parse(String(init?.body ?? "{}")).event));
        return new Response("{}", { status: 200 });
      }
      if (url.includes("resend.com/emails") && failAll) {
        return new Response("rate limited", { status: 429 });
      }
      return new Response("{}", { status: 200 });
    });

    const email = "stripe-onboarding-selhalo@example.cz";
    const first = await runCheckout({ type: "individual" }, email);
    expect(first.retry).toHaveBeenCalledOnce();
    expect(events).toEqual([]); // poprvé se nedoručilo nic

    failAll = false;
    const second = await runCheckout({ type: "individual" }, email);
    expect(second.ack).toHaveBeenCalledOnce();
    // Retry musí onboarding doručit — jinak by se ztratil nadobro.
    expect(events).toEqual(["purchase.completed"]);
  });

  it("selhání onboardingu eskaluje na retry, i když e-mail projde", async () => {
    // Dřív se selhání jen zalogovalo a funkce se vrátila: pokud potvrzovací
    // e-mail prošel, zpráva se ackla a onboarding zmizel. Retry musí nastat
    // kvůli samotné události, ne jen jako vedlejší efekt selhání e-mailu.
    const events: string[] = [];
    let failEvent = true;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.includes("resend.com/events/send")) {
        if (failEvent) return new Response("bad request", { status: 400 });
        events.push(String(JSON.parse(String(init?.body ?? "{}")).event));
      }
      return new Response("{}", { status: 200 }); // e-mail projde vždy
    });

    const email = "stripe-onboarding-eskalace@example.cz";
    const first = await runCheckout({ type: "individual" }, email);
    expect(first.retry).toHaveBeenCalledOnce();
    expect(first.ack).not.toHaveBeenCalled();
    expect(events).toEqual([]);

    // Claim se musel vrátit, jinak by retry událost přeskočil.
    failEvent = false;
    const second = await runCheckout({ type: "individual" }, email);
    expect(second.ack).toHaveBeenCalledOnce();
    expect(events).toEqual(["purchase.completed"]);
  });

  it("souběžné doručení téhož webhooku pošle onboarding jen jednou", async () => {
    // Claim musí být atomický UPDATE. Kdyby se stav jen ČETL před odesláním,
    // obě souběžné kopie by viděly NULL a obě událost odeslaly.
    const events: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.includes("resend.com/events/send")) {
        events.push(String(JSON.parse(String(init?.body ?? "{}")).event));
      }
      return new Response("{}", { status: 200 });
    });

    const email = "stripe-soubeh@example.cz";
    await Promise.all([
      runCheckout({ type: "individual" }, email),
      runCheckout({ type: "individual" }, email),
    ]);

    expect(events).toEqual(["purchase.completed"]);
  });

  it("při neurčitém výsledku onboarding neopakuje", async () => {
    // Timeout / přerušené spojení: událost se mohla doručit a jen se ztratila
    // odpověď. Opakování by znamenalo druhý onboarding, takže claim zůstává.
    const events: string[] = [];
    let networkError = true;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.includes("resend.com/events/send")) {
        if (networkError) throw new TypeError("network error");
        events.push(String(JSON.parse(String(init?.body ?? "{}")).event));
      }
      return new Response("{}", { status: 200 });
    });

    const email = "stripe-neurcity@example.cz";
    const first = await runCheckout({ type: "individual" }, email);
    // Zpráva projde — neurčitý výsledek NENÍ důvod k retry.
    expect(first.ack).toHaveBeenCalledOnce();
    expect(first.retry).not.toHaveBeenCalled();

    // Další doručení téže zprávy už událost nepošle (claim zůstal zapsaný).
    networkError = false;
    await runCheckout({ type: "individual" }, email);
    expect(events).toEqual([]);
  });

  it("po 5xx onboarding zopakuje (server odpověděl, událost nevznikla)", async () => {
    // 5xx bereme jako neurčité — server mohl událost přesto zpracovat.
    // 4xx je naopak jednoznačné odmítnutí, tam je opakování bezpečné.
    const events: string[] = [];
    let reject = true;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.includes("resend.com/events/send")) {
        if (reject) return new Response("bad request", { status: 400 });
        events.push(String(JSON.parse(String(init?.body ?? "{}")).event));
      }
      return new Response("{}", { status: 200 });
    });

    const email = "stripe-odmitnuto@example.cz";
    const first = await runCheckout({ type: "individual" }, email);
    expect(first.retry).toHaveBeenCalledOnce();

    reject = false;
    await runCheckout({ type: "individual" }, email);
    expect(events).toEqual(["purchase.completed"]);
  });

  it("po 429 onboarding zopakuje (rate limit je odmítnutí, ne neurčitý výsledek)", async () => {
    // Resend vrací 429 u rate_limit_exceeded i daily/monthly_quota_exceeded —
    // ve všech případech požadavek odmítne PŘED zpracováním, takže událost
    // prokazatelně nevznikla. Považovat 429 za neurčité by znamenalo, že se
    // po běžném rate limitu onboarding neodešle nikdy.
    const events: string[] = [];
    let limited = true;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.includes("resend.com/events/send")) {
        if (limited) return new Response("rate limit exceeded", { status: 429 });
        events.push(String(JSON.parse(String(init?.body ?? "{}")).event));
      }
      return new Response("{}", { status: 200 });
    });

    const email = "stripe-rate-limit@example.cz";
    const first = await runCheckout({ type: "individual" }, email);
    expect(first.retry).toHaveBeenCalledOnce();
    expect(events).toEqual([]);

    limited = false;
    const second = await runCheckout({ type: "individual" }, email);
    expect(second.ack).toHaveBeenCalledOnce();
    expect(events).toEqual(["purchase.completed"]);
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
