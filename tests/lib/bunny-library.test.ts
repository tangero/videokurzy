import { describe, it, expect, vi, afterEach } from "vitest";
import {
  getBunnyLibraries,
  lessonEmbedUrl,
  listLibraryVideos,
  normalizeLessonLibraryId,
  resolveBunnyLibrary,
} from "../../src/lib/bunny-library";

const baseEnv = {
  BUNNY_LIBRARY_ID: "111",
  BUNNY_API_KEY: "main-api",
  BUNNY_TOKEN_KEY: "main-token",
  BUNNY_PULL_ZONE: "vz-main.b-cdn.net",
};

const extra = JSON.stringify({
  "655172": { apiKey: "x-api", tokenKey: "x-token", pullZone: "vz-1d2aadf9-9ec.b-cdn.net", name: "Druhá" },
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("getBunnyLibraries / resolveBunnyLibrary", () => {
  it("bez BUNNY_EXTRA_LIBRARIES vrátí jen hlavní library", () => {
    const libs = getBunnyLibraries(baseEnv);
    expect(libs).toHaveLength(1);
    expect(libs[0]).toMatchObject({ id: "111", apiKey: "main-api", isPrimary: true });
  });

  it("načte extra library z JSON", () => {
    const env = { ...baseEnv, BUNNY_EXTRA_LIBRARIES: extra };
    const lib = resolveBunnyLibrary(env, "655172");
    expect(lib).toMatchObject({
      id: "655172",
      apiKey: "x-api",
      tokenKey: "x-token",
      pullZone: "vz-1d2aadf9-9ec.b-cdn.net",
      name: "Druhá",
      isPrimary: false,
    });
  });

  it("prázdné ID = hlavní library, neznámé ID = null", () => {
    const env = { ...baseEnv, BUNNY_EXTRA_LIBRARIES: extra };
    expect(resolveBunnyLibrary(env, null)?.id).toBe("111");
    expect(resolveBunnyLibrary(env, "")?.id).toBe("111");
    expect(resolveBunnyLibrary(env, "999")).toBeNull();
  });

  it("nevalidní JSON nespadne, jen zůstane hlavní library", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const env = { ...baseEnv, BUNNY_EXTRA_LIBRARIES: "{nope" };
    expect(getBunnyLibraries(env).map((l) => l.id)).toEqual(["111"]);
  });

  it("položku bez tokenKey přeskočí", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const env = { ...baseEnv, BUNNY_EXTRA_LIBRARIES: JSON.stringify({ "5": { apiKey: "a" } }) };
    expect(resolveBunnyLibrary(env, "5")).toBeNull();
  });
});

describe("normalizeLessonLibraryId", () => {
  const env = { ...baseEnv, BUNNY_EXTRA_LIBRARIES: extra };
  it("hlavní library ukládá jako null", () => {
    expect(normalizeLessonLibraryId(env, "111")).toBeNull();
    expect(normalizeLessonLibraryId(env, "")).toBeNull();
  });
  it("extra library ukládá jako její ID, neznámou odmítne", () => {
    expect(normalizeLessonLibraryId(env, "655172")).toBe("655172");
    expect(normalizeLessonLibraryId(env, "999")).toBeUndefined();
  });
});

describe("lessonEmbedUrl", () => {
  const env = { ...baseEnv, BUNNY_EXTRA_LIBRARIES: extra };
  it("použije library lekce", () => {
    expect(lessonEmbedUrl(env, { bunnyVideoId: "v1", bunnyLibraryId: "655172" })).toContain("/embed/655172/v1?");
    expect(lessonEmbedUrl(env, { bunnyVideoId: "v1", bunnyLibraryId: null })).toContain("/embed/111/v1?");
  });
  it("nenakonfigurovaná library nebo chybějící video → prázdná URL", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(lessonEmbedUrl(env, { bunnyVideoId: "v1", bunnyLibraryId: "999" })).toBe("");
    expect(lessonEmbedUrl(env, { bunnyVideoId: null, bunnyLibraryId: null })).toBe("");
  });
});

describe("listLibraryVideos", () => {
  it("volá API library s jejím klíčem a řadí od nejnovějšího", async () => {
    const fetchMock = vi.fn(async (_url: URL, _init?: { headers?: Record<string, string> }) =>
      new Response(
        JSON.stringify({
          totalItems: 3,
          items: [
            { guid: "a", title: "Starší", dateUploaded: "2026-09-01T10:00:00", length: 60, status: 4 },
            { guid: "c", title: "Nejnovější", dateUploaded: "2026-10-10T10:00:00", length: 90, status: 3 },
            { guid: "b", title: "Prostřední", dateUploaded: "2026-10-01T10:00:00", length: 30, status: 4 },
          ],
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const lib = resolveBunnyLibrary({ ...baseEnv, BUNNY_EXTRA_LIBRARIES: extra }, "655172")!;
    const { items, totalItems } = await listLibraryVideos(lib, { search: "ahoj" });

    expect(items.map((v) => v.guid)).toEqual(["c", "b", "a"]);
    expect(totalItems).toBe(3);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("/library/655172/videos");
    expect(String(url)).toContain("orderBy=date");
    expect(String(url)).toContain("search=ahoj");
    expect(init?.headers).toMatchObject({ AccessKey: "x-api" });
  });
});
