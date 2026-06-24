import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { purchase, organization, user, newsletterSuppression } from "../../src/db/schema";
import {
  emailHash,
  buildRecipientSet,
  countRecipients,
  sendNewsletter,
  recordUnsubscribe,
  recordResubscribe,
  isSuppressed,
  userNewsletterEmails,
  isUserSuppressed,
  unsubscribeUserAll,
  resubscribeUserAll,
  parseCcArticleLinks,
  buildNewsletterHtml,
  sendCcNewsNewsletterForItem,
} from "../../src/lib/cc-news/newsletter";
import { ccNewsItem, siteConfig } from "../../src/db/schema";
import { CC_NEWS_LIVE_SEND_KEY } from "../../src/lib/cc-news/settings";
import { publishedKvKey } from "../../src/lib/cc-news/draft";
import { signUnsubToken, verifyUnsubToken } from "../../src/lib/cc-news/approval";

const SECRET = "test-internal-secret"; // shoda s env.test.vars
const NOW = new Date("2026-06-21T12:00:00.000Z");
const FUTURE = new Date("2027-06-21T12:00:00.000Z");

async function seedRecipients() {
  const db = drizzle(env.DB);
  // aktivní placený purchase
  await db.insert(purchase).values({
    id: 1, email: "Paid@Example.cz", type: "individual", paymentMethod: "stripe",
    status: "active", kind: "paid", expiresAt: FUTURE, createdAt: NOW, amountPaid: 2000,
  });
  // comp grant — NESMÍ být příjemce
  await db.insert(purchase).values({
    id: 2, email: "comp@example.cz", type: "individual", paymentMethod: "stripe",
    status: "active", kind: "comp", expiresAt: FUTURE, createdAt: NOW, amountPaid: 0,
  });
  // expirovaný — NESMÍ
  await db.insert(purchase).values({
    id: 3, email: "old@example.cz", type: "individual", paymentMethod: "stripe",
    status: "active", kind: "paid", expiresAt: new Date("2020-01-01"), createdAt: NOW, amountPaid: 2000,
  });
  // nevalidní e-mail (překlep, chybí TLD) — NESMÍ projít sanity filtrem
  await db.insert(purchase).values({
    id: 4, email: "rozbity-email", type: "individual", paymentMethod: "stripe",
    status: "active", kind: "paid", expiresAt: FUTURE, createdAt: NOW, amountPaid: 2000,
  });
  // aktivní org doména + ověřený uživatel na ní
  await db.insert(organization).values({
    id: 1, publicId: "org1", domain: "firma.cz", status: "active", createdAt: NOW,
  });
  await db.insert(user).values({
    id: "u1", email: "zamestnanec@firma.cz", emailVerified: true, role: "user",
    createdAt: NOW, updatedAt: NOW,
  });
  // neověřený na org doméně — NESMÍ
  await db.insert(user).values({
    id: "u2", email: "neoverenyk@firma.cz", emailVerified: false, role: "user",
    createdAt: NOW, updatedAt: NOW,
  });
}

describe("emailHash", () => {
  it("is normalized (case/space insensitive) and stable", async () => {
    const a = await emailHash(SECRET, "Foo@Bar.cz");
    const b = await emailHash(SECRET, "  foo@bar.cz ");
    expect(a).toBe(b);
    expect(a).not.toBe(await emailHash(SECRET, "other@bar.cz"));
  });
});

describe("buildRecipientSet (R6 cílová množina)", () => {
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM purchase");
    await env.DB.exec("DELETE FROM organization");
    await env.DB.exec("DELETE FROM user");
    await env.DB.exec("DELETE FROM newsletter_suppression");
    await seedRecipients();
  });

  it("includes active paid purchase + verified org-domain user, excludes comp/expired/unverified", async () => {
    const db = drizzle(env.DB);
    const recipients = await buildRecipientSet(db, SECRET, NOW);
    expect(recipients).toContain("paid@example.cz");       // normalizováno
    expect(recipients).toContain("zamestnanec@firma.cz");
    expect(recipients).not.toContain("comp@example.cz");
    expect(recipients).not.toContain("old@example.cz");
    expect(recipients).not.toContain("neoverenyk@firma.cz");
    expect(recipients).not.toContain("rozbity-email"); // sanity filtr tvaru e-mailu
  });

  it("excludes suppressed recipients (anti-join via emailHash)", async () => {
    const db = drizzle(env.DB);
    await db.insert(newsletterSuppression).values({
      emailHash: await emailHash(SECRET, "paid@example.cz"),
      newsletter: "claude_code_news", optedOutAt: NOW, source: "test",
    });
    const recipients = await buildRecipientSet(db, SECRET, NOW);
    expect(recipients).not.toContain("paid@example.cz");
    expect(recipients).toContain("zamestnanec@firma.cz"); // ostatní zůstávají
  });
});

describe("countRecipients — rozpad počtu příjemců pro admin náhled", () => {
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM purchase");
    await env.DB.exec("DELETE FROM organization");
    await env.DB.exec("DELETE FROM user");
    await env.DB.exec("DELETE FROM newsletter_suppression");
    await seedRecipients();
  });

  it("bez odhlášených: willSend = eligible, suppressed = 0", async () => {
    const db = drizzle(env.DB);
    const c = await countRecipients(db, SECRET, NOW);
    // seedRecipients dá 2 způsobilé (paid@example.cz, zamestnanec@firma.cz)
    expect(c.eligible).toBe(2);
    expect(c.suppressed).toBe(0);
    expect(c.willSend).toBe(2);
  });

  it("s odhlášeným: willSend = eligible − suppressed", async () => {
    const db = drizzle(env.DB);
    await db.insert(newsletterSuppression).values({
      emailHash: await emailHash(SECRET, "paid@example.cz"),
      newsletter: "claude_code_news", optedOutAt: NOW, source: "test",
    });
    const c = await countRecipients(db, SECRET, NOW);
    expect(c.eligible).toBe(2);
    expect(c.suppressed).toBe(1);
    expect(c.willSend).toBe(1);
  });

  it("rozpad sedí s reálným seznamem z buildRecipientSet", async () => {
    const db = drizzle(env.DB);
    const recipients = await buildRecipientSet(db, SECRET, NOW);
    const c = await countRecipients(db, SECRET, NOW);
    expect(c.willSend).toBe(recipients.length);
  });

  it("prázdná množina → samé nuly", async () => {
    await env.DB.exec("DELETE FROM purchase");
    await env.DB.exec("DELETE FROM user");
    const db = drizzle(env.DB);
    const c = await countRecipients(db, SECRET, NOW);
    expect(c).toEqual({ willSend: 0, eligible: 0, suppressed: 0 });
  });
});

describe("sendNewsletter (R6 dry-run)", () => {
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM purchase");
    await env.DB.exec("DELETE FROM organization");
    await env.DB.exec("DELETE FROM user");
    await env.DB.exec("DELETE FROM newsletter_suppression");
    await env.DB.exec("DELETE FROM site_config");
    await seedRecipients();
  });

  it("does not send, returns count + only masked sample (brána zavřená)", async () => {
    const db = drizzle(env.DB);
    // env.test nemá CC_NEWS_DRY_RUN=0 → live brána zavřená → dry-run i s obsahem
    const report = await sendNewsletter(db, env as never, NOW, {
      content: { subject: "x", renderHtml: () => "<p>x</p>", baseUrl: "https://k.cz" },
    });
    expect(report.mode).toBe("dry-run");
    expect(report.sent).toBe(false);
    expect(report.recipientCount).toBeGreaterThanOrEqual(2);
    // vzorek je maskovaný — žádná plná adresa
    for (const m of report.maskedSample) {
      expect(m).toMatch(/\*\*\*@/);
      expect(m).not.toMatch(/paid@example/);
    }
  });

  it("zůstává dry-run, když chybí obsah (není co poslat)", async () => {
    const db = drizzle(env.DB);
    const report = await sendNewsletter(db, env as never, NOW);
    expect(report.mode).toBe("dry-run");
    expect(report.sent).toBe(false);
  });

  it("z cílové množiny vyřadí odhlášené (anti-join přes suppression)", async () => {
    const db = drizzle(env.DB);
    const before = await buildRecipientSet(db, SECRET, NOW);
    expect(before).toContain("paid@example.cz");
    await recordUnsubscribe(db, SECRET, "paid@example.cz", NOW);
    const after = await buildRecipientSet(db, SECRET, NOW);
    expect(after).not.toContain("paid@example.cz");
  });
});

describe("unsubscribe (GDPR, R6)", () => {
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM newsletter_suppression");
  });

  it("signed token round-trips and is purpose-separated from approval", async () => {
    const token = await signUnsubToken(env as never, "User@X.cz");
    expect(await verifyUnsubToken(env as never, token)).toBe("user@x.cz");
    // approve verify nesmí přijmout unsub token (jiný účel)
    const { verifyApprovalIntent } = await import("../../src/lib/cc-news/approval");
    expect(await verifyApprovalIntent(env as never, token, NOW.getTime())).toBeNull();
  });

  it("records suppression as emailHash only (no plain email), idempotent", async () => {
    const db = drizzle(env.DB);
    const first = await recordUnsubscribe(db, SECRET, "x@y.cz", NOW);
    expect(first.alreadyOptedOut).toBe(false);

    const rows = await db.select().from(newsletterSuppression);
    expect(rows).toHaveLength(1);
    expect(rows[0].emailHash).toBe(await emailHash(SECRET, "x@y.cz"));
    // tabulka nikde nedrží plain e-mail
    expect(JSON.stringify(rows[0])).not.toMatch(/x@y\.cz/);

    const second = await recordUnsubscribe(db, SECRET, "x@y.cz", NOW);
    expect(second.alreadyOptedOut).toBe(true);
    expect(await db.select().from(newsletterSuppression)).toHaveLength(1);
  });

  it("resubscribe deletes the suppression row (opt-in zpět), idempotent", async () => {
    const db = drizzle(env.DB);
    await recordUnsubscribe(db, SECRET, "z@y.cz", NOW);
    expect(await isSuppressed(db, SECRET, "z@y.cz")).toBe(true);

    const first = await recordResubscribe(db, SECRET, "z@y.cz");
    expect(first.wasOptedOut).toBe(true);
    expect(await isSuppressed(db, SECRET, "z@y.cz")).toBe(false);
    expect(await db.select().from(newsletterSuppression)).toHaveLength(0);

    // opětovné přihlášení už nepřihlášené adresy = no-op
    const second = await recordResubscribe(db, SECRET, "z@y.cz");
    expect(second.wasOptedOut).toBe(false);
  });

  it("isSuppressed normalizuje e-mail (case/space) a defaultně false", async () => {
    const db = drizzle(env.DB);
    expect(await isSuppressed(db, SECRET, "nikdy@y.cz")).toBe(false);
    await recordUnsubscribe(db, SECRET, "Case@Y.cz", NOW);
    expect(await isSuppressed(db, SECRET, "  case@y.cz ")).toBe(true);
  });

  it("opt-out z profilu pokryje i odlišný purchase.email (ne jen user.email)", async () => {
    const db = drizzle(env.DB);
    await env.DB.exec("DELETE FROM purchase");
    await env.DB.exec("DELETE FROM \"user\"");
    // účet jan@gmail.com s nákupem na odlišnou fakturační adresu firma@acme.cz
    await db.insert(user).values({
      id: "uX", email: "jan@gmail.com", emailVerified: true, role: "user",
      createdAt: NOW, updatedAt: NOW,
    });
    await db.insert(purchase).values({
      id: 50, email: "firma@acme.cz", userId: "uX", type: "individual",
      paymentMethod: "stripe", status: "active", kind: "paid",
      expiresAt: FUTURE, createdAt: NOW, amountPaid: 2000,
    });

    const emails = await userNewsletterEmails(db, "uX", "jan@gmail.com", NOW);
    expect(emails.sort()).toEqual(["firma@acme.cz", "jan@gmail.com"]);

    // opt-out přes profil odhlásí OBĚ adresy
    await unsubscribeUserAll(db, SECRET, emails, NOW, { source: "profile", userId: "uX" });
    expect(await isSuppressed(db, SECRET, "jan@gmail.com")).toBe(true);
    expect(await isSuppressed(db, SECRET, "firma@acme.cz")).toBe(true);
    expect(await isUserSuppressed(db, SECRET, emails)).toBe(true);

    // a buildRecipientSet (cílí na purchase.email) je teď vyřadí
    const recipients = await buildRecipientSet(db, SECRET, NOW);
    expect(recipients).not.toContain("firma@acme.cz");

    // opt-in zpět smaže obě
    await resubscribeUserAll(db, SECRET, emails);
    expect(await isUserSuppressed(db, SECRET, emails)).toBe(false);
  });
});

describe("parseCcArticleLinks (R7 — odkazy na CC články z vibecoding.cz)", () => {
  const feed = `<?xml version="1.0"?><rss><channel>
    <item><title><![CDATA[Claude Code pluginy]]></title>
      <link>https://vibecoding.cz/vibecoding/claude-code/2025-10-09-plugins</link>
      <category>Claude Code</category></item>
    <item><title>Nesouvisející o Pythonu</title>
      <link>https://vibecoding.cz/vibecoding/python/neco</link>
      <category>Python</category></item>
    <item><title><![CDATA[Subagenti v Claude Code]]></title>
      <link>https://vibecoding.cz/vibecoding/claude-code/2025-07-13-subagenti</link>
      <category>Claude Code</category></item>
  </channel></rss>`;

  it("keeps only Claude Code articles with title + url", () => {
    const links = parseCcArticleLinks(feed);
    expect(links).toHaveLength(2);
    expect(links[0]).toMatchObject({ title: "Claude Code pluginy" });
    expect(links[0].url).toMatch(/\/claude-code\//);
    expect(links.find((l) => /Python/.test(l.title))).toBeUndefined();
  });

  it("respects the limit", () => {
    expect(parseCcArticleLinks(feed, 1)).toHaveLength(1);
  });

  it("handles Atom self-closing <link href=.../> and filters by URL segment", () => {
    const atom = `<rss><channel>
      <item><title>CC novinky</title>
        <link href="https://vibecoding.cz/vibecoding/claude-code/2026-w24"/></item>
      <item><title>Jiné</title>
        <link href="https://vibecoding.cz/vibecoding/jine/x"/></item>
    </channel></rss>`;
    const links = parseCcArticleLinks(atom);
    expect(links).toHaveLength(1);
    expect(links[0].url).toBe("https://vibecoding.cz/vibecoding/claude-code/2026-w24");
  });

  it("does NOT match an article that only mentions Claude Code in the title/body", () => {
    // žádná kategorie „Claude Code" ani URL segment /claude-code/ → nezahrnout
    const feed2 = `<rss><channel>
      <item><title>Srovnání nástrojů: Claude Code vs ostatní</title>
        <link>https://vibecoding.cz/vibecoding/nastroje/srovnani</link>
        <category>Nástroje</category></item>
    </channel></rss>`;
    expect(parseCcArticleLinks(feed2)).toHaveLength(0);
  });
});

describe("buildNewsletterHtml", () => {
  // Stub renderery: jednoznačně označí vstup, ať jde ověřit skládání bez
  // závislosti na reálném renderMarkdown.
  const render = (md: string) => `<r>${md}</r>`;
  const strip = (md: string) => md.replace(/^FM\n/, ""); // „odebere front matter"
  const template = (o: {
    introHtml: string | null;
    articleHtml: string;
    unsubscribeUrl: string;
  }) => `[intro:${o.introHtml ?? "—"}][article:${o.articleHtml}][unsub:${o.unsubscribeUrl}]`;

  it("vloží úvodník nad článek a předá odhlašovací odkaz", () => {
    const html = buildNewsletterHtml(
      {
        articleMarkdown: "FM\nTělo článku",
        editorialMarkdown: "Můj úvodník",
        unsubscribeUrl: "https://x/unsub",
      },
      render,
      strip,
      template,
    );
    // článek prošel stripem front matteru i renderem; úvodník renderem
    expect(html).toBe(
      "[intro:<r>Můj úvodník</r>][article:<r>Tělo článku</r>][unsub:https://x/unsub]",
    );
  });

  it("prázdný úvodník → introHtml je null (žádná intro sekce)", () => {
    const html = buildNewsletterHtml(
      { articleMarkdown: "Tělo", editorialMarkdown: "   ", unsubscribeUrl: "#" },
      render,
      strip,
      template,
    );
    expect(html).toBe("[intro:—][article:<r>Tělo</r>][unsub:#]");
  });

  it("chybějící úvodník (null) → bez intro sekce", () => {
    const html = buildNewsletterHtml(
      { articleMarkdown: "Tělo", editorialMarkdown: null, unsubscribeUrl: "#" },
      render,
      strip,
      template,
    );
    expect(html).toContain("[intro:—]");
  });
});

describe("sendCcNewsNewsletterForItem — per-vydání zámek proti opakovanému rozeslání", () => {
  // Stub renderery + šablona (nezávislé na renderMarkdown).
  const renderMd = (md: string) => `<r>${md}</r>`;
  const strip = (md: string) => md;
  const template = (o: { introHtml: string | null; articleHtml: string; unsubscribeUrl: string }) =>
    `${o.articleHtml}|${o.unsubscribeUrl}`;

  let fetchSpy: typeof globalThis.fetch;
  let resendCalls: number;

  async function liveEnvSetup() {
    const db = drizzle(env.DB);
    // jeden platící příjemce, ať má rozesílka komu poslat
    await db.insert(purchase).values({
      id: 1, email: "paid@example.cz", type: "individual", paymentMethod: "stripe",
      status: "active", kind: "paid", expiresAt: FUTURE, createdAt: NOW, amountPaid: 2000,
    });
    // vydání + publikovaný obsah v KV
    await db.insert(ccNewsItem).values({
      id: "item-1", sourceId: "/docs/en/whats-new/2026-w24", contentHash: "h",
      weekLabel: "Week 24", status: "published", articlePath: "src/content/novinky-cc/2026-w24-novinky.md",
      createdAt: NOW, publishedAt: NOW,
    });
    await env.KV.put(publishedKvKey("item-1"), "Tělo článku");
    // zapni obě brány
    await db.insert(siteConfig).values({ key: CC_NEWS_LIVE_SEND_KEY, value: "true" });
  }

  const liveEnv = () =>
    ({ ...(env as unknown as Record<string, unknown>), CC_NEWS_DRY_RUN: "0", RESEND_API_KEY: "re_test" }) as never;

  beforeEach(async () => {
    await env.DB.exec("DELETE FROM purchase");
    await env.DB.exec("DELETE FROM organization");
    await env.DB.exec("DELETE FROM user");
    await env.DB.exec("DELETE FROM newsletter_suppression");
    await env.DB.exec("DELETE FROM site_config");
    await env.DB.exec("DELETE FROM cc_news_item");
    await env.KV.delete(publishedKvKey("item-1"));
    resendCalls = 0;
    fetchSpy = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("api.resend.com")) {
        resendCalls++;
        return new Response(JSON.stringify({ id: "mock" }), { status: 200 });
      }
      return fetchSpy(input as never, init);
    }) as typeof globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = fetchSpy;
  });

  it("první rozeslání odešle a nastaví newsletterSentAt; druhé je skipped", async () => {
    const db = drizzle(env.DB);
    await liveEnvSetup();

    const first = await sendCcNewsNewsletterForItem(
      db, liveEnv(), "item-1", NOW, renderMd, strip, template,
    );
    expect("skipped" in first && first.skipped).toBeFalsy();
    expect(resendCalls).toBe(1);

    const rows = await db.select().from(ccNewsItem).where(eq(ccNewsItem.id, "item-1"));
    expect(rows[0].newsletterSentAt).toBeTruthy();

    // druhé volání — zámek drží, nic se neodešle
    const second = await sendCcNewsNewsletterForItem(
      db, liveEnv(), "item-1", new Date("2026-06-22T12:00:00Z"), renderMd, strip, template,
    );
    expect("skipped" in second && second.skipped).toBe(true);
    expect("skipped" in second && second.skipped && second.reason).toBe("already-sent");
    expect(resendCalls).toBe(1); // stále jen jedno odeslání
  });

  it("force=true rozešle znovu i přes nastavený zámek", async () => {
    const db = drizzle(env.DB);
    await liveEnvSetup();

    await sendCcNewsNewsletterForItem(db, liveEnv(), "item-1", NOW, renderMd, strip, template);
    expect(resendCalls).toBe(1);

    const forced = await sendCcNewsNewsletterForItem(
      db, liveEnv(), "item-1", NOW, renderMd, strip, template, { force: true },
    );
    expect("skipped" in forced && forced.skipped).toBeFalsy();
    expect(resendCalls).toBe(2);
  });

  it("bez publikovaného obsahu → skipped:no-content, žádné odeslání ani zámek", async () => {
    const db = drizzle(env.DB);
    await db.insert(ccNewsItem).values({
      id: "item-1", sourceId: "/docs/en/whats-new/2026-w24", contentHash: "h",
      weekLabel: "Week 24", status: "published", createdAt: NOW,
    });
    // žádný publishedKvKey obsah
    const result = await sendCcNewsNewsletterForItem(
      db, liveEnv(), "item-1", NOW, renderMd, strip, template,
    );
    expect("skipped" in result && result.skipped && result.reason).toBe("no-content");
    expect(resendCalls).toBe(0);
    const rows = await db.select().from(ccNewsItem).where(eq(ccNewsItem.id, "item-1"));
    expect(rows[0].newsletterSentAt).toBeNull();
  });

  it("dry-run (brány vypnuté) NEdrží zámek — lze poslat naostro později", async () => {
    const db = drizzle(env.DB);
    await db.insert(purchase).values({
      id: 1, email: "paid@example.cz", type: "individual", paymentMethod: "stripe",
      status: "active", kind: "paid", expiresAt: FUTURE, createdAt: NOW, amountPaid: 2000,
    });
    await db.insert(ccNewsItem).values({
      id: "item-1", sourceId: "/docs/en/whats-new/2026-w24", contentHash: "h",
      weekLabel: "Week 24", status: "published", createdAt: NOW,
    });
    await env.KV.put(publishedKvKey("item-1"), "Tělo článku");
    // brány VYPNUTÉ (žádný CC_NEWS_DRY_RUN=0) → dry-run

    const dry = await sendCcNewsNewsletterForItem(
      db, env as never, "item-1", NOW, renderMd, strip, template,
    );
    expect("skipped" in dry && dry.skipped).toBeFalsy();
    expect("mode" in dry && dry.mode).toBe("dry-run");
    expect(resendCalls).toBe(0);
    // zámek se uvolnil zpět na null
    const rows = await db.select().from(ccNewsItem).where(eq(ccNewsItem.id, "item-1"));
    expect(rows[0].newsletterSentAt).toBeNull();
  });
});
