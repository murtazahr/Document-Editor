"use client";

import { useMemo, useRef, useState } from "react";
import { ChevronUp, ChevronDown, Camera, ClipboardPaste, Trash2, Eye, EyeOff } from "lucide-react";
import { computeDiff, type Row, type Segment } from "@/lib/diff/engine";
import { latexToProse } from "@/lib/latex-prose";
import { cn } from "@/components/ui/cn";

type Props = {
  baseline: string | null;
  current: string;
  /** jump the editor to a source offset */
  onJump: (from: number, to?: number) => void;
  onSnapshotBaseline: () => void;
  onSetBaseline: (text: string) => void;
  onClearBaseline: () => void;
};

type Layout = "inline" | "side";
type TextMode = "prose" | "source";

function pct(x: number) { return `${Math.round(x * 100)}%`; }

export default function DiffView({ baseline, current, onJump, onSnapshotBaseline, onSetBaseline, onClearBaseline }: Props) {
  const [layout, setLayout] = useState<Layout>("inline");
  const [textMode, setTextMode] = useState<TextMode>("prose");
  const [onlyChanges, setOnlyChanges] = useState(true);
  const [showDeletions, setShowDeletions] = useState(true);
  const [verbatimRun, setVerbatimRun] = useState(8);
  const [cursor, setCursor] = useState(0);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const container = useRef<HTMLDivElement>(null);

  const prepared = useMemo(() => {
    if (baseline === null) return null;
    if (textMode === "source") return { oldText: baseline, newText: current, newMap: null as Int32Array | null };
    const o = latexToProse(baseline);
    const n = latexToProse(current);
    return { oldText: o.text, newText: n.text, newMap: n.map };
  }, [baseline, current, textMode]);

  const diff = useMemo(() => (prepared ? computeDiff(prepared.oldText, prepared.newText, { verbatimRun }) : null), [prepared, verbatimRun]);

  const changeRows = useMemo(() => (diff ? diff.rows.map((r, i) => ({ r, i })).filter((x) => x.r.kind !== "equal") : []), [diff]);

  // reset navigation when the comparison itself changes (derived-state pattern, no effect)
  const resetKey = `${textMode}|${baseline?.length ?? -1}`;
  const [prevResetKey, setPrevResetKey] = useState(resetKey);
  if (prevResetKey !== resetKey) { setPrevResetKey(resetKey); setCursor(0); setExpanded(new Set()); }
  const safeCursor = Math.min(cursor, Math.max(0, changeRows.length - 1));

  const jumpToRow = (row: Row) => {
    const start = row.kind === "removed" ? null : row.newStart;
    if (start === null) return;
    const len = row.kind === "modified" ? row.newText.length : row.kind === "added" || row.kind === "equal" ? row.text.length : 0;
    if (prepared?.newMap) {
      const m = prepared.newMap;
      if (m.length === 0) return;
      const a = m[Math.min(start, m.length - 1)];
      const b = m[Math.min(start + Math.max(0, len - 1), m.length - 1)] + 1;
      onJump(a, b);
    } else onJump(start, start + len);
  };

  const go = (delta: number) => {
    if (!changeRows.length) return;
    const next = (safeCursor + delta + changeRows.length) % changeRows.length;
    setCursor(next);
    const el = container.current?.querySelector<HTMLElement>(`[data-row="${changeRows[next].i}"]`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  };

  const onKey = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === "INPUT" || (e.target as HTMLElement).tagName === "TEXTAREA") return;
    if (e.key === "j" || e.key === "n" || e.key === "ArrowDown") { e.preventDefault(); go(1); }
    else if (e.key === "k" || e.key === "p" || e.key === "ArrowUp") { e.preventDefault(); go(-1); }
    else if (e.key === "Enter" && changeRows[safeCursor]) jumpToRow(changeRows[safeCursor].r);
  };

  if (baseline === null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
        <div className="max-w-sm">
          <h3 className="text-base font-semibold">No baseline for this file</h3>
          <p className="mt-1 text-sm text-muted">The diff compares your rewrite against the original text. Snapshot the current file as the baseline before you start rewriting, or paste the original draft.</p>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-primary" onClick={onSnapshotBaseline}><Camera size={14} /> Use current text as baseline</button>
          <button className="btn" onClick={() => setPasteOpen(true)}><ClipboardPaste size={14} /> Paste original…</button>
        </div>
        {pasteOpen && <PasteDialog value={pasteText} onChange={setPasteText} onCancel={() => setPasteOpen(false)} onSave={() => { onSetBaseline(pasteText); setPasteOpen(false); setPasteText(""); }} />}
      </div>
    );
  }

  const s = diff!.stats;
  const rewritten = 1 - s.unchangedPct;

  // group rows for rendering, collapsing runs of equal rows when onlyChanges
  const groups: Array<{ type: "row"; i: number } | { type: "collapsed"; from: number; to: number }> = [];
  if (diff) {
    let i = 0;
    while (i < diff.rows.length) {
      if (onlyChanges && diff.rows[i].kind === "equal" && !expanded.has(i)) {
        let j = i;
        while (j < diff.rows.length && diff.rows[j].kind === "equal" && !expanded.has(j)) j++;
        groups.push({ type: "collapsed", from: i, to: j });
        i = j;
      } else { groups.push({ type: "row", i }); i++; }
    }
  }
  const currentRowIndex = changeRows[safeCursor]?.i ?? -1;

  return (
    <div className="flex h-full flex-col" tabIndex={0} onKeyDown={onKey} ref={container}>
      {/* stats */}
      <div className="border-b border-border px-3 py-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <div className="flex items-baseline gap-1.5">
            <span className="text-xl font-semibold tabular-nums">{pct(rewritten)}</span>
            <span className="text-xs text-muted">rewritten</span>
          </div>
          <div className="h-2 w-40 overflow-hidden rounded-full bg-panel-2" title={`${s.unchangedWords} unchanged · ${s.insertedWords} added words`}>
            <div className="bar-seg float-left" style={{ width: pct(s.unchangedPct), background: "var(--border)" }} />
            <div className="bar-seg float-left" style={{ width: pct(1 - s.unchangedPct), background: "var(--ins-fg)" }} />
          </div>
          <span className="chip" style={{ color: "var(--ins-fg)" }}>+{s.insertedWords}</span>
          <span className="chip" style={{ color: "var(--del-fg)" }}>−{s.deletedWords}</span>
          <span className="chip">{s.unchangedWords} unchanged</span>
          <span className="chip" title={`Words sitting in unchanged runs of ≥ ${verbatimRun} words`} style={{ color: "var(--verb)" }}>{s.verbatimRuns} verbatim run{s.verbatimRuns === 1 ? "" : "s"} · {pct(s.verbatimPct)}</span>
          <span className="chip">{s.modifiedParas} modified · {s.addedParas} added · {s.removedParas} removed · {s.equalParas} same</span>
        </div>
      </div>
      {/* controls */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-1.5 text-xs">
        <div className="seg">
          <button data-active={layout === "inline"} onClick={() => setLayout("inline")}>Inline</button>
          <button data-active={layout === "side"} onClick={() => setLayout("side")}>Side by side</button>
        </div>
        <div className="seg">
          <button data-active={textMode === "prose"} onClick={() => setTextMode("prose")} title="Compare the readable text, ignoring LaTeX markup">Prose</button>
          <button data-active={textMode === "source"} onClick={() => setTextMode("source")} title="Compare the raw LaTeX source">Source</button>
        </div>
        <label className="flex items-center gap-1"><input type="checkbox" checked={onlyChanges} onChange={(e) => setOnlyChanges(e.target.checked)} /> Only changes</label>
        {layout === "inline" && <button className="btn btn-ghost btn-sm" onClick={() => setShowDeletions((v) => !v)} title="Toggle deleted text">{showDeletions ? <Eye size={12} /> : <EyeOff size={12} />} deletions</button>}
        <label className="flex items-center gap-1" title="Flag unchanged runs of at least this many words">Verbatim ≥ <input type="number" min={3} max={40} className="input !w-14 !py-0.5" value={verbatimRun} onChange={(e) => setVerbatimRun(Math.max(3, Number(e.target.value) || 8))} /> words</label>
        <span className="flex-1" />
        <div className="flex items-center gap-1">
          <button className="btn btn-ghost btn-sm" onClick={() => go(-1)} disabled={!changeRows.length} title="Previous change (k)"><ChevronUp size={13} /></button>
          <span className="tabular-nums text-muted">{changeRows.length ? `${safeCursor + 1} / ${changeRows.length}` : "no changes"}</span>
          <button className="btn btn-ghost btn-sm" onClick={() => go(1)} disabled={!changeRows.length} title="Next change (j)"><ChevronDown size={13} /></button>
        </div>
        <div className="flex items-center gap-1">
          <button className="btn btn-sm" onClick={() => { if (confirm("Replace the baseline with the current text? The diff will reset to empty.")) onSnapshotBaseline(); }} title="Snapshot the current text as the new baseline"><Camera size={12} /> Re-baseline</button>
          <button className="btn btn-sm" onClick={() => setPasteOpen(true)} title="Paste a different original"><ClipboardPaste size={12} /></button>
          <button className="btn btn-sm btn-danger" onClick={() => { if (confirm("Remove the baseline for this file?")) onClearBaseline(); }} title="Remove baseline"><Trash2 size={12} /></button>
        </div>
      </div>
      {/* rows */}
      <div className="scroll-thin min-h-0 flex-1 overflow-auto px-3 py-3">
        {diff && diff.changeCount === 0 && <p className="py-8 text-center text-sm text-muted">The current text is identical to the baseline. Start rewriting and the changes will appear here.</p>}
        <div className="space-y-2">
          {groups.map((g, gi) => {
            if (g.type === "collapsed") {
              const n = g.to - g.from;
              return (
                <button key={`c${gi}`} className="w-full rounded-md border border-dashed border-border py-1.5 text-center text-xs text-muted hover:bg-panel-2" onClick={() => setExpanded((s) => { const nx = new Set(s); for (let k = g.from; k < g.to; k++) nx.add(k); return nx; })}>
                  ⋯ {n} unchanged paragraph{n === 1 ? "" : "s"} — click to show
                </button>
              );
            }
            const row = diff!.rows[g.i];
            return <DiffRow key={g.i} index={g.i} row={row} layout={layout} textMode={textMode} showDeletions={showDeletions} current={g.i === currentRowIndex} onClick={() => { const ci = changeRows.findIndex((x) => x.i === g.i); if (ci >= 0) setCursor(ci); jumpToRow(row); }} />;
          })}
        </div>
      </div>
      {pasteOpen && <PasteDialog value={pasteText} onChange={setPasteText} onCancel={() => setPasteOpen(false)} onSave={() => { onSetBaseline(pasteText); setPasteOpen(false); setPasteText(""); }} />}
    </div>
  );
}

function Segs({ segs, side, showDeletions }: { segs: Segment[]; side: "both" | "old" | "new"; showDeletions: boolean }) {
  return (
    <>
      {segs.map((s, i) => {
        if (s.type === "equal") return <span key={i} className={cn(s.verbatim && "diff-verb")} title={s.verbatim ? `${s.words} words unchanged` : undefined}>{s.text}</span>;
        if (s.type === "delete") return side === "new" ? null : <del key={i} className={cn("diff-del", !showDeletions && side === "both" && "diff-hidden")}>{s.text}</del>;
        return side === "old" ? null : <ins key={i} className="diff-ins">{s.text}</ins>;
      })}
    </>
  );
}

function DiffRow({ index, row, layout, textMode, showDeletions, current, onClick }: { index: number; row: Row; layout: Layout; textMode: TextMode; showDeletions: boolean; current: boolean; onClick: () => void }) {
  const textCls = textMode === "prose" ? "diff-prose" : "diff-source";
  const label = row.kind === "modified" ? `${Math.round(row.similarity * 100)}% similar` : row.kind === "added" ? "added" : row.kind === "removed" ? "removed" : row.verbatim ? "unchanged · verbatim" : "unchanged";
  const head = (
    <div className="mb-1 flex items-center gap-2 text-[11px] text-muted">
      <span className="font-mono">¶{(row.kind === "removed" ? row.oldIndex : row.newIndex) + 1}</span>
      <span>{label}</span>
      {row.kind !== "removed" && <span className="ml-auto opacity-0 group-hover:opacity-100">click to jump to editor</span>}
    </div>
  );
  const body = (() => {
    if (row.kind === "equal") return <div className={cn(textCls, row.verbatim && "diff-verb")}>{row.text}</div>;
    if (row.kind === "added") return <div className={textCls}><ins className="diff-ins">{row.text}</ins></div>;
    if (row.kind === "removed") return <div className={cn(textCls, "opacity-80")}><del className="diff-del">{row.text}</del></div>;
    if (layout === "inline") return <div className={textCls}><Segs segs={row.segments} side="both" showDeletions={showDeletions} /></div>;
    return (
      <div className="grid grid-cols-2 gap-4">
        <div className={cn(textCls, "border-r border-border pr-4 opacity-90")}><Segs segs={row.segments} side="old" showDeletions /></div>
        <div className={textCls}><Segs segs={row.segments} side="new" showDeletions /></div>
      </div>
    );
  })();
  if (layout === "side" && (row.kind === "added" || row.kind === "removed" || row.kind === "equal")) {
    return (
      <div className="diff-row group cursor-pointer px-3 py-2" data-row={index} data-kind={row.kind} data-current={current} onClick={onClick}>
        {head}
        <div className="grid grid-cols-2 gap-4">
          <div className={cn("border-r border-border pr-4", textCls)}>{row.kind === "added" ? <span className="text-muted">—</span> : row.kind === "removed" ? <del className="diff-del">{row.text}</del> : row.text}</div>
          <div className={textCls}>{row.kind === "removed" ? <span className="text-muted">—</span> : row.kind === "added" ? <ins className="diff-ins">{row.text}</ins> : row.text}</div>
        </div>
      </div>
    );
  }
  return (
    <div className="diff-row group cursor-pointer px-3 py-2" data-row={index} data-kind={row.kind} data-current={current} onClick={onClick}>
      {head}
      {body}
    </div>
  );
}

function PasteDialog({ value, onChange, onCancel, onSave }: { value: string; onChange: (v: string) => void; onCancel: () => void; onSave: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onCancel}>
      <div className="flex w-full max-w-2xl flex-col gap-3 rounded-xl border border-border bg-panel p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-semibold">Paste the original text</h3>
        <p className="text-xs text-muted">Paste the LaTeX source of the original (AI-generated) draft for this file. It becomes the baseline that your rewrite is compared against.</p>
        <textarea className="input h-72 font-mono text-xs" value={value} onChange={(e) => onChange(e.target.value)} placeholder="\\section{Introduction} ..." />
        <div className="flex justify-end gap-2">
          <button className="btn" onClick={onCancel}>Cancel</button>
          <button className="btn btn-primary" onClick={onSave} disabled={!value.trim()}>Set as baseline</button>
        </div>
      </div>
    </div>
  );
}

