import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ccNewsItem, siteConfig } from "../../src/db/schema";
import {
  processCcNewsItem,
  articleSlug,
  triggerCcNewsApproval,
} from "../../src/lib/cc-news/pipeline";
import { draftKvKey } from "../../src/lib/cc-news/draft";
import { CC_NEWS_LIVE_SEND_KEY } from "../../src/lib/cc-news/settings";
import type { Fetchers } from "../../src/lib/cc-news/detect";

const NOW = new Date("2026-06-21T12:00:00.000Z");

const DIGEST = `# Week 24 · June 8–12, 2026

> Move a session with /cd and troubleshoot with safe mode.

<div className="digest-meta"><span>Releases <a>v2.1.166 → v2.1.176</a></span></div>

<div className="digest-feature">
  <div className="digest-feature-header">
    <span className="digest-feature-title">Troubleshoot with safe mode</span>
    <span className="digest-feature-pill">v2.1.169</span>
  </div>
  <p className="digest-feature-lede">Start Claude Code with safe mode.</p>
  <a className="digest-feature-link" href="/docs/en/troubleshooting#safe-mode">Safe mode</a>
</div>`;

const fetchers = (detail: string): Fetchers => ({
  fetchRss: async () => "",
  fetchDetail: async () => detail,
});

describe("processCcNewsItem — detekce → editor → draft (napojení pipeline)", () => {
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM cc_news_item");
    const db = drizzle(env.DB);
    await db.insert(ccNewsItem).values({
      id: "item-1",
      sourceId: "/docs/en/whats-new/2026-w24",
      contentHash: "h",
      weekLabel: "Week 24",
      versionRange: "v2.1.166 → v2.1.176",
      status: "draft",
      createdAt: NOW,
    });
  });

  it("derives slug from sourceId", () => {
    expect(articleSlug("/docs/en/whats-new/2026-w24")).toBe("2026-w24-novinky");
  });

  it("produces a draft, nonce and dry-run approval e-mail end-to-end", async () => {
    const db = drizzle(env.DB);
    const result = await processCcNewsItem(
      db,
      env as never,
      { itemId: "item-1", sourceId: "/docs/en/whats-new/2026-w24" },
      NOW,
      fetchers(DIGEST)
    );

    // dry-run: nic se neodeslalo
    expect(result.mode).toBe("dry-run");
    expect(result.sent).toBe(false);

    // článek je v KV a obsahuje strukturu z editoru
    const md = await env.KV.get(draftKvKey("item-1"));
    expect(md).toMatch(/# Co je nového v Claude Code/);
    expect(md).toMatch(/Troubleshoot with safe mode/);

    // draft má nonce + articlePath, status zůstal draft (bez schválení)
    const rows = await db.select().from(ccNewsItem).where(eq(ccNewsItem.id, "item-1"));
    expect(rows[0].approveNonce).toBeTruthy();
    expect(rows[0].articlePath).toMatch(/2026-w24-novinky\.md$/);
    expect(rows[0].status).toBe("draft");

    // schvalovací e-mail je připravený, neodeslaný
    expect(result.email.subject).toMatch(/Novinky v Claude Code/);
    expect(result.approveUrl).toMatch(/\/internal\/cc-news\/approve\?token=/);
  });

  it("uses the deterministic skeleton when LLM flag is off", async () => {
    const db = drizzle(env.DB);
    const result = await processCcNewsItem(
      db,
      env as never,
      { itemId: "item-1", sourceId: "/docs/en/whats-new/2026-w24" },
      NOW,
      fetchers(DIGEST)
    );
    expect(result.usedLlm).toBe(false);
  });
});

describe("triggerCcNewsApproval — ruční trigger neduplikuje e-mail", () => {
  let fetchSpy: typeof globalThis.fetch;
  let resendCalls: number;

  beforeEach(async () => {
    await env.DB.exec("DELETE FROM cc_news_item");
    await env.DB.exec("DELETE FROM site_config");
    const db = drizzle(env.DB);
    await db.insert(ccNewsItem).values({
      id: "item-1",
      sourceId: "/docs/en/whats-new/2026-w24",
      contentHash: "h",
      weekLabel: "Week 24",
      versionRange: "v2.1.166 → v2.1.176",
      status: "draft",
      createdAt: NOW,
    });
    // Spočítej reálná odeslání na Resend API přes mock fetch.
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

  const envWith = (extra: Record<string, unknown>) =>
    ({ ...(env as unknown as Record<string, unknown>), ...extra }) as never;

  it("dry-run brány: trigger odešle PRÁVĚ jednou a zapíše approvalEmailSentAt", async () => {
    const db = drizzle(env.DB);
    const result = await triggerCcNewsApproval(
      db,
      envWith({ RESEND_API_KEY: "re_test" }),
      { itemId: "item-1", sourceId: "/docs/en/whats-new/2026-w24" },
      NOW,
      fetchers(DIGEST)
    );
    expect("sent" in result && result.sent).toBe(true);
    expect(resendCalls).toBe(1);

    const rows = await db.select().from(ccNewsItem).where(eq(ccNewsItem.id, "item-1"));
    expect(rows[0].approvalEmailSentAt).toBeTruthy();
  });

  it("live brány zapnuté: trigger NEodešle podruhé (prepareDraftAndApproval už poslala)", async () => {
    const db = drizzle(env.DB);
    // Zapni obě brány: admin přepínač + env CC_NEWS_DRY_RUN=0 + klíč.
    await db.insert(siteConfig).values({ key: CC_NEWS_LIVE_SEND_KEY, value: "true" });
    const result = await triggerCcNewsApproval(
      db,
      envWith({ CC_NEWS_DRY_RUN: "0", RESEND_API_KEY: "re_test" }),
      { itemId: "item-1", sourceId: "/docs/en/whats-new/2026-w24" },
      NOW,
      fetchers(DIGEST)
    );
    expect("sent" in result && result.sent).toBe(true);
    // Klíčové: jen JEDNO odeslání, ne dvě (regrese, kterou našel Greptile).
    expect(resendCalls).toBe(1);
    // I v live režimu se zapíše approvalEmailSentAt (idempotence dalšího triggeru).
    const rows = await db.select().from(ccNewsItem).where(eq(ccNewsItem.id, "item-1"));
    expect(rows[0].approvalEmailSentAt).toBeTruthy();
  });

  it("idempotence: druhý trigger NEodešle (skipped), force=true ho vynutí", async () => {
    const db = drizzle(env.DB);
    const ref = { itemId: "item-1", sourceId: "/docs/en/whats-new/2026-w24" };

    // 1. trigger → odešle
    await triggerCcNewsApproval(db, envWith({ RESEND_API_KEY: "re_test" }), ref, NOW, fetchers(DIGEST));
    expect(resendCalls).toBe(1);

    // 2. trigger (bez force) → skipped, žádné další odeslání
    const second = await triggerCcNewsApproval(
      db, envWith({ RESEND_API_KEY: "re_test" }), ref, NOW, fetchers(DIGEST),
    );
    expect("skipped" in second && second.skipped).toBe(true);
    expect(resendCalls).toBe(1);

    // 3. trigger s force → znovu odešle
    const third = await triggerCcNewsApproval(
      db, envWith({ RESEND_API_KEY: "re_test" }), ref, NOW, fetchers(DIGEST), { force: true },
    );
    expect("sent" in third && third.sent).toBe(true);
    expect(resendCalls).toBe(2);
  });
});
