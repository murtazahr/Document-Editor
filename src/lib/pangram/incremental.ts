import { computeDiff } from "@/lib/diff/engine";
import { countWords, findLoose } from "@/lib/latex-prose";
import type { PangramResult, PangramWindow } from "./types";

/**
 * Incremental detection: re-analyse only the paragraphs that changed since the
 * previous run and reuse the previous windows for paragraphs that did not.
 *
 * Pangram bills per started 100-word block per item, so all changed paragraphs
 * are sent as ONE item (joined by blank lines) to minimise billable units.
 */

export type IncrementalPlan = {
  /** windows from the previous result that fall entirely inside unchanged paragraphs, re-based onto the new prose */
  reusedWindows: PangramWindow[];
  /** text to send to Pangram: the changed/added paragraphs in document order, blank-line separated */
  changedText: string;
  changedParagraphs: number;
  reusedParagraphs: number;
  totalParagraphs: number;
  wordsToSend: number;
  wordsTotal: number;
  /** words covered by reused windows */
  wordsReused: number;
};

export type IncrementalInfo = {
  reusedParagraphs: number;
  changedParagraphs: number;
  totalParagraphs: number;
  wordsSent: number;
  wordsTotal: number;
  /** billable units actually sent (Pangram 4: one per started 100 words, min 1 when anything is sent) */
  unitsSent: number;
  /** units a full run would have cost */
  unitsFull: number;
};

const PARA_SPLIT = /\n[ \t]*\n\s*/;

/** Split a window into pieces that do not cross paragraph boundaries. */
function piecesOf(w: PangramWindow): string[] {
  return w.text.split(PARA_SPLIT).map((p) => p.trim()).filter(Boolean);
}

function withRange(w: PangramWindow, text: string, start: number, end: number): PangramWindow {
  return { ...w, text, start_index: start, end_index: end, word_count: countWords(text) };
}

export function unitsFor(words: number) {
  return words > 0 ? Math.max(1, Math.ceil(words / 100)) : 0;
}

export function planIncremental(prevProse: string, prevWindows: PangramWindow[], newProse: string): IncrementalPlan {
  const diff = computeDiff(prevProse, newProse);
  // unchanged paragraphs: old range -> new range
  const equal = diff.rows.filter((r) => r.kind === "equal").map((r) => (r.kind === "equal" ? { oldStart: r.oldStart, oldEnd: r.oldStart + r.text.length, newStart: r.newStart, newEnd: r.newStart + r.text.length } : null)!).filter(Boolean);
  const changed = diff.rows
    .filter((r) => r.kind === "modified" || r.kind === "added")
    .map((r) => (r.kind === "modified" ? { start: r.newStart, text: r.newText } : r.kind === "added" ? { start: r.newStart, text: r.text } : null)!)
    .sort((a, b) => a.start - b.start);

  const reused: PangramWindow[] = [];
  let oldCursor = 0;
  for (const w of prevWindows) {
    for (const piece of piecesOf(w)) {
      const loc = findLoose(prevProse, piece, oldCursor) ?? findLoose(prevProse, piece, 0);
      if (!loc) continue;
      oldCursor = loc.end;
      const para = equal.find((e) => loc.start >= e.oldStart && loc.end <= e.oldEnd);
      if (!para) continue; // inside a modified/removed paragraph: will be re-analysed
      const nloc = findLoose(newProse.slice(para.newStart, para.newEnd), piece, 0);
      if (!nloc) continue;
      const start = para.newStart + nloc.start;
      const end = para.newStart + nloc.end;
      reused.push(withRange(w, newProse.slice(start, end), start, end));
    }
  }
  reused.sort((a, b) => a.start_index - b.start_index);
  const changedText = changed.map((c) => c.text).join("\n\n");
  return {
    reusedWindows: reused,
    changedText,
    changedParagraphs: changed.length,
    reusedParagraphs: equal.length,
    totalParagraphs: diff.rows.filter((r) => r.kind !== "removed").length,
    wordsToSend: countWords(changedText),
    wordsTotal: countWords(newProse),
    wordsReused: reused.reduce((n, w) => n + w.word_count, 0),
  };
}

/**
 * Merge the result for the changed text with the reused windows into one result
 * whose offsets refer to `newProse`. Document-level fields are derived locally
 * from window word counts and are labelled as such.
 */
export function mergeIncremental(plan: IncrementalPlan, newProse: string, partial: PangramResult | null): PangramResult & { incremental: IncrementalInfo } {
  const windows: PangramWindow[] = [...plan.reusedWindows];
  if (partial?.windows) {
    let cursor = 0;
    for (const w of partial.windows) {
      for (const piece of piecesOf(w)) {
        const loc = findLoose(newProse, piece, cursor) ?? findLoose(newProse, piece, 0);
        if (!loc) continue;
        cursor = loc.end;
        windows.push(withRange(w, newProse.slice(loc.start, loc.end), loc.start, loc.end));
      }
    }
  }
  windows.sort((a, b) => a.start_index - b.start_index);
  const total = windows.reduce((n, w) => n + w.word_count, 0) || 1;
  const share = (label: string) => windows.filter((w) => w.label === label).reduce((n, w) => n + w.word_count, 0) / total;
  const fa = share("AI-Generated"), fas = share("AI-Assisted"), fh = share("Human Written");
  const short = fa >= 0.5 ? "AI" : fh >= 0.5 && fa < 0.1 ? "Human" : "Mixed";
  const info: IncrementalInfo = {
    reusedParagraphs: plan.reusedParagraphs, changedParagraphs: plan.changedParagraphs, totalParagraphs: plan.totalParagraphs,
    wordsSent: plan.wordsToSend, wordsTotal: plan.wordsTotal, unitsSent: unitsFor(plan.wordsToSend), unitsFull: unitsFor(plan.wordsTotal),
  };
  return {
    stage: "STAGE_SUCCESS",
    text: newProse,
    version: partial?.version,
    headline: `${Math.round(fa * 100)}% AI-generated, ${Math.round(fas * 100)}% AI-assisted (incremental)`,
    prediction: `Incremental run: ${info.changedParagraphs} changed paragraph(s) re-analysed (${info.wordsSent} words), ${info.reusedParagraphs} unchanged paragraph(s) kept their previous windows. Document-level figures are computed locally from the windows; run a full analysis for Pangram's own document verdict.`,
    prediction_short: short,
    fraction_ai: fa, fraction_ai_assisted: fas, fraction_human: fh,
    num_ai_segments: windows.filter((w) => w.label === "AI-Generated").length,
    num_ai_assisted_segments: windows.filter((w) => w.label === "AI-Assisted").length,
    num_human_segments: windows.filter((w) => w.label === "Human Written").length,
    windows,
    incremental: info,
  };
}
