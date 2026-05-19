import { env, SELF } from "cloudflare:test";
import { describe, expect, it, beforeEach } from "vitest";

const PARTNER_KEY = "test-partner-key";

async function seedPurchase(opts: {
  id?: number;
  email?: string;
  type?: "individual" | "organization";
  status?: "pending" | "active" | "expired" | "refunded";
  variableSymbol?: string | null;
  paymentMethod?: "stripe" | "fio";
  discountPercent?: number;
  fakturoidInvoiceId?: number | null;
  createdAt?: Date;
  expiresAt?: Date;
  kind?: "paid" | "comp" | "staff";
  compReason?: string | null;
  grantedBy?: string | null;
} = {}) {
  const createdAt = opts.createdAt ?? new Date("2026-05-01T10:00:00Z");
  const expiresAt = opts.expiresAt ?? new Date("2027-05-01T10:00:00Z");
  const sql = `
    INSERT INTO purchase (
      id, email, userId, type, paymentMethod, variableSymbol, fioTransactionId,
      stripePaymentId, stripeSubscriptionId, status, expiresAt, createdAt,
      discountPercent, discountCode, fakturoidInvoiceId, fakturoidSubjectId,
      kind, compReason, grantedBy
    ) VALUES (?, ?, NULL, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?, NULL, ?, NULL, ?, ?, ?)
  `;
  await env.DB.prepare(sql)
    .bind(
      opts.id ?? null,
      opts.email ?? "test@example.com",
      opts.type ?? "individual",
      opts.paymentMethod ?? "fio",
      opts.variableSymbol ?? "33123456",
      opts.status ?? "pending",
      Math.floor(expiresAt.getTime() / 1000),
      Math.floor(createdAt.getTime() / 1000),
      opts.discountPercent ?? 0,
      opts.fakturoidInvoiceId ?? null,
      opts.kind ?? "paid",
      opts.compReason ?? null,
      opts.grantedBy ?? null,
    )
    .run();
}

async function clearPurchases() {
  await env.DB.prepare("DELETE FROM purchase").run();
}

async function clearSiteConfig() {
  await env.DB.prepare("DELETE FROM site_config WHERE key IN ('price_individual', 'price_organization')").run();
}

async function setPrices(individual: number, organization: number) {
  await env.DB.prepare(
    "INSERT OR REPLACE INTO site_config (key, value) VALUES ('price_individual', ?), ('price_organization', ?)"
  ).bind(String(individual), String(organization)).run();
}

describe("partner-api /api/partner/health", () => {
  it("403 without key", async () => {
    const res = await SELF.fetch("https://test.local/api/partner/health");
    expect(res.status).toBe(403);
  });

  it("200 with key", async () => {
    const res = await SELF.fetch("https://test.local/api/partner/health", {
      headers: { "X-Partner-Key": PARTNER_KEY },
    });
    expect(res.status).toBe(200);
    const body = await res.json<{ ok: boolean; service: string }>();
    expect(body.ok).toBe(true);
    expect(body.service).toBe("videokurzy");
  });
});

describe("partner-api /api/partner/purchases", () => {
  beforeEach(async () => {
    await clearPurchases();
    await clearSiteConfig();
  });

  it("403 without key", async () => {
    const res = await SELF.fetch("https://test.local/api/partner/purchases");
    expect(res.status).toBe(403);
  });

  it("returns empty list with stats", async () => {
    const res = await SELF.fetch("https://test.local/api/partner/purchases", {
      headers: { "X-Partner-Key": PARTNER_KEY },
    });
    expect(res.status).toBe(200);
    const body = await res.json<any>();
    expect(body.items).toEqual([]);
    expect(body.total).toBe(0);
    expect(body.stats).toMatchObject({
      total: 0,
      pending: 0,
      active: 0,
      total_revenue: 0,
    });
  });

  it("lists purchases newest-first with computed amount", async () => {
    await seedPurchase({
      id: 1,
      email: "a@example.com",
      type: "individual",
      status: "active",
      variableSymbol: "33000001",
      createdAt: new Date("2026-05-01T10:00:00Z"),
    });
    await seedPurchase({
      id: 2,
      email: "b@example.com",
      type: "organization",
      status: "pending",
      variableSymbol: "33000002",
      discountPercent: 20,
      createdAt: new Date("2026-05-02T10:00:00Z"),
      fakturoidInvoiceId: 999,
    });

    const res = await SELF.fetch("https://test.local/api/partner/purchases", {
      headers: { "X-Partner-Key": PARTNER_KEY },
    });
    const body = await res.json<any>();
    expect(body.total).toBe(2);
    expect(body.items).toHaveLength(2);

    // newest-first
    expect(body.items[0].id).toBe(2);
    expect(body.items[0].type).toBe("organization");
    expect(body.items[0].discount_percent).toBe(20);
    expect(body.items[0].base_price).toBe(15000);
    expect(body.items[0].amount).toBe(12000); // 15000 * 0.8
    expect(body.items[0].fakturoid_invoice_id).toBe(999);

    expect(body.items[1].id).toBe(1);
    expect(body.items[1].base_price).toBe(2000);
    expect(body.items[1].amount).toBe(2000);

    expect(body.stats.pending).toBe(1);
    expect(body.stats.active).toBe(1);
    expect(body.stats.total_revenue).toBe(2000); // jen active se počítá
  });

  it("uses prices from site_config when set", async () => {
    await setPrices(3500, 25000);
    await seedPurchase({ id: 50, type: "individual", status: "active", discountPercent: 0, variableSymbol: "33000050" });
    await seedPurchase({ id: 51, type: "organization", status: "active", discountPercent: 10, variableSymbol: "33000051" });

    const res = await SELF.fetch("https://test.local/api/partner/purchases", {
      headers: { "X-Partner-Key": PARTNER_KEY },
    });
    const body = await res.json<any>();
    const ind = body.items.find((i: any) => i.id === 50);
    const org = body.items.find((i: any) => i.id === 51);
    expect(ind.base_price).toBe(3500);
    expect(ind.amount).toBe(3500);
    expect(org.base_price).toBe(25000);
    expect(org.amount).toBe(22500); // 25000 * 0.9
    expect(body.stats.total_revenue).toBe(3500 + 22500);
  });

  it("filters by status", async () => {
    await seedPurchase({ id: 10, status: "active", variableSymbol: "33000010" });
    await seedPurchase({ id: 11, status: "pending", variableSymbol: "33000011" });
    await seedPurchase({ id: 12, status: "refunded", variableSymbol: "33000012" });

    const res = await SELF.fetch(
      "https://test.local/api/partner/purchases?status=pending",
      { headers: { "X-Partner-Key": PARTNER_KEY } },
    );
    const body = await res.json<any>();
    expect(body.total).toBe(1);
    expect(body.items[0].id).toBe(11);
  });

  it("search matches by email and VS", async () => {
    await seedPurchase({ id: 20, email: "alice@example.com", variableSymbol: "33000020" });
    await seedPurchase({ id: 21, email: "bob@example.com", variableSymbol: "33000021" });

    const byEmail = await SELF.fetch(
      "https://test.local/api/partner/purchases?search=alice",
      { headers: { "X-Partner-Key": PARTNER_KEY } },
    );
    const bodyEmail = await byEmail.json<any>();
    expect(bodyEmail.total).toBe(1);
    expect(bodyEmail.items[0].email).toBe("alice@example.com");

    const byVs = await SELF.fetch(
      "https://test.local/api/partner/purchases?search=33000021",
      { headers: { "X-Partner-Key": PARTNER_KEY } },
    );
    const bodyVs = await byVs.json<any>();
    expect(bodyVs.total).toBe(1);
    expect(bodyVs.items[0].id).toBe(21);
  });

  it("excludes staff rows by default and excludes them from revenue/stats", async () => {
    await seedPurchase({ id: 200, email: "paid@x.cz", status: "active", kind: "paid", variableSymbol: "33000200" });
    await seedPurchase({ id: 201, email: "comp@x.cz", status: "active", kind: "comp", variableSymbol: "33000201", grantedBy: "patrick@vibecoding.cz" });
    await seedPurchase({ id: 202, email: "admin@x.cz", status: "active", kind: "staff", variableSymbol: "33000202" });

    const res = await SELF.fetch("https://test.local/api/partner/purchases", {
      headers: { "X-Partner-Key": PARTNER_KEY },
    });
    const body = await res.json<any>();

    // List vrátí jen paid + comp, staff je defaultně skryté
    expect(body.total).toBe(2);
    const ids = body.items.map((i: any) => i.id).sort();
    expect(ids).toEqual([200, 201]);

    // Stats: staff je úplně vynechaný, revenue jen z paid
    expect(body.stats).toMatchObject({
      total: 2,
      active: 2,
      active_paid: 1,
      active_comp: 1,
      total_revenue: 2000, // jen paid individual za 2000
    });
  });

  it("returns kind/comp metadata and amount=0 for non-paid kinds", async () => {
    await seedPurchase({
      id: 210,
      email: "comp@x.cz",
      type: "individual",
      status: "active",
      kind: "comp",
      compReason: "Recenze pro vibecoding.cz",
      grantedBy: "patrick@vibecoding.cz",
      variableSymbol: "33000210",
    });

    const res = await SELF.fetch("https://test.local/api/partner/purchases", {
      headers: { "X-Partner-Key": PARTNER_KEY },
    });
    const body = await res.json<any>();
    const comp = body.items[0];

    // Granty neukazují finanční částku — base_price zůstává pro referenci,
    // amount musí být 0, aby UI klidně mohlo zobrazovat amount bez další podmínky.
    expect(comp.kind).toBe("comp");
    expect(comp.amount).toBe(0);
    expect(comp.base_price).toBe(2000);
    expect(comp.comp_reason).toBe("Recenze pro vibecoding.cz");
    expect(comp.granted_by).toBe("patrick@vibecoding.cz");
  });

  it("filters by kind=comp", async () => {
    await seedPurchase({ id: 220, status: "active", kind: "paid", variableSymbol: "33000220" });
    await seedPurchase({ id: 221, status: "active", kind: "comp", variableSymbol: "33000221" });
    await seedPurchase({ id: 222, status: "active", kind: "staff", variableSymbol: "33000222" });

    const res = await SELF.fetch(
      "https://test.local/api/partner/purchases?kind=comp",
      { headers: { "X-Partner-Key": PARTNER_KEY } },
    );
    const body = await res.json<any>();
    expect(body.total).toBe(1);
    expect(body.items[0].id).toBe(221);
  });

  it("include_staff=1 surfaces staff rows", async () => {
    await seedPurchase({ id: 230, status: "active", kind: "paid", variableSymbol: "33000230" });
    await seedPurchase({ id: 231, status: "active", kind: "staff", variableSymbol: "33000231" });

    const res = await SELF.fetch(
      "https://test.local/api/partner/purchases?include_staff=1",
      { headers: { "X-Partner-Key": PARTNER_KEY } },
    );
    const body = await res.json<any>();
    expect(body.total).toBe(2);
  });

  it("paginates", async () => {
    for (let i = 1; i <= 5; i++) {
      await seedPurchase({
        id: 100 + i,
        variableSymbol: `3300010${i}`,
        createdAt: new Date(`2026-05-0${i}T10:00:00Z`),
      });
    }
    const res = await SELF.fetch(
      "https://test.local/api/partner/purchases?page=2&limit=2",
      { headers: { "X-Partner-Key": PARTNER_KEY } },
    );
    const body = await res.json<any>();
    expect(body.total).toBe(5);
    expect(body.pages).toBe(3);
    expect(body.page).toBe(2);
    expect(body.limit).toBe(2);
    expect(body.items).toHaveLength(2);
  });
});

describe("partner-api /api/partner/purchases/:id", () => {
  beforeEach(async () => {
    await clearPurchases();
    await clearSiteConfig();
  });

  it("403 without key", async () => {
    const res = await SELF.fetch("https://test.local/api/partner/purchases/1");
    expect(res.status).toBe(403);
  });

  it("404 for missing id", async () => {
    const res = await SELF.fetch("https://test.local/api/partner/purchases/9999", {
      headers: { "X-Partner-Key": PARTNER_KEY },
    });
    expect(res.status).toBe(404);
  });

  it("400 for non-numeric id", async () => {
    const res = await SELF.fetch("https://test.local/api/partner/purchases/abc", {
      headers: { "X-Partner-Key": PARTNER_KEY },
    });
    expect(res.status).toBe(400);
  });

  it("returns detail", async () => {
    await seedPurchase({
      id: 42,
      email: "detail@example.com",
      type: "organization",
      status: "active",
      paymentMethod: "stripe",
      variableSymbol: null,
      discountPercent: 10,
    });
    const res = await SELF.fetch("https://test.local/api/partner/purchases/42", {
      headers: { "X-Partner-Key": PARTNER_KEY },
    });
    expect(res.status).toBe(200);
    const body = await res.json<any>();
    expect(body.purchase).toMatchObject({
      id: 42,
      email: "detail@example.com",
      type: "organization",
      payment_method: "stripe",
      status: "active",
      base_price: 15000,
      amount: 13500, // 15000 * 0.9
      discount_percent: 10,
    });
  });
});
