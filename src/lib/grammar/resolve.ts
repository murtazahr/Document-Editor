import { findLoose } from "@/lib/latex-prose";

/** Pure helpers for the grammar checker: chunking input and resolving model edits to offsets. */

export type RawSuggestion = { original: string; replacement: string; reason: string; category: string };

export type Suggestion = RawSuggestion & {
  id: string;
  /** offsets into the full text that was checked */
  from: number;
  to: number;
};

export const CATEGORIES = ["spelling", "grammar", "punctuation", "word-choice", "clarity", "consistency"] as const;

/** Split text into chunks of at most `max` chars, cutting at blank lines where possible. */
export function chunkText(text: string, max = 8000): { text: string; offset: number }[] {
  if (text.length <= max) return [{ text, offset: 0 }];
  const chunks: { text: string; offset: number }[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + max);
    if (end < text.length) {
      const window = text.slice(start, end);
      const cut = Math.max(window.lastIndexOf("\n\n"), window.lastIndexOf("\n"));
      if (cut > max * 0.4) end = start + cut + 1;
    }
    chunks.push({ text: text.slice(start, end), offset: start });
    start = end;
  }
  return chunks;
}

/**
 * Map model suggestions back onto the chunk text. Each `original` must be a
 * verbatim substring; suggestions that cannot be located are dropped. Search
 * proceeds forward so repeated phrases resolve in document order.
 */
export function resolveSuggestions(chunk: string, raw: RawSuggestion[], offset = 0, idPrefix = "s"): { resolved: Suggestion[]; unresolved: RawSuggestion[] } {
  const resolved: Suggestion[] = [];
  const unresolved: RawSuggestion[] = [];
  let cursor = 0;
  let n = 0;
  for (const s of raw) {
    const original = s.original ?? "";
    const replacement = s.replacement ?? "";
    if (!original || original === replacement) continue;
    let idx = chunk.indexOf(original, cursor);
    if (idx < 0) idx = chunk.indexOf(original);
    let end = idx >= 0 ? idx + original.length : -1;
    if (idx < 0) {
      const loose = findLoose(chunk, original, cursor) ?? findLoose(chunk, original, 0);
      if (loose) { idx = loose.start; end = loose.end; }
    }
    if (idx < 0) { unresolved.push(s); continue; }
    // avoid overlapping an earlier suggestion
    if (resolved.some((r) => idx < r.to - offset && end > r.from - offset)) { unresolved.push(s); continue; }
    cursor = end;
    resolved.push({ ...s, original: chunk.slice(idx, end), replacement, id: `${idPrefix}${n++}`, from: offset + idx, to: offset + end });
  }
  resolved.sort((a, b) => a.from - b.from);
  return { resolved, unresolved };
}

/**
 * Apply one suggestion to `text` if its span still holds the original (or the
 * original can be found uniquely elsewhere). Returns the new text, the applied
 * range, and the length delta to shift later suggestions by.
 */
export function applySuggestion(text: string, s: Pick<Suggestion, "from" | "to" | "original" | "replacement">): { text: string; from: number; to: number; delta: number } | null {
  let from = s.from, to = s.to;
  if (text.slice(from, to) !== s.original) {
    const first = text.indexOf(s.original);
    if (first < 0 || text.indexOf(s.original, first + 1) >= 0) return null;
    from = first; to = first + s.original.length;
  }
  return { text: text.slice(0, from) + s.replacement + text.slice(to), from, to, delta: s.replacement.length - s.original.length };
}

/** Shift the offsets of suggestions located after an edit at `at` by `delta`. */
export function shiftAfter<T extends { from: number; to: number }>(list: T[], at: number, delta: number): T[] {
  return list.map((s) => (s.from >= at ? { ...s, from: s.from + delta, to: s.to + delta } : s));
}

/** Deterministic fake suggestions for ANTHROPIC_MOCK=1. */
export function mockSuggestions(text: string): RawSuggestion[] {
  const rules: { re: RegExp; to: (m: string) => string; reason: string; category: string }[] = [
    { re: /\butilized?\b/g, to: (m) => (m.endsWith("d") ? "used" : "use"), reason: "Prefer the plain word.", category: "word-choice" },
    { re: /\bin order to\b/g, to: () => "to", reason: "Shorter without loss of meaning.", category: "clarity" },
    { re: /\bNevertheless, it is crucial to acknowledge that\b/g, to: () => "However,", reason: "Wordy transition.", category: "clarity" },
    { re: /\bIt is important to note that\s+(\w)/g, to: (m) => m.slice(-1).toUpperCase(), reason: "Filler phrase; the sentence is stronger without it.", category: "clarity" },
    { re: /(?<=\S)[ \t]{2,}(?=\S)/g, to: () => " ", reason: "Double space.", category: "punctuation" },
    { re: /\bteh\b/g, to: () => "the", reason: "Spelling.", category: "spelling" },
  ];
  const out: RawSuggestion[] = [];
  for (const r of rules) for (const m of text.matchAll(r.re)) out.push({ original: m[0], replacement: r.to(m[0]), reason: r.reason + " (mock)", category: r.category });
  return out;
}
