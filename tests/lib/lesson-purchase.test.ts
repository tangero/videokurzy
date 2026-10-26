import { env, SELF } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { handleQueue } from "../../src/queue";
import { conversionLog, invoiceJob, lessonPurchase, purchase } from "../../src/db/schema";
import { user } from "../../src/db/auth-schema";
import { hasAccess } from "../../src/lib/access";
import { isLessonForSale, lessonAccessUntil, listPurchasedLessons } from "../../src/lib/lesson-access";
import { sendLessonExpiryReminders } from "../../src/lib/lesson-expiry-reminders";
import { reportLessonPurchase, reportPurchase } from "../../src/lib/conversions";
import { processInvoiceJob } from "../../src/lib/invoicing/processor";
import type { FakturoidApi } from "../../src/lib/invoicing/fakturoid-gateway";
import { anonymizeAndDeleteUser } from "../../src/lib/admin-users";
import { watchRoutes } from "../../src/routes/watch";
import type { Env, Variables } from "../../src/types";

const E = env as unknown as Env;
const db = drizzle(env.DB);
const DAY = 86_400_000;
const LESSON_ID = 951;
const SLUG = "webinar-na-prodej";

beforeAll(async () => {
  await env.DB.prepare("INSERT OR IGNORE INTO course (id, title, slug, description, published) VALUES (951, 'Prodej', 'prodej', '', 1)").run();
  await env.DB.prepare("INSERT OR IGNORE INTO module (id, courseId, title, slug, sortOrder) VALUES (951, 951, 'Webináře', 'webinare', 1)").run();
  await env.DB.prepare(
    "INSERT OR IGNORE INTO lesson (id, moduleId, publicId, title, slug, bunnyVideoId, bunnyLibraryId, durationSeconds, isFree, sortOrder, priceCzk, accessDays) VALUES (?, 951, 'lesson-951', 'AI First Company webinář', ?, 'video-951', '655172', 7200, 0, 1, 490, 120)",
  ).bind(LESSON_ID, SLUG).run();
  await env.DB.prepare(
    "INSERT OR IGNORE INTO lesson (id, moduleId, publicId, title, slug, bunnyVideoId, durationSeconds, isFree, sortOrder) VALUES (952, 951, 'lesson-952', 'Jiná placená epizoda', 'jina-placena', 'video-952', 600, 0, 2)",
  ).run();
});

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM lesson_purchase").run();
  await env.DB.prepare("DELETE FROM invoice_job").run();
  await env.DB.prepare("DELETE FROM conversion_log").run();
  await env.DB.prepare("DELETE FROM purchase").run();
});

afterEach(() => vi.restoreAllMocks());

/** Zachytí odchozí e-maily (Resend) a nechá ostatní fetch projít jako 200. */
function captureEmails() {
  const sent: { to: string; subject: string; html: string }[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    if (url.includes("resend.com/emails") && init?.body) {
      const body = JSON.parse(String(init.body));
      sent.push({ to: String(body.to), subject: body.subject ?? "", html: body.html ?? "" });
    }
    return new Response("{}", { status: 200 });
  });
  return sent;
}

async function deliver(data: Record<string, unknown>, eventCreated = 1_793_000_000) {
  const ack = vi.fn();
  const retry = vi.fn();
  await handleQueue(
    {
      queue: "videokurzy-webhooks",
      messages: [{ body: { type: "checkout.session.completed", data, eventCreated }, attempts: 1, ack, retry }],
    } as never,
    E,
  );
  return { ack, retry };
}

const lessonSession = (id: string, email: string, extra: Record<string, string> = {}) => ({
  id,
  customer_email: email,
  amount_total: 49000,
  payment_status: "paid",
  metadata: { type: "lesson", lessonId: String(LESSON_ID), lessonSlug: SLUG, accessDays: "120", vs: "35123456", ...extra },
});

async function insertLessonPurchase(over: Partial<typeof lessonPurchase.$inferInsert> = {}) {
  const now = new Date();
  const [row] = await db
    .insert(lessonPurchase)
    .values({
      lessonId: LESSON_ID,
      email: "kupec@example.cz",
      variableSymbol: `35${Math.floor(100000 + Math.random() * 899999)}`,
      stripePaymentId: `cs_test_${Math.random()}`,
      amountPaid: 490,
      expiresAt: new Date(now.getTime() + 120 * DAY),
      createdAt: now,
      ...over,
    })
    .returning();
  return row;
}

describe("nákup jednoho videa neotevře platformu", () => {
  it("aktivní lesson_purchase nedá hasAccess, ale odemkne jen to video", async () => {
    await insertLessonPurchase();
    const u = { id: "u-kupec", email: "kupec@example.cz", role: "user" };
    expect(await hasAccess(u, db)).toBe(false);
    expect(await lessonAccessUntil(db, u, LESSON_ID)).toBeInstanceOf(Date);
    expect(await lessonAccessUntil(db, u, 952)).toBeNull();
    expect((await listPurchasedLessons(db, u)).map((l) => l.slug)).toEqual([SLUG]);
  });

  it("po konci přístupu ani po refundu video nevidí", async () => {
    await insertLessonPurchase({ expiresAt: new Date(Date.now() - 1000) });
    await insertLessonPurchase({ email: "refund@example.cz", status: "refunded" });
    expect(await lessonAccessUntil(db, { id: "x", email: "kupec@example.cz" }, LESSON_ID)).toBeNull();
    expect(await lessonAccessUntil(db, { id: "y", email: "refund@example.cz" }, LESSON_ID)).toBeNull();
  });

  it("prodává se jen placené video s cenou mimo hlavní library", () => {
    expect(isLessonForSale({ priceCzk: 490, isFree: false, bunnyLibraryId: "655172" })).toBe(true);
    expect(isLessonForSale({ priceCzk: 490, isFree: false, bunnyLibraryId: null })).toBe(false);
    expect(isLessonForSale({ priceCzk: null, isFree: false, bunnyLibraryId: "655172" })).toBe(false);
    expect(isLessonForSale({ priceCzk: 490, isFree: true, bunnyLibraryId: "655172" })).toBe(false);
  });
});

describe("Stripe webhook — nákup videa", () => {
  it("založí lesson_purchase s VS 35, fakturu a potvrzení s datem konce; žádný purchase", async () => {
    const sent = captureEmails();
    const { ack, retry } = await deliver(lessonSession("cs_lesson_1", "Novy@Example.cz"));
    expect(ack).toHaveBeenCalled();
    expect(retry).not.toHaveBeenCalled();

    const rows = await db.select().from(lessonPurchase).all();
    expect(rows).toHaveLength(1);
    const lp = rows[0];
    expect(lp.email).toBe("novy@example.cz");
    expect(lp.variableSymbol).toBe("35123456");
    expect(lp.amountPaid).toBe(490);
    expect(lp.expiresAt.getTime() - lp.createdAt.getTime()).toBe(120 * DAY);
    expect(lp.createdAt.getTime()).toBe(1_793_000_000 * 1000);
    expect(await db.select().from(purchase).all()).toHaveLength(0);

    const jobs = await db.select().from(invoiceJob).all();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ jobKind: "lesson_purchase", customId: `vk-lesson-${lp.id}`, purchaseId: lp.id, amount: 490 });

    const mail = sent.find((m) => m.subject.includes("Video odemčeno"));
    expect(mail).toBeDefined();
    expect(mail!.html).toContain("120 dní");
    expect(mail!.html).toMatch(/do \d{1,2}\. \d{1,2}\. \d{4}/);
    expect(mail!.html).toContain("35123456");
    expect(mail!.html).toMatch(/Poučení o právu na odstoupení/);
    // Onboarding (Resend automation) se u videa nespouští.
    expect(sent.every((m) => !m.subject.includes("Platba přijata — přihlaste se do kurzu"))).toBe(true);
  });

  it("opakované doručení nevytvoří druhý nákup ani fakturu", async () => {
    captureEmails();
    await deliver(lessonSession("cs_lesson_dup", "dup@example.cz"));
    await deliver(lessonSession("cs_lesson_dup", "dup@example.cz"));
    expect(await db.select().from(lessonPurchase).all()).toHaveLength(1);
    expect(await db.select().from(invoiceJob).all()).toHaveLength(1);
  });

  it("kolize VS s jiným nákupem dostane nový VS s prefixem 35", async () => {
    captureEmails();
    await insertLessonPurchase({ variableSymbol: "35123456" });
    await deliver(lessonSession("cs_lesson_collide", "jiny@example.cz"));
    const [lp] = await db.select().from(lessonPurchase).where(eq(lessonPurchase.stripePaymentId, "cs_lesson_collide")).all();
    expect(lp.variableSymbol).toMatch(/^35\d{6}$/);
    expect(lp.variableSymbol).not.toBe("35123456");
  });

  it("selhání potvrzovacího e-mailu vede na retry", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      return url.includes("resend.com/emails") ? new Response("down", { status: 500 }) : new Response("{}", { status: 200 });
    });
    const { ack, retry } = await deliver(lessonSession("cs_lesson_fail", "fail@example.cz"));
    expect(retry).toHaveBeenCalled();
    expect(ack).not.toHaveBeenCalled();
  });
});

describe("faktura za video", () => {
  it("položka nese název videa a konec přístupu, poznámka VS 35…", async () => {
    const lp = await insertLessonPurchase({
      variableSymbol: "35999111",
      createdAt: new Date("2026-10-25T10:00:00Z"),
      expiresAt: new Date(new Date("2026-10-25T10:00:00Z").getTime() + 120 * DAY),
    });
    const [job] = await db
      .insert(invoiceJob)
      .values({
        purchaseId: lp.id,
        jobKind: "lesson_purchase",
        customId: `vk-lesson-${lp.id}`,
        paymentSource: "stripe_checkout",
        amount: 490,
        paidAt: new Date("2026-10-25T10:00:00Z"),
        paidOn: "2026-10-25",
        paidAtSource: "stripe_api",
        email: lp.email,
        createdAt: new Date(),
      })
      .returning();
    const bodies: Record<string, unknown>[] = [];
    const api: FakturoidApi = {
      get: async <T>(path: string) => {
        if (path.startsWith("invoices.json?custom_id")) return [] as T;
        if (path.startsWith("subjects/search")) return [] as T;
        if (path.match(/^invoices\/\d+\.json/)) return { id: 700, status: "open", payments: [], sent_at: null } as T;
        return null as T;
      },
      post: async <T>(path: string, body?: unknown) => {
        if (path === "invoices.json") bodies.push(body as Record<string, unknown>);
        if (path === "subjects.json") return { id: 9 } as T;
        if (path === "invoices.json") return { id: 700 } as T;
        return {} as T;
      },
    };
    const res = await processInvoiceJob(db, E, job.id, api);
    expect(res).toEqual({ status: "done", invoiceId: 700 });
    const body = JSON.stringify(bodies[0]);
    expect(body).toContain("AI First Company webinář");
    expect(body).toContain("120 dní");
    expect(body).toContain("do 22. 2. 2027");
    expect(body).toContain("VS: 35999111");
    const [after] = await db.select().from(lessonPurchase).where(eq(lessonPurchase.id, lp.id)).all();
    expect(after.fakturoidInvoiceId).toBe(700);
  });
});

describe("konverze nákupu videa", () => {
  it("má vlastní řadu v logu a event_id lesson-<id>, nesrazí se s purchase stejného id", async () => {
    const metaEnv = { ...E, META_PIXEL_ID: "123", META_CAPI_TOKEN: "tok" } as Env;
    const payloads: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      payloads.push(String(init?.body ?? ""));
      return new Response("{}", { status: 200 });
    });
    const lp = await insertLessonPurchase({ marketingConsent: true });
    // purchase se stejným id jako lesson_purchase
    await env.DB.prepare(
      "INSERT INTO purchase (id, email, type, status, expiresAt, createdAt, amountPaid, marketingConsent, kind) VALUES (?, 'p@example.cz', 'individual', 'active', 9999999999, 1, 3000, 1, 'paid')",
    ).bind(lp.id).run();

    await reportLessonPurchase(db, metaEnv, lp.id);
    await reportPurchase(db, metaEnv, lp.id);

    const logs = await db.select().from(conversionLog).where(eq(conversionLog.purchaseId, lp.id)).all();
    expect(logs.map((l) => `${l.source}:${l.status}`).sort()).toEqual(["lesson:sent", "purchase:sent"]);
    expect(payloads.some((p) => p.includes(`"event_id":"lesson-${lp.id}"`))).toBe(true);
    expect(payloads.some((p) => p.includes(`"event_id":"${lp.id}"`))).toBe(true);
  });

  it("bez marketingového souhlasu se nereportuje", async () => {
    const metaEnv = { ...E, META_PIXEL_ID: "123", META_CAPI_TOKEN: "tok" } as Env;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
    const lp = await insertLessonPurchase({ marketingConsent: false });
    await reportLessonPurchase(db, metaEnv, lp.id);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("připomínka před koncem přístupu", () => {
  const now = new Date("2026-12-01T03:00:00Z");

  it("pošle jednou týden před koncem, s nabídkou předplatného", async () => {
    const sent = captureEmails();
    await insertLessonPurchase({ email: "brzy@example.cz", expiresAt: new Date(now.getTime() + 6.5 * DAY) });
    await insertLessonPurchase({ email: "pozdeji@example.cz", expiresAt: new Date(now.getTime() + 20 * DAY) });
    await insertLessonPurchase({ email: "konec@example.cz", expiresAt: new Date(now.getTime() - DAY) });

    expect(await sendLessonExpiryReminders(db, E, now)).toEqual({ sent: 1, skipped: 0, errors: 0 });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toContain("brzy@example.cz");
    expect(sent[0].html).toContain("Objednat roční předplatné");
    expect(sent[0].html).toContain("/checkout/individual");

    expect(await sendLessonExpiryReminders(db, E, new Date(now.getTime() + DAY))).toEqual({ sent: 0, skipped: 0, errors: 0 });
  });

  it("předplatiteli nepošle", async () => {
    const sent = captureEmails();
    await insertLessonPurchase({ email: "predplatitel@example.cz", expiresAt: new Date(now.getTime() + 3 * DAY) });
    await env.DB.prepare(
      "INSERT INTO purchase (email, type, status, expiresAt, createdAt, kind) VALUES ('predplatitel@example.cz', 'individual', 'active', ?, 1, 'paid')",
    ).bind(Math.floor(now.getTime() / 1000) + 300 * 86400).run();
    expect(await sendLessonExpiryReminders(db, E, now)).toEqual({ sent: 0, skipped: 1, errors: 0 });
    expect(sent).toHaveLength(0);
  });

  it("při selhání odeslání vrátí claim a zkusí to příště", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("down", { status: 500 }));
    const lp = await insertLessonPurchase({ email: "chyba@example.cz", expiresAt: new Date(now.getTime() + 2 * DAY) });
    expect((await sendLessonExpiryReminders(db, E, now)).errors).toBe(1);
    const [after] = await db.select().from(lessonPurchase).where(eq(lessonPurchase.id, lp.id)).all();
    expect(after.expiryReminderSentAt).toBeNull();
  });
});

describe("GDPR výmaz", () => {
  it("anonymizuje nákupy videí a jejich faktury, cizí fakturu se stejným id nechá", async () => {
    const uid = "u-gdpr-lesson";
    await db.insert(user).values({ id: uid, email: "gdpr@example.cz", name: "G", emailVerified: true, createdAt: new Date(), updatedAt: new Date() } as never);
    const lp = await insertLessonPurchase({ email: "gdpr@example.cz", companyName: "Firma" });
    const base = { paymentSource: "stripe_checkout" as const, amount: 490, paidAt: new Date(), paidOn: "2026-10-25", paidAtSource: "stripe_api" as const, createdAt: new Date() };
    await db.insert(invoiceJob).values({ ...base, purchaseId: lp.id, jobKind: "lesson_purchase", customId: `vk-lesson-${lp.id}`, email: "gdpr@example.cz" });
    // Cizí předplatné s náhodou stejným id — nesmí se anonymizovat.
    await db.insert(invoiceJob).values({ ...base, purchaseId: lp.id, jobKind: "initial_purchase", customId: `vk-purchase-${lp.id}`, email: "cizi@example.cz", sourceEventId: "x" });

    await anonymizeAndDeleteUser(db, uid);

    const [after] = await db.select().from(lessonPurchase).where(eq(lessonPurchase.id, lp.id)).all();
    expect(after.email).toMatch(/@deleted\.invalid$/);
    expect(after.companyName).toBeNull();
    const [lessonJob] = await db.select().from(invoiceJob).where(and(eq(invoiceJob.purchaseId, lp.id), eq(invoiceJob.jobKind, "lesson_purchase"))).all();
    expect(lessonJob.email).toMatch(/@deleted\.invalid$/);
    const [other] = await db.select().from(invoiceJob).where(and(eq(invoiceJob.purchaseId, lp.id), eq(invoiceJob.jobKind, "initial_purchase"))).all();
    expect(other.email).toBe("cizi@example.cz");
  });
});

describe("/watch a /checkout/lesson", () => {
  /** watchRoutes s podvrženým přihlášeným uživatelem (better-auth session v testu nemáme). */
  function appAs(u: Variables["user"]) {
    const app = new Hono<{ Bindings: Env; Variables: Variables }>();
    app.use(async (c, next) => {
      c.set("user", u);
      await next();
    });
    app.route("/", watchRoutes);
    return app;
  }

  it("nepřihlášený vidí nabídku koupě s cenou a dobou přístupu", async () => {
    const res = await SELF.fetch(`https://test.local/watch/${SLUG}`, { redirect: "manual" });
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain(`/checkout/lesson/${SLUG}`);
    expect(html).toContain("490");
    expect(html).toContain("na 120 dní");
    expect(html).not.toContain("lesson-video-player");
  });

  it("přihlášený bez přístupu dostane nabídku místo přesměrování na ceník", async () => {
    const res = await appAs({ id: "u-bez", email: "bez@example.cz", name: null, role: "user" } as never).request(`/watch/${SLUG}`, {}, E);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain(`/checkout/lesson/${SLUG}`);
  });

  it("kupec vidí video a datum konce, jiné placené video ne", async () => {
    await insertLessonPurchase({ email: "kupec@example.cz" });
    const app = appAs({ id: "u-kupec2", email: "kupec@example.cz", name: null, role: "user" } as never);
    const res = await app.request(`/watch/${SLUG}`, {}, E);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Přístup k tomuto videu máte do");
    const other = await app.request("/watch/jina-placena", { redirect: "manual" }, E);
    expect(other.status).toBe(302);
    expect(other.headers.get("location")).toBe("/#cenik");
  });

  it("objednávka ukazuje cenu, dobu a datum konce; neprodávané video vrátí na ceník", async () => {
    const res = await SELF.fetch(`https://test.local/checkout/lesson/${SLUG}`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain("AI First Company webinář");
    expect(html).toContain("na 120 dní");
    expect(html).toMatch(/do \d{1,2}\. \d{1,2}\. \d{4}/);
    expect(html).toContain('name="immediateAccessConsent"');
    expect(html).toContain('name="companyIco"');
    const no = await SELF.fetch("https://test.local/checkout/lesson/jina-placena", { redirect: "manual" });
    expect(no.status).toBe(302);
  });

  it("objednávka bez souhlasu se zpřístupněním neprojde", async () => {
    const res = await SELF.fetch(`https://test.local/checkout/lesson/${SLUG}`, {
      method: "POST",
      body: new URLSearchParams({ email: "a@example.cz" }),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("potvrďte souhlas");
  });
});

describe("titulní stránka — videa ke koupi", () => {
  it("ukáže prodávané video s cenou pro předplatitele i ostatní", async () => {
    const res = await SELF.fetch("https://test.local/");
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('id="videa"');
    expect(html).toContain("AI First Company webinář");
    expect(html).toContain("v ceně předplatného");
    expect(html).toMatch(/490(&nbsp;| | )Kč/);
    expect(html).toContain(`/checkout/lesson/${SLUG}`);
    // Neprodávané placené video v sekci není.
    expect(html).not.toContain("/checkout/lesson/jina-placena");
  });

  it("sekce videí ke koupi je nad obsahem kurzu, rámeček bez předplatného první", async () => {
    const html = await (await SELF.fetch("https://test.local/")).text();
    expect(html.indexOf('id="videa"')).toBeLessThan(html.indexOf('id="obsah"'));
    expect(html.indexOf("<dt>bez předplatného</dt>")).toBeLessThan(html.indexOf("<dt>předplatitelé</dt>"));
  });

  it("v seznamu modulů vede prodávané video na jeho stránku, ne na ceník", async () => {
    const html = await (await SELF.fetch("https://test.local/")).text();
    const row = html.match(new RegExp(`<a href="([^"]*)" class="lesson[^"]*"[^>]*>(?:(?!</a>).)*?AI First Company webinář(?:(?!</a>).)*?</a>`, "s"));
    expect(row?.[1]).toBe(`/watch/${SLUG}`);
    expect(row?.[0]).toMatch(/490(&nbsp;| | )Kč \(předplatitelé zdarma\)/);
    expect(row?.[0]).not.toContain("locked");
  });
});
