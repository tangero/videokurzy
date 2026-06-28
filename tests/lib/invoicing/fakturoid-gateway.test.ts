import { describe, it, expect } from "vitest";
import {
  invoiceLineName,
  ensureSubjectId,
  ensureInvoiceCreated,
  ensurePaymentRecorded,
  ensureInvoiceSent,
  type FakturoidApi,
} from "../../../src/lib/invoicing/fakturoid-gateway";

/** Mock FakturoidApi — GET dle registrovaných handlerů, POST se zaznamenává. */
function mockApi(handlers: {
  get?: (path: string) => unknown;
  post?: (path: string, body?: unknown) => unknown;
}) {
  const calls: { method: "GET" | "POST"; path: string; body?: unknown }[] = [];
  const api: FakturoidApi = {
    get: async <T>(path: string) => {
      calls.push({ method: "GET", path });
      return (handlers.get?.(path) ?? null) as T;
    },
    post: async <T>(path: string, body?: unknown) => {
      calls.push({ method: "POST", path, body });
      return (handlers.post?.(path, body) ?? {}) as T;
    },
  };
  return { api, calls };
}

const SUBJECT = { email: "a@b.cz", name: "a@b.cz" };

describe("invoiceLineName", () => {
  it("osobní předplatné", () => {
    expect(invoiceLineName({ jobKind: "initial_purchase", isOrganization: false })).toContain("osobní předplatné");
  });
  it("firemní licence s doménou", () => {
    expect(invoiceLineName({ jobKind: "initial_purchase", isOrganization: true, domain: "firma.cz" }))
      .toBe("Roční přístup ke kurzům — firemní licence (firma.cz)");
  });
});

describe("ensureSubjectId", () => {
  it("najde dle IČO (přesná shoda registration_no)", async () => {
    const { api, calls } = mockApi({
      get: (p) => (p.includes("subjects/search") ? [{ id: 5, registration_no: "07350996" }] : null),
    });
    const id = await ensureSubjectId(api, { ...SUBJECT, companyIco: "07350996" });
    expect(id).toBe(5);
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("padne na e-mail, když IČO nesedí", async () => {
    const { api } = mockApi({
      get: (p) =>
        p.includes("07350996")
          ? [{ id: 9, registration_no: "99999999" }] // jiné IČO → bez shody
          : [{ id: 12, email: "a@b.cz" }],
    });
    const id = await ensureSubjectId(api, { ...SUBJECT, companyIco: "07350996" });
    expect(id).toBe(12);
  });

  it("založí nový, když nic nenajde", async () => {
    const { api, calls } = mockApi({ get: () => [], post: () => ({ id: 77 }) });
    const id = await ensureSubjectId(api, SUBJECT);
    expect(id).toBe(77);
    expect(calls.find((c) => c.method === "POST")?.path).toBe("subjects.json");
  });
});

describe("ensureInvoiceCreated", () => {
  const input = { customId: "vk-purchase-1", lineName: "Roční přístup", amount: 3000, paidOn: "2026-06-27", subject: SUBJECT };

  it("adoptuje existující fakturu se shodným custom_id (nevytvoří druhou)", async () => {
    const { api, calls } = mockApi({
      get: (p) => (p.startsWith("invoices.json?custom_id") ? [{ id: 100, subject_id: 5 }] : null),
    });
    const res = await ensureInvoiceCreated(api, input);
    expect(res).toEqual({ invoiceId: 100, subjectId: 5, adopted: true });
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("vytvoří novou s custom_id, když žádná není", async () => {
    const { api, calls } = mockApi({
      get: (p) => (p.startsWith("invoices.json?custom_id") ? [] : []),
      post: (p) => (p === "subjects.json" ? { id: 5 } : { id: 200 }),
    });
    const res = await ensureInvoiceCreated(api, input);
    expect(res).toEqual({ invoiceId: 200, subjectId: 5, adopted: false });
    const post = calls.find((c) => c.path === "invoices.json");
    expect((post?.body as Record<string, unknown>).custom_id).toBe("vk-purchase-1");
    expect((post?.body as Record<string, unknown>).issued_on).toBe("2026-06-27");
  });
});

describe("ensurePaymentRecorded", () => {
  it("zaeviduje platbu, když faktura není zaplacená", async () => {
    const { api, calls } = mockApi({ get: () => ({ id: 1, status: "open", payments: [] }) });
    const res = await ensurePaymentRecorded(api, 1, 3000, "2026-06-27");
    expect(res.status).toBe("recorded");
    expect(calls.find((c) => c.method === "POST")?.path).toBe("invoices/1/payments.json");
  });

  it("už zaplaceno (paid_on) → neopakuje POST", async () => {
    const { api, calls } = mockApi({ get: () => ({ id: 1, status: "paid", paid_on: "2026-06-27", payments: [] }) });
    const res = await ensurePaymentRecorded(api, 1, 3000, "2026-06-27");
    expect(res.status).toBe("already_paid");
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("existující platba se shodnou částkou → already_paid", async () => {
    const { api } = mockApi({ get: () => ({ id: 1, payments: [{ amount: "3000.0" }] }) });
    const res = await ensurePaymentRecorded(api, 1, 3000, "2026-06-27");
    expect(res.status).toBe("already_paid");
  });

  it("existující platba s JINOU částkou → mismatch", async () => {
    const { api } = mockApi({ get: () => ({ id: 1, payments: [{ amount: "2000.0" }] }) });
    const res = await ensurePaymentRecorded(api, 1, 3000, "2026-06-27");
    expect(res).toEqual({ status: "mismatch", remoteTotal: 2000 });
  });
});

describe("ensureInvoiceSent", () => {
  it("už odesláno (sent_at) → neposílá znovu", async () => {
    const { api, calls } = mockApi({ get: () => ({ id: 1, sent_at: "2026-06-27T10:57:31+02:00" }) });
    const res = await ensureInvoiceSent(api, 1, "a@b.cz");
    expect(res.status).toBe("already_sent");
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("neodesláno → pošle message.json", async () => {
    const { api, calls } = mockApi({ get: () => ({ id: 1, sent_at: null }) });
    const res = await ensureInvoiceSent(api, 1, "a@b.cz");
    expect(res.status).toBe("sent");
    const post = calls.find((c) => c.method === "POST");
    expect(post?.path).toBe("invoices/1/message.json");
    expect((post?.body as Record<string, unknown>).email).toBe("a@b.cz");
  });
});
