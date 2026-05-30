import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchVideoStatistics } from "../../src/lib/bunny-stats";

const env = { BUNNY_API_KEY: "key", BUNNY_LIBRARY_ID: "123" };

type FetchInit = { headers?: Record<string, string> };

function mockFetch(body: unknown, status = 200, statusText = "OK") {
  const fn = vi.fn(async (_url: string, _init?: FetchInit) =>
    new Response(typeof body === "string" ? body : JSON.stringify(body), { status, statusText }),
  );
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fetchVideoStatistics", () => {
  it("sečte hodnoty z viewsChart a watchTimeChart a vezme engagementScore", async () => {
    const fetchMock = mockFetch({
      viewsChart: { "2026-05-01": 10, "2026-05-02": 5 },
      watchTimeChart: { "2026-05-01": 600, "2026-05-02": 300 },
      engagementScore: 72.4,
    });

    const stats = await fetchVideoStatistics(env, "guid-1");

    expect(stats).toEqual({ views: 15, watchTimeSeconds: 900, engagementScore: 72 });
    const call = fetchMock.mock.calls[0]!;
    expect(String(call[0])).toContain("videoGuid=guid-1");
    expect(call[1]?.headers).toMatchObject({ AccessKey: "key" });
  });

  it("zvládne prázdné/chybějící charty (vrátí nuly)", async () => {
    mockFetch({});
    const stats = await fetchVideoStatistics(env, "guid-2");
    expect(stats).toEqual({ views: 0, watchTimeSeconds: 0, engagementScore: 0 });
  });

  it("vyhodí chybu při non-2xx odpovědi", async () => {
    mockFetch("nope", 401, "Unauthorized");
    await expect(fetchVideoStatistics(env, "guid-3")).rejects.toThrow(/401/);
  });
});
