import { describe, expect, it } from "vitest";
import { vttToPlainText } from "../../src/lib/transcribe";

describe("vttToPlainText", () => {
  it("strips WEBVTT header, cue identifiers, and timestamps", () => {
    const vtt = `WEBVTT

1
00:00:00.000 --> 00:00:03.500
Ahoj, vítej v kurzu.

2
00:00:03.500 --> 00:00:07.000
Dnes se podíváme na základy.`;
    expect(vttToPlainText(vtt)).toBe("Ahoj, vítej v kurzu.\n\nDnes se podíváme na základy.");
  });

  it("removes VTT inline tags and word-level timing", () => {
    const vtt = `WEBVTT

00:00:00.000 --> 00:00:02.000
<v Speaker>Toto <c.red>je</c> test</v> <00:00:01.500>slov.`;
    expect(vttToPlainText(vtt)).toBe("Toto je test slov.");
  });

  it("ignores NOTE blocks", () => {
    const vtt = `WEBVTT

NOTE
Tento přepis byl vygenerován automaticky.

00:00:00.000 --> 00:00:02.000
Vlastní obsah.`;
    expect(vttToPlainText(vtt)).toBe("Vlastní obsah.");
  });

  it("collapses multiple blank lines", () => {
    const vtt = `WEBVTT



00:00:00.000 --> 00:00:01.000
První.



00:00:02.000 --> 00:00:03.000
Druhá.`;
    expect(vttToPlainText(vtt)).toBe("První.\n\nDruhá.");
  });

  it("handles CRLF line endings", () => {
    const vtt = "WEBVTT\r\n\r\n00:00:00.000 --> 00:00:01.000\r\nHello.\r\n";
    expect(vttToPlainText(vtt)).toBe("Hello.");
  });

  it("returns empty string for header-only VTT", () => {
    expect(vttToPlainText("WEBVTT\n\n")).toBe("");
  });
});
