import { describe, expect, it } from "vitest";
import { closeTruncatedJson, escapeInnerQuotes, parseJsonLoose } from "../../src/lib/cc-news/llm";

describe("parseJsonLoose — dvojité uvozovky v textu od modelu", () => {
  it("načte JSON, ve kterém model opsal příkaz s uvozovkami", () => {
    const text = '```json\n{"items": [{"text": "Spusť "grok --model fast" a pak "x".", "sources": ["a1"]}, {"text": "ok", "sources": []}]}\n```';
    const out = parseJsonLoose<{ items: { text: string; sources: string[] }[] }>(text);
    expect(out.items[0]!.text).toBe('Spusť "grok --model fast" a pak "x".');
    expect(out.items[0]!.sources).toEqual(["a1"]);
    expect(out.items).toHaveLength(2);
  });

  it("platný JSON nechá beze změny, escapované uvozovky taky", () => {
    const json = '{"a": "b \\"c\\" d", "e": [1, "f"]}';
    expect(escapeInnerQuotes(json)).toBe(json);
    expect(parseJsonLoose<{ a: string }>(json).a).toBe('b "c" d');
  });

  it("doplní chybějící čárku mezi prvky pole na samostatných řádcích", () => {
    const text = '{"items": [\n  {"text": "a", "sources": ["x"]}\n  {"text": "b", "sources": ["y"]}\n]}';
    expect(parseJsonLoose<{ items: unknown[] }>(text).items).toHaveLength(2);
  });

  it("neopravitelný JSON hodí SyntaxError s výřezem kolem chyby", () => {
    expect(() => parseJsonLoose('{"a": 1 "b": 2}')).toThrow(/position \d+.*…\{"a": 1/s);
  });
});

describe("parseJsonLoose — odpověď useknutá limitem tokenů", () => {
  const cut = '{"headline": "H", "items": [\n  {"text": "a", "sources": ["x"], "area": "p"},\n  {"text": "b", "sources": ["y"], "area": "p"},\n  {"text": "c \\"q\\" d", "sour';

  it("bez salvageTruncated hodí chybu", () => {
    expect(() => parseJsonLoose(cut)).toThrow(SyntaxError);
  });

  it("se salvageTruncated ponechá celé prvky a uzavře závorky", () => {
    const out = parseJsonLoose<{ headline: string; items: { text: string }[] }>(cut, { salvageTruncated: true });
    expect(out.headline).toBe("H");
    expect(out.items.map((i) => i.text)).toEqual(["a", "b"]);
  });

  it("úplný JSON nezkracuje", () => {
    expect(closeTruncatedJson('{"a": [1, 2]}')).toBeNull();
  });
});
