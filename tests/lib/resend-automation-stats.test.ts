import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchResendAutomationStats } from "../../src/lib/resend";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchResendAutomationStats", () => {
  it("vrací null bez API klíče (nevolá fetch)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchResendAutomationStats("")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("agreguje běhy per status pro každou automation", async () => {
    vi.stubGlobal("fetch", async (url: string) => {
      if (url.endsWith("/automations")) {
        return Response.json({
          data: [{ id: "a1", name: "Onboarding", status: "enabled" }],
        });
      }
      // /automations/a1/runs
      return Response.json({
        data: [
          { status: "completed" },
          { status: "completed" },
          { status: "running" },
          { status: "failed" },
        ],
      });
    });

    const stats = await fetchResendAutomationStats("re_test");
    expect(stats).toHaveLength(1);
    expect(stats![0]).toMatchObject({
      id: "a1",
      name: "Onboarding",
      status: "enabled",
      completed: 2,
      running: 1,
      failed: 1,
      cancelled: 0,
      total: 4,
    });
  });

  it("total počítá VŠECHNY běhy včetně neznámého statusu (ne jen 4 známé)", async () => {
    vi.stubGlobal("fetch", async (url: string) => {
      if (url.endsWith("/automations")) {
        return Response.json({ data: [{ id: "a1", name: "X", status: "enabled" }] });
      }
      return Response.json({
        data: [
          { status: "completed" },
          { status: "queued" }, // neznámý status — nesmí vypadnout z total
          { status: "scheduled" }, // taky neznámý
        ],
      });
    });
    const stats = await fetchResendAutomationStats("re_test");
    expect(stats![0].completed).toBe(1);
    // total = 3 (všechny běhy), i když známé počty sečtou jen 1
    expect(stats![0].total).toBe(3);
  });

  it("vrací null při chybě list endpointu", async () => {
    vi.stubGlobal("fetch", async () => new Response("nope", { status: 401 }));
    expect(await fetchResendAutomationStats("re_test")).toBeNull();
  });

  it("nepadá, když selže jen runs endpoint — vrátí nulové počty", async () => {
    vi.stubGlobal("fetch", async (url: string) => {
      if (url.endsWith("/automations")) {
        return Response.json({
          data: [{ id: "a1", name: "Onboarding", status: "enabled" }],
        });
      }
      return new Response("boom", { status: 500 });
    });

    const stats = await fetchResendAutomationStats("re_test");
    expect(stats).toHaveLength(1);
    expect(stats![0].total).toBe(0);
  });
});
