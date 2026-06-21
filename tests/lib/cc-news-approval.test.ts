import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { ccNewsItem } from "../../src/db/schema";
import {
  signApprovalIntent,
  verifyApprovalIntent,
  APPROVAL_TOKEN_TTL_MS,
} from "../../src/lib/cc-news/approval";
import {
  prepareDraftAndApproval,
  approveItem,
  draftKvKey,
  articleRepoPath,
} from "../../src/lib/cc-news/draft";

const SECRET = { AUTH_INTERNAL_SECRET: "test-internal-secret" };
const NOW = new Date("2026-06-21T12:00:00.000Z");

describe("cc-news approval token (R4 bezpečnost)", () => {
  it("round-trips a valid intent", async () => {
    const token = await signApprovalIntent(SECRET, {
      itemId: "item-1",
      nonce: "n1",
      expiresAt: NOW.getTime() + APPROVAL_TOKEN_TTL_MS,
    });
    const intent = await verifyApprovalIntent(SECRET, token, NOW.getTime());
    expect(intent).toMatchObject({ itemId: "item-1", nonce: "n1" });
  });

  it("rejects a tampered signature", async () => {
    const token = await signApprovalIntent(SECRET, {
      itemId: "item-1",
      nonce: "n1",
      expiresAt: NOW.getTime() + APPROVAL_TOKEN_TTL_MS,
    });
    const [body] = token.split(".");
    const forged = `${body}.AAAAtampered`;
    expect(await verifyApprovalIntent(SECRET, forged, NOW.getTime())).toBeNull();
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await signApprovalIntent({ AUTH_INTERNAL_SECRET: "other" }, {
      itemId: "item-1",
      nonce: "n1",
      expiresAt: NOW.getTime() + APPROVAL_TOKEN_TTL_MS,
    });
    expect(await verifyApprovalIntent(SECRET, token, NOW.getTime())).toBeNull();
  });

  it("rejects an expired token", async () => {
    const token = await signApprovalIntent(SECRET, {
      itemId: "item-1",
      nonce: "n1",
      expiresAt: NOW.getTime() - 1,
    });
    expect(await verifyApprovalIntent(SECRET, token, NOW.getTime())).toBeNull();
  });

  it("rejects a malformed token", async () => {
    expect(await verifyApprovalIntent(SECRET, "garbage", NOW.getTime())).toBeNull();
    expect(await verifyApprovalIntent(SECRET, "a.b.c", NOW.getTime())).toBeNull();
  });
});

describe("cc-news prepareDraftAndApproval (R3 dry-run)", () => {
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

  const meta = { slug: "2026-w24-novinky", weekLabel: "Week 24", versionRange: "v2.1.166 → v2.1.176" };

  it("stores the draft in KV and writes nonce + articlePath, dry-run does not send", async () => {
    const db = drizzle(env.DB);
    const result = await prepareDraftAndApproval(
      db,
      env as never,
      "item-1",
      "# Článek\nobsah",
      meta,
      NOW
    );

    expect(result.mode).toBe("dry-run");
    expect(result.sent).toBe(false); // R3: e-mail se NEodesílá

    // markdown v KV
    expect(await env.KV.get(draftKvKey("item-1"))).toBe("# Článek\nobsah");

    // nonce + articlePath na řádce
    const rows = await db.select().from(ccNewsItem).where(eq(ccNewsItem.id, "item-1"));
    expect(rows[0].approveNonce).toBeTruthy();
    expect(rows[0].articlePath).toBe(articleRepoPath("2026-w24-novinky"));
    expect(rows[0].status).toBe("draft"); // nepublikováno bez schválení

    // schvalovací e-mail je připravený, ale neodeslaný
    expect(result.email.subject).toMatch(/Novinky v Claude Code — Week 24/);
    expect(result.email.html).toMatch(/Schválit a publikovat/);
    expect(result.approveUrl).toMatch(/\/internal\/cc-news\/approve\?token=/);
  });

  it("the prepared token verifies and carries the stored nonce (R4 link → schválení)", async () => {
    const db = drizzle(env.DB);
    const result = await prepareDraftAndApproval(db, env as never, "item-1", "x", meta, NOW);

    const token = decodeURIComponent(result.approveUrl.split("token=")[1]);
    const intent = await verifyApprovalIntent(env as never, token);
    expect(intent).not.toBeNull();

    const rows = await db.select().from(ccNewsItem).where(eq(ccNewsItem.id, "item-1"));
    expect(intent!.nonce).toBe(rows[0].approveNonce); // jednorázovost se ověří proti DB
    expect(intent!.itemId).toBe("item-1");
  });
});

describe("cc-news approveItem (R4 publikace + jednorázovost)", () => {
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM cc_news_item");
    const db = drizzle(env.DB);
    await db.insert(ccNewsItem).values({
      id: "item-1",
      sourceId: "/docs/en/whats-new/2026-w24",
      contentHash: "h",
      weekLabel: "Week 24",
      versionRange: null,
      status: "draft",
      createdAt: NOW,
    });
  });

  const meta = { slug: "2026-w24", weekLabel: "Week 24", versionRange: null };

  async function prepareToken(db: ReturnType<typeof drizzle>): Promise<string> {
    const r = await prepareDraftAndApproval(db, env as never, "item-1", "x", meta, NOW);
    return decodeURIComponent(r.approveUrl.split("token=")[1]);
  }

  it("publishes the item on a valid first click", async () => {
    const db = drizzle(env.DB);
    const token = await prepareToken(db);

    const res = await approveItem(db, env as never, token, NOW);
    expect(res).toMatchObject({ ok: true, status: "published" });

    const rows = await db.select().from(ccNewsItem).where(eq(ccNewsItem.id, "item-1"));
    expect(rows[0].status).toBe("published");
    expect(rows[0].publishedAt).not.toBeNull();
    expect(rows[0].approveNonce).toBeNull(); // nonce spotřebován

    // promote: draft blob se zkopíroval do published KV (živá verze pro detail)
    const { publishedKvKey, draftKvKey } = await import("../../src/lib/cc-news/draft");
    expect(await env.KV.get(publishedKvKey("item-1"))).toBe(await env.KV.get(draftKvKey("item-1")));
  });

  it("rejects the SECOND click with the same link (one-time use)", async () => {
    const db = drizzle(env.DB);
    const token = await prepareToken(db);

    const first = await approveItem(db, env as never, token, NOW);
    expect(first.ok).toBe(true);

    const second = await approveItem(db, env as never, token, NOW);
    expect(second).toMatchObject({ ok: false, reason: "already-published" });

    // status zůstal published, nezdvojilo se
    const rows = await db.select().from(ccNewsItem).where(eq(ccNewsItem.id, "item-1"));
    expect(rows[0].status).toBe("published");
  });

  it("rejects a forged token without touching the row", async () => {
    const db = drizzle(env.DB);
    await prepareToken(db);
    const res = await approveItem(db, env as never, "garbage.sig", NOW);
    expect(res).toMatchObject({ ok: false, reason: "invalid-token" });
    const rows = await db.select().from(ccNewsItem).where(eq(ccNewsItem.id, "item-1"));
    expect(rows[0].status).toBe("draft");
  });
});
