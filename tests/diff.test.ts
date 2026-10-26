import { describe, it, expect } from "vitest";
import { computeDiff, diffWords, splitBlocks, similarity } from "@/lib/diff/engine";

describe("splitBlocks", () => {
  it("splits on blank lines with offsets", () => {
    const b = splitBlocks("  A para.\n\n\nB para.\n");
    expect(b.map((x) => x.text)).toEqual(["A para.", "B para."]);
    expect(b[1].start).toBe(12);
  });
});

describe("diffWords", () => {
  it("coalesces confetti into one replacement", () => {
    const segs = diffWords("the quick brown fox jumps", "the slow brown cat jumps");
    // "quick brown fox" -> "slow brown cat" should be a single replace, not two edits around 'brown'
    expect(segs.map((s) => s.type)).toEqual(["equal", "delete", "insert", "equal"]);
    expect(segs[1].text).toBe("quick brown fox");
    expect(segs[2].text).toBe("slow brown cat");
  });

  it("keeps meaningful unchanged islands", () => {
    const segs = diffWords("a one two three four five b", "x one two three four five y");
    expect(segs.find((s) => s.type === "equal" && s.text.includes("one two three four five"))).toBeTruthy();
  });

  it("marks long verbatim runs", () => {
    const segs = diffWords("a b c d e f g h i j", "a b c d e f g h i k", 8);
    expect(segs[0].verbatim).toBe(true);
  });

  it("treats LaTeX commands as single tokens", () => {
    const segs = diffWords("see \\cite{a}", "see \\citep{a}");
    expect(segs.map((s) => s.text)).toEqual(["see ", "\\cite", "\\citep", "{a}"]);
  });
});

describe("computeDiff", () => {
  const oldText = `Intro paragraph that stays the same.

Large language models have changed how researchers write papers.

A paragraph that will be removed entirely.

Closing words.`;
  const newText = `Intro paragraph that stays the same.

Brand new paragraph inserted here.

Big language models have transformed the way researchers draft papers.

Closing words.`;

  it("aligns paragraphs and pairs similar ones", () => {
    const d = computeDiff(oldText, newText, { verbatimRun: 5 });
    expect(d.rows.map((r) => r.kind)).toEqual(["equal", "added", "modified", "removed", "equal"]);
    const mod = d.rows[2];
    if (mod.kind !== "modified") throw new Error();
    expect(mod.similarity).toBeGreaterThan(0.3);
    expect(mod.newStart).toBe(newText.indexOf("Big language"));
  });

  it("computes stats", () => {
    const d = computeDiff(oldText, newText, { verbatimRun: 5 });
    expect(d.changeCount).toBe(3);
    expect(d.stats.equalParas).toBe(2);
    expect(d.stats.newWords).toBe(6 + 5 + 10 + 2);
    expect(d.stats.unchangedPct).toBeGreaterThan(0.3);
    expect(d.stats.unchangedPct).toBeLessThan(0.8);
  });

  it("handles empty baseline", () => {
    const d = computeDiff("", "Something new.");
    expect(d.rows).toHaveLength(1);
    expect(d.rows[0].kind).toBe("added");
  });
});

describe("similarity", () => {
  it("is 1 for identical and 0 for disjoint", () => {
    expect(similarity("a b c", "a b c")).toBe(1);
    expect(similarity("a b c", "x y z")).toBe(0);
  });
});
