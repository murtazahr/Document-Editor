import { diffArrays } from "diff";

/**
 * Paragraph-aware, word-level diff tuned for reading rewritten prose.
 *
 * 1. Split both texts into paragraphs (blank-line separated).
 * 2. Align paragraphs; pair up removed/added neighbours that look alike.
 * 3. Inside each modified pair, diff word tokens and coalesce "confetti"
 *    (tiny unchanged islands between edits) into single replacements.
 * 4. Mark long runs of unchanged words so a rewriter can see what they
 *    have not touched yet.
 */

export type Segment = {
  type: "equal" | "insert" | "delete";
  text: string;
  words: number;
  /** equal segment at least `verbatimRun` words long */
  verbatim?: boolean;
};

export type Block = { text: string; start: number; end: number };

export type Row =
  | { kind: "equal"; oldIndex: number; newIndex: number; text: string; oldStart: number; newStart: number; words: number; verbatim: boolean }
  | { kind: "modified"; oldIndex: number; newIndex: number; oldText: string; newText: string; segments: Segment[]; similarity: number; oldStart: number; newStart: number }
  | { kind: "added"; newIndex: number; text: string; newStart: number; words: number }
  | { kind: "removed"; oldIndex: number; text: string; oldStart: number; words: number };

export type Stats = {
  oldWords: number;
  newWords: number;
  unchangedWords: number;
  insertedWords: number;
  deletedWords: number;
  /** words of the new text that sit inside unchanged runs >= verbatimRun */
  verbatimWords: number;
  verbatimRuns: number;
  equalParas: number;
  modifiedParas: number;
  addedParas: number;
  removedParas: number;
  /** share of the new text's words that are unchanged from the baseline */
  unchangedPct: number;
  /** share of the new text's words inside long unchanged runs */
  verbatimPct: number;
};

export type DiffResult = { rows: Row[]; stats: Stats; changeCount: number };

export type DiffOptions = {
  /** minimum number of consecutive unchanged words to flag as verbatim (default 8) */
  verbatimRun?: number;
  /** paragraph similarity (0-1) needed to pair a removed with an added paragraph (default 0.3) */
  pairThreshold?: number;
};

const TOKEN_RE = /\\[a-zA-Z@]+\*?|\\.|\s+|[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*|./gsu;
const WORD_RE = /^[\p{L}\p{N}]/u;

export function tokenize(text: string): string[] {
  return text.match(TOKEN_RE) ?? [];
}

export function wordCount(text: string): number {
  let n = 0;
  for (const t of tokenize(text)) if (WORD_RE.test(t)) n++;
  return n;
}

export function splitBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  const re = /\n[ \t]*\n\s*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  const push = (s: number, e: number) => {
    // trim whitespace but keep offsets accurate
    let a = s, b = e;
    while (a < b && /\s/.test(text[a])) a++;
    while (b > a && /\s/.test(text[b - 1])) b--;
    if (b > a) blocks.push({ text: text.slice(a, b), start: a, end: b });
  };
  while ((m = re.exec(text))) {
    push(last, m.index);
    last = m.index + m[0].length;
  }
  push(last, text.length);
  return blocks;
}

function normalize(s: string) {
  return s.replace(/\s+/g, " ").trim();
}

function wordSet(s: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of tokenize(s)) if (WORD_RE.test(t)) { const k = t.toLowerCase(); m.set(k, (m.get(k) ?? 0) + 1); }
  return m;
}

/** Dice coefficient over word multisets. */
export function similarity(a: string, b: string): number {
  const wa = wordSet(a), wb = wordSet(b);
  let inter = 0, na = 0, nb = 0;
  for (const [, c] of wa) na += c;
  for (const [, c] of wb) nb += c;
  if (na + nb === 0) return normalize(a) === normalize(b) ? 1 : 0;
  for (const [k, c] of wa) inter += Math.min(c, wb.get(k) ?? 0);
  return (2 * inter) / (na + nb);
}

type Group = { eq?: string[]; del?: string[]; ins?: string[] };

export function diffWords(oldText: string, newText: string, verbatimRun = 8): Segment[] {
  const a = tokenize(oldText);
  const b = tokenize(newText);
  const parts = diffArrays(a, b);
  // 1. group into alternating equal / change groups
  const groups: Group[] = [];
  for (const p of parts) {
    const v = p.value as string[];
    if (p.added) {
      const g = groups.length && !groups[groups.length - 1].eq ? groups[groups.length - 1] : (groups.push({}), groups[groups.length - 1]);
      g.ins = (g.ins ?? []).concat(v);
    } else if (p.removed) {
      const g = groups.length && !groups[groups.length - 1].eq ? groups[groups.length - 1] : (groups.push({}), groups[groups.length - 1]);
      g.del = (g.del ?? []).concat(v);
    } else {
      groups.push({ eq: v });
    }
  }
  // 2. coalesce change, small-equal, change (semantic cleanup): an unchanged
  //    island is absorbed when it is no longer than the edits on both sides.
  const wordsOf = (ts: string[] | undefined) => (ts ?? []).reduce((n, t) => n + (WORD_RE.test(t) ? 1 : 0), 0);
  const changeSize = (g: Group) => Math.max(wordsOf(g.del), wordsOf(g.ins));
  const isSmall = (eq: string[], before: Group, after: Group) => {
    const text = eq.join("");
    if (!text.trim()) return true;
    const w = wordsOf(eq);
    return w <= 2 && text.trim().length <= 20 && w <= changeSize(before) && w <= changeSize(after);
  };
  const merged: Group[] = [];
  for (const g of groups) {
    const prev = merged[merged.length - 1];
    const prev2 = merged[merged.length - 2];
    if (g.eq === undefined && prev?.eq && prev2 && prev2.eq === undefined && isSmall(prev.eq, prev2, g)) {
      merged.pop();
      merged.pop();
      merged.push({
        del: [...(prev2.del ?? []), ...prev.eq, ...(g.del ?? [])],
        ins: [...(prev2.ins ?? []), ...prev.eq, ...(g.ins ?? [])],
      });
    } else merged.push(g);
  }
  // 3. emit segments
  const segs: Segment[] = [];
  const words = (ts: string[]) => ts.reduce((n, t) => n + (WORD_RE.test(t) ? 1 : 0), 0);
  for (const g of merged) {
    if (g.eq) {
      const w = words(g.eq);
      segs.push({ type: "equal", text: g.eq.join(""), words: w, verbatim: w >= verbatimRun });
    } else {
      if (g.del?.length) segs.push({ type: "delete", text: g.del.join(""), words: words(g.del) });
      if (g.ins?.length) segs.push({ type: "insert", text: g.ins.join(""), words: words(g.ins) });
    }
  }
  return segs;
}

export function computeDiff(oldText: string, newText: string, opts: DiffOptions = {}): DiffResult {
  const verbatimRun = opts.verbatimRun ?? 8;
  const threshold = opts.pairThreshold ?? 0.3;
  const oldBlocks = splitBlocks(oldText);
  const newBlocks = splitBlocks(newText);
  const parts = diffArrays(oldBlocks, newBlocks, { comparator: (x, y) => normalize(x.text) === normalize(y.text) });

  const rows: Row[] = [];
  let oi = 0, ni = 0;
  let pendingRemoved: number[] = [];
  let pendingAdded: number[] = [];

  const flush = () => {
    if (!pendingRemoved.length && !pendingAdded.length) return;
    // pair removed/added by similarity, greedily best-first
    const pairs: { r: number; a: number; s: number }[] = [];
    for (const r of pendingRemoved) for (const a of pendingAdded) {
      const s = similarity(oldBlocks[r].text, newBlocks[a].text);
      if (s >= threshold) pairs.push({ r, a, s });
    }
    pairs.sort((x, y) => y.s - x.s);
    const rMatch = new Map<number, { a: number; s: number }>();
    const aUsed = new Set<number>();
    for (const p of pairs) {
      if (rMatch.has(p.r) || aUsed.has(p.a)) continue;
      rMatch.set(p.r, { a: p.a, s: p.s });
      aUsed.add(p.a);
    }
    const addedEmitted = new Set<number>();
    const emitAddedBefore = (limit: number) => {
      for (const a of pendingAdded) {
        if (a < limit && !aUsed.has(a) && !addedEmitted.has(a)) {
          addedEmitted.add(a);
          rows.push({ kind: "added", newIndex: a, text: newBlocks[a].text, newStart: newBlocks[a].start, words: wordCount(newBlocks[a].text) });
        }
      }
    };
    for (const r of pendingRemoved) {
      const m = rMatch.get(r);
      if (m) {
        emitAddedBefore(m.a);
        rows.push({
          kind: "modified", oldIndex: r, newIndex: m.a, oldText: oldBlocks[r].text, newText: newBlocks[m.a].text,
          segments: diffWords(oldBlocks[r].text, newBlocks[m.a].text, verbatimRun), similarity: m.s,
          oldStart: oldBlocks[r].start, newStart: newBlocks[m.a].start,
        });
      } else {
        rows.push({ kind: "removed", oldIndex: r, text: oldBlocks[r].text, oldStart: oldBlocks[r].start, words: wordCount(oldBlocks[r].text) });
      }
    }
    emitAddedBefore(Infinity);
    pendingRemoved = [];
    pendingAdded = [];
  };

  for (const p of parts) {
    const n = p.value.length;
    if (p.removed) { for (let k = 0; k < n; k++) pendingRemoved.push(oi++); }
    else if (p.added) { for (let k = 0; k < n; k++) pendingAdded.push(ni++); }
    else {
      flush();
      for (let k = 0; k < n; k++) {
        const w = wordCount(newBlocks[ni].text);
        rows.push({ kind: "equal", oldIndex: oi, newIndex: ni, text: newBlocks[ni].text, oldStart: oldBlocks[oi].start, newStart: newBlocks[ni].start, words: w, verbatim: w >= verbatimRun });
        oi++; ni++;
      }
    }
  }
  flush();

  const stats: Stats = {
    oldWords: 0, newWords: 0, unchangedWords: 0, insertedWords: 0, deletedWords: 0, verbatimWords: 0, verbatimRuns: 0,
    equalParas: 0, modifiedParas: 0, addedParas: 0, removedParas: 0, unchangedPct: 0, verbatimPct: 0,
  };
  for (const r of rows) {
    if (r.kind === "equal") {
      stats.equalParas++; stats.oldWords += r.words; stats.newWords += r.words; stats.unchangedWords += r.words;
      if (r.verbatim) { stats.verbatimWords += r.words; stats.verbatimRuns++; }
    } else if (r.kind === "added") { stats.addedParas++; stats.newWords += r.words; stats.insertedWords += r.words; }
    else if (r.kind === "removed") { stats.removedParas++; stats.oldWords += r.words; stats.deletedWords += r.words; }
    else {
      stats.modifiedParas++;
      for (const s of r.segments) {
        if (s.type === "equal") { stats.oldWords += s.words; stats.newWords += s.words; stats.unchangedWords += s.words; if (s.verbatim) { stats.verbatimWords += s.words; stats.verbatimRuns++; } }
        else if (s.type === "insert") { stats.newWords += s.words; stats.insertedWords += s.words; }
        else { stats.oldWords += s.words; stats.deletedWords += s.words; }
      }
    }
  }
  stats.unchangedPct = stats.newWords ? stats.unchangedWords / stats.newWords : 0;
  stats.verbatimPct = stats.newWords ? stats.verbatimWords / stats.newWords : 0;
  const changeCount = rows.filter((r) => r.kind !== "equal").length;
  return { rows, stats, changeCount };
}
