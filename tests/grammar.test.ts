import { describe, it, expect } from "vitest";
import { chunkText, resolveSuggestions, applySuggestion, shiftAfter, mockSuggestions } from "@/lib/grammar/resolve";

describe("chunkText", () => {
  it("returns one chunk for short text and splits long text at blank lines", () => {
    expect(chunkText("short", 100)).toEqual([{ text: "short", offset: 0 }]);
    const para = "word ".repeat(30).trim();
    const text = [para, para, para, para].join("\n\n");
    const chunks = chunkText(text, 350);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map((c) => c.text).join("")).toBe(text);
    for (const c of chunks) expect(text.slice(c.offset, c.offset + c.text.length)).toBe(c.text);
  });
});

describe("resolveSuggestions", () => {
  const text = "We utilize the method. The the results are good. We utilize it again.";
  it("locates verbatim originals in document order and skips unlocatable ones", () => {
    const { resolved, unresolved } = resolveSuggestions(text, [
      { original: "utilize", replacement: "use", reason: "plain", category: "word-choice" },
      { original: "The the", replacement: "The", reason: "dup", category: "grammar" },
      { original: "utilize", replacement: "use", reason: "plain", category: "word-choice" },
      { original: "not in text", replacement: "x", reason: "", category: "grammar" },
    ], 100);
    expect(unresolved).toHaveLength(1);
    expect(resolved.map((s) => [s.from - 100, s.to - 100])).toEqual([[3, 10], [23, 30], [52, 59]]);
    expect(text.slice(resolved[2].from - 100, resolved[2].to - 100)).toBe("utilize");
  });
  it("drops no-op and overlapping suggestions", () => {
    const { resolved, unresolved } = resolveSuggestions(text, [
      { original: "utilize the method", replacement: "use the method", reason: "", category: "word-choice" },
      { original: "the method", replacement: "the approach", reason: "", category: "word-choice" },
      { original: "good", replacement: "good", reason: "", category: "grammar" },
    ]);
    expect(resolved).toHaveLength(1);
    expect(unresolved).toHaveLength(1);
  });
  it("tolerates whitespace differences in the original", () => {
    const { resolved } = resolveSuggestions("alpha  beta\ngamma", [{ original: "beta gamma", replacement: "beta, gamma", reason: "", category: "punctuation" }]);
    expect(resolved).toHaveLength(1);
    expect(resolved[0].original).toBe("beta\ngamma");
  });
});

describe("applySuggestion / shiftAfter", () => {
  it("applies at the recorded span and shifts later spans", () => {
    const text = "aa utilize bb utilize cc";
    const s1 = { from: 3, to: 10, original: "utilize", replacement: "use" };
    const s2 = { from: 14, to: 21, original: "utilize", replacement: "use" };
    const r = applySuggestion(text, s1)!;
    expect(r.text).toBe("aa use bb utilize cc");
    const [s2b] = shiftAfter([s2], r.to, r.delta);
    expect(r.text.slice(s2b.from, s2b.to)).toBe("utilize");
  });
  it("relocates when the span moved and the original is unique, else refuses", () => {
    const moved = applySuggestion("xx The the end", { from: 0, to: 7, original: "The the", replacement: "The" });
    expect(moved?.text).toBe("xx The end");
    expect(applySuggestion("a b a b", { from: 0, to: 1, original: "b", replacement: "c" })).toBeNull();
  });
});

describe("mockSuggestions", () => {
  it("produces locatable suggestions", () => {
    const t = "We utilize this in order to  win.";
    const { resolved } = resolveSuggestions(t, mockSuggestions(t));
    expect(resolved.map((s) => s.replacement)).toEqual(["use", "to", " "]);
  });
});
