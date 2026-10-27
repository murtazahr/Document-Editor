import { describe, it, expect } from "vitest";
import { planIncremental, mergeIncremental, unitsFor } from "@/lib/pangram/incremental";
import { mockDetect } from "@/lib/pangram/client";

const P1 = "The first paragraph talks about large language models and how they write papers for people.";
const P2 = "The second paragraph is about diff representations that highlight unchanged spans of text clearly.";
const P3 = "The third paragraph concludes the document with a summary and a note on future work directions.";
const OLD = [P1, P2, P3].join("\n\n");

describe("planIncremental", () => {
  it("sends nothing when the text is unchanged and reuses every window", () => {
    const prev = mockDetect(OLD);
    const plan = planIncremental(OLD, prev.windows!, OLD);
    expect(plan.changedText).toBe("");
    expect(plan.wordsToSend).toBe(0);
    expect(plan.reusedWindows).toHaveLength(3);
    expect(plan.reusedWindows.map((w) => w.text)).toEqual([P1, P2, P3]);
  });

  it("sends only modified and added paragraphs, keeps the rest", () => {
    const prev = mockDetect(OLD);
    const P2b = "The second paragraph is now about something else entirely, rewritten by hand in my own words.";
    const P4 = "A brand new fourth paragraph that did not exist before and must be analysed from scratch.";
    const NEW = [P1, P2b, P3, P4].join("\n\n");
    const plan = planIncremental(OLD, prev.windows!, NEW);
    expect(plan.changedText).toBe([P2b, P4].join("\n\n"));
    expect(plan.changedParagraphs).toBe(2);
    expect(plan.reusedParagraphs).toBe(2);
    expect(plan.reusedWindows.map((w) => w.text)).toEqual([P1, P3]);
    // re-based offsets point at the right text in the new prose
    for (const w of plan.reusedWindows) expect(NEW.slice(w.start_index, w.end_index)).toBe(w.text);
    expect(plan.wordsToSend).toBeLessThan(plan.wordsTotal);
  });

  it("drops reused windows that cross into a changed paragraph", () => {
    // one window spanning P1+P2 in the previous result
    const prevWindows = [{ ...mockDetect(OLD).windows![0], text: `${P1}\n\n${P2}`, end_index: P1.length + 2 + P2.length }];
    const NEW = [P1, "changed", P3].join("\n\n");
    const plan = planIncremental(OLD, prevWindows, NEW);
    expect(plan.reusedWindows.map((w) => w.text)).toEqual([P1]);
  });
});

describe("mergeIncremental", () => {
  it("combines reused and new windows with offsets into the new prose and derives fractions", () => {
    const prev = mockDetect(OLD);
    const P2b = "The second paragraph is now about something else entirely, rewritten by hand in my own words.";
    const NEW = [P1, P2b, P3].join("\n\n");
    const plan = planIncremental(OLD, prev.windows!, NEW);
    const partial = mockDetect(plan.changedText);
    const merged = mergeIncremental(plan, NEW, partial);
    expect(merged.windows!.map((w) => w.text)).toEqual([P1, P2b, P3]);
    for (const w of merged.windows!) expect(NEW.slice(w.start_index, w.end_index)).toBe(w.text);
    const sum = (merged.fraction_ai ?? 0) + (merged.fraction_ai_assisted ?? 0) + (merged.fraction_human ?? 0);
    expect(sum).toBeCloseTo(1, 5);
    expect(merged.incremental.changedParagraphs).toBe(1);
    expect(merged.incremental.unitsSent).toBe(1);
    expect(merged.text).toBe(NEW);
  });
});

describe("unitsFor", () => {
  it("bills per started 100 words, minimum one", () => {
    expect(unitsFor(0)).toBe(0);
    expect(unitsFor(1)).toBe(1);
    expect(unitsFor(100)).toBe(1);
    expect(unitsFor(101)).toBe(2);
  });
});
