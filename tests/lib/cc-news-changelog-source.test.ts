import { afterEach, describe, expect, it, vi } from "vitest";
import {
  changelogSourceId,
  compareVersions,
  fetchChangelog,
  isoWeek,
  isoWeekBounds,
  lastClosedWeek,
  parseChangelog,
  parseEntryLine,
  parseReleaseDates,
  parseVersionRange,
  weekFromSourceId,
  weekVersionRange,
} from "../../src/lib/cc-news/changelog-source";

const CHANGELOG = `# Changelog

## 2.1.271

- Added fast mode in Claude Code Remote sessions
- [VSCode] Added accept and reject buttons under each change
- Windows: Fixed every file write being refused on exFAT drives
- Fixed a crash
- Fixed a crash

## 2.1.270

- Improved startup time

## 2.1.269

- Added \`claude plugin eval\`
`;

const DOCS = `<Update label="2.1.271" description="September 14, 2026">
<Update label="2.1.270" description="September 12, 2026">
<Update label="2.1.269" description="September 11, 2026">`;

const DOCS_MARKDOWN = `**2.1.271**

September 14, 2026

**2.1.270**

September 12, 2026

**2.1.269**

September 11, 2026`;

function mockChangelogFetch(docs: string) {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) =>
    new Response(String(input).includes("raw.githubusercontent.com") ? CHANGELOG : docs));
}

afterEach(() => vi.unstubAllGlobals());

describe("parseEntryLine", () => {
  it("rozpozná typ a platformu v hranatých závorkách i s dvojtečkou", () => {
    expect(parseEntryLine("- [VSCode] Added accept buttons")).toEqual({ type: "Added", scope: "VSCode", text: "Added accept buttons" });
    expect(parseEntryLine("- Windows: Fixed writes")).toEqual({ type: "Fixed", scope: "Windows", text: "Fixed writes" });
    expect(parseEntryLine("- Claude now does X")).toEqual({ type: "Other", scope: null, text: "Claude now does X" });
  });
});

describe("parseReleaseDates", () => {
  it("přečte původní Update i nový Markdown s CRLF konci řádků", () => {
    const docs = `<Update label="2.1.268" description="September 10, 2026">\n${DOCS_MARKDOWN.replaceAll("\n", "\r\n")}`;
    const dates = parseReleaseDates(docs);
    expect(dates.size).toBe(4);
    expect(dates.get("2.1.268")?.toISOString()).toBe("2026-09-10T12:00:00.000Z");
    expect(dates.get("2.1.270")?.toISOString()).toBe("2026-09-12T12:00:00.000Z");
  });
});

describe("fetchChangelog", () => {
  it("stáhne vlastní changelog s daty v obou formátech", async () => {
    for (const docs of [DOCS, DOCS_MARKDOWN]) {
      mockChangelogFetch(docs);
      const entries = await fetchChangelog("2.1.270");
      expect(entries.map((e) => e.version)).toEqual(["2.1.270", "2.1.271", "2.1.271", "2.1.271", "2.1.271", "2.1.271"]);
    }
  });

  it("odmítne neúplnou synchronizaci při chybějícím datu verze", async () => {
    mockChangelogFetch(`**2.1.271**\n\nSeptember 14, 2026`);
    await expect(fetchChangelog("2.1.270")).rejects.toThrow(/2\.1\.270.*neúplné vydání/);
  });
});

describe("parseChangelog", () => {
  it("vezme jen verze s datem a od minVersion, nejstarší první", async () => {
    const entries = await parseChangelog(CHANGELOG, parseReleaseDates(DOCS), "2.1.270");
    expect(entries.map((e) => e.version)).toEqual(["2.1.270", "2.1.271", "2.1.271", "2.1.271", "2.1.271", "2.1.271"]);
    expect(entries[0]!.publishedAt.toISOString()).toBe("2026-09-12T12:00:00.000Z");
  });

  it("ID je stabilní podle textu, ne podle pořadí řádku", async () => {
    const a = await parseChangelog(CHANGELOG, parseReleaseDates(DOCS));
    const shifted = CHANGELOG.replace("## 2.1.271\n\n", "## 2.1.271\n\n- Added a brand new line\n");
    const b = await parseChangelog(shifted, parseReleaseDates(DOCS));
    const fast = (xs: typeof a) => xs.find((e) => e.text.startsWith("Added fast mode"))!;
    expect(fast(a).id).toBe(fast(b).id);
    expect(fast(a).ord).toBe(1);
    expect(fast(b).ord).toBe(2);
  });

  it("stejný text dvakrát v jedné verzi dostane odlišné ID", async () => {
    const entries = await parseChangelog(CHANGELOG, parseReleaseDates(DOCS));
    const crashes = entries.filter((e) => e.text === "Fixed a crash");
    expect(new Set(crashes.map((e) => e.id)).size).toBe(2);
  });

  it("verzi bez data v dokumentaci přeskočí", async () => {
    const entries = await parseChangelog(CHANGELOG, parseReleaseDates(DOCS.split("\n")[0]!));
    expect(new Set(entries.map((e) => e.version))).toEqual(new Set(["2.1.271"]));
  });
});

describe("týdny", () => {
  it("isoWeek a hranice týdne (pondělí–neděle UTC)", () => {
    expect(isoWeek(new Date("2026-09-14T00:00:00Z"))).toEqual({ year: 2026, week: 38 });
    expect(isoWeek(new Date("2026-09-20T23:59:00Z"))).toEqual({ year: 2026, week: 38 });
    const { start, end } = isoWeekBounds(2026, 38);
    expect(start.toISOString()).toBe("2026-09-14T00:00:00.000Z");
    expect(end.toISOString()).toBe("2026-09-20T23:59:59.999Z");
  });

  it("týden před 2027-w01 je 2026-w53 (rok s 53 týdny)", () => {
    expect(isoWeek(new Date(isoWeekBounds(2027, 1).start.getTime() - 86_400_000))).toEqual({ year: 2026, week: 53 });
  });

  it("poslední uzavřený týden v pondělí ráno = minulý týden", () => {
    expect(lastClosedWeek(new Date("2026-10-19T03:00:00Z"))).toEqual({ year: 2026, week: 42 });
  });

  it("sourceId a zpětný parse", () => {
    expect(changelogSourceId({ year: 2026, week: 9 })).toBe("/changelog/2026-w09");
    expect(weekFromSourceId("/changelog/2026-w38")).toEqual({ year: 2026, week: 38 });
    expect(weekFromSourceId("/docs/en/whats-new/2026-w37")).toEqual({ year: 2026, week: 37 });
  });

  it("parseVersionRange zvládne pomlčku i šipku", () => {
    expect(parseVersionRange("v2.1.270–v2.1.278")).toEqual({ from: "2.1.270", to: "2.1.278" });
    expect(parseVersionRange("v2.1.166 → v2.1.176")).toEqual({ from: "2.1.166", to: "2.1.176" });
    expect(parseVersionRange(null)).toBeNull();
  });

  it("compareVersions porovnává čísla, ne řetězce", () => {
    expect(compareVersions("2.1.10", "2.1.9")).toBeGreaterThan(0);
  });
});

describe("weekVersionRange", () => {
  const d = (s: string) => new Date(`${s}T12:00:00Z`);
  const entries = [
    { version: "2.1.269", publishedAt: d("2026-09-11") },
    { version: "2.1.270", publishedAt: d("2026-09-12") }, // sobota před W38
    { version: "2.1.271", publishedAt: d("2026-09-14") },
    { version: "2.1.278", publishedAt: d("2026-09-19") },
    { version: "2.1.280", publishedAt: d("2026-09-22") }, // už W39
  ];
  const { start, end } = isoWeekBounds(2026, 38);

  it("přibere osiřelou sobotní verzi po konci minulého vydání", () => {
    expect(weekVersionRange(entries, "2.1.269", start, end)).toEqual({ from: "2.1.270", to: "2.1.278", versions: ["2.1.270", "2.1.271", "2.1.278"] });
  });

  it("po delší pauze nesloučí starší týdny do jednoho článku", () => {
    const w39 = isoWeekBounds(2026, 39);
    // poslední vydání skončilo dávno (2.1.200) → bere se jen W39 + 3 dny před ním
    // (sobotní 2.1.278 ano, starší 2.1.270/2.1.271 už ne)
    expect(weekVersionRange(entries, "2.1.200", w39.start, w39.end)?.versions).toEqual(["2.1.278", "2.1.280"]);
  });

  it("bez nových verzí vrátí null", () => {
    expect(weekVersionRange(entries, "2.1.278", start, end)).toBeNull();
  });
});
