"use client";

import { useMemo, useState } from "react";
import { SpellCheck, TextSelect, FileText, Check, X, CheckCheck, Settings as SettingsIcon, Loader2 } from "lucide-react";
import type { SettingsInfo } from "@/lib/client-api";
import type { Suggestion } from "@/lib/grammar/resolve";
import type { GrammarLevel } from "@/lib/grammar/claude";
import { diffWords } from "@/lib/diff/engine";
import { cn } from "@/components/ui/cn";

export type GrammarState = {
  suggestions: Suggestion[];
  /** ids the user dismissed or that were applied */
  done: Record<string, "applied" | "dismissed" | "stale">;
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number } | null;
  model: string | null;
  mock: boolean;
  unresolved: number;
  scope: "selection" | "file" | null;
  checkedAt: string | null;
};

type Props = {
  settings: SettingsInfo | null;
  state: GrammarState;
  running: boolean;
  error: string | null;
  hasSelection: boolean;
  onCheck: (scope: "selection" | "file", level: GrammarLevel) => void;
  onAccept: (id: string) => void;
  onAcceptAll: () => void;
  onDismiss: (id: string) => void;
  onReveal: (id: string) => void;
  onOpenSettings: () => void;
};

const CAT_COLOR: Record<string, string> = { spelling: "var(--danger)", grammar: "var(--accent)", punctuation: "var(--muted)", "word-choice": "var(--verb)", clarity: "var(--verb)", consistency: "var(--muted)" };

export default function GrammarPane({ settings, state, running, error, hasSelection, onCheck, onAccept, onAcceptAll, onDismiss, onReveal, onOpenSettings }: Props) {
  const [level, setLevel] = useState<GrammarLevel>("grammar");
  const ready = !!settings && (settings.anthropic.hasKey || settings.anthropic.mock);
  const open = useMemo(() => state.suggestions.filter((s) => !state.done[s.id]), [state]);
  const applied = Object.values(state.done).filter((v) => v === "applied").length;

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-2 border-b border-border px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn btn-primary" disabled={!ready || running || !hasSelection} onClick={() => onCheck("selection", level)} title={hasSelection ? "Check the selected text" : "Select some text in the editor first"}><TextSelect size={13} /> Check selection</button>
          <button className="btn" disabled={!ready || running} onClick={() => onCheck("file", level)} title="Check the whole file"><FileText size={13} /> Check file</button>
          <div className="seg" title="Grammar only fixes errors; clarity also simplifies wordy phrasing">
            <button data-active={level === "grammar"} onClick={() => setLevel("grammar")}>Grammar</button>
            <button data-active={level === "clarity"} onClick={() => setLevel("clarity")}>+ Clarity</button>
          </div>
          <span className="flex-1" />
          <button className="btn btn-ghost btn-sm" onClick={onOpenSettings}><SettingsIcon size={13} /></button>
        </div>
        <p className="text-[11px] text-muted">
          Sends the LaTeX source to {settings?.anthropic.model ?? "Claude"} and returns minimal edits you accept one by one. Commands, math and citations are left alone.
          {settings?.anthropic.mock && <strong style={{ color: "var(--verb)" }}> MOCK MODE: suggestions are fake.</strong>}
          {settings && !ready && <> <button className="underline" onClick={onOpenSettings}>Add an Anthropic API key</button> to enable it.</>}
        </p>
        {running && <p className="flex items-center gap-1 text-xs text-muted"><Loader2 size={12} className="animate-spin" /> Checking…</p>}
        {error && <p className="text-xs" style={{ color: "var(--danger)" }}>{error}</p>}
        {state.checkedAt && !running && (
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted">
            <span>{state.suggestions.length} suggestion{state.suggestions.length === 1 ? "" : "s"} in {state.scope === "selection" ? "selection" : "file"} · {applied} applied · {open.length} open</span>
            {state.usage && <span className="chip">{(state.usage.inputTokens + state.usage.outputTokens).toLocaleString()} tokens{state.usage.cacheReadTokens ? ` (${state.usage.cacheReadTokens.toLocaleString()} cached)` : ""}</span>}
            {state.model && <span className="chip">{state.model}</span>}
            {state.unresolved > 0 && <span className="chip" title="The model returned edits whose original text could not be found verbatim">{state.unresolved} unplaced</span>}
            {open.length > 1 && <button className="btn btn-sm ml-auto" onClick={onAcceptAll}><CheckCheck size={12} /> Accept all {open.length}</button>}
          </div>
        )}
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-auto">
        {!state.checkedAt && !running && <div className="flex h-full items-center justify-center p-8 text-center text-sm text-muted">Select a passage and press “Check selection”, or check the whole file.</div>}
        {state.checkedAt && open.length === 0 && !running && <div className="p-8 text-center text-sm text-muted">{state.suggestions.length === 0 ? "No issues found." : "All suggestions handled."}</div>}
        <ul className="divide-y divide-border">
          {open.map((s) => (
            <li key={s.id} className="group px-3 py-2 hover:bg-panel-2">
              <button className="w-full text-left" onClick={() => onReveal(s.id)} title="Show in editor">
                <div className="mb-1 flex items-center gap-2 text-[11px]">
                  <span className="chip" style={{ color: CAT_COLOR[s.category] ?? "var(--muted)" }}>{s.category}</span>
                  <span className="truncate text-muted">{s.reason}</span>
                </div>
                <div className="diff-source text-[12.5px]"><Redline a={s.original} b={s.replacement} /></div>
              </button>
              <div className="mt-1.5 flex gap-1">
                <button className="btn btn-sm" onClick={() => onAccept(s.id)}><Check size={12} /> Accept</button>
                <button className="btn btn-ghost btn-sm" onClick={() => onDismiss(s.id)}><X size={12} /> Dismiss</button>
              </div>
            </li>
          ))}
        </ul>
        {Object.values(state.done).some((v) => v === "stale") && <p className="px-3 py-2 text-[11px] text-muted">Some suggestions were skipped because the text had changed since the check.</p>}
      </div>
    </div>
  );
}

function Redline({ a, b }: { a: string; b: string }) {
  const segs = diffWords(a, b, 1000);
  return (
    <>
      {segs.map((s, i) => s.type === "equal" ? <span key={i}>{s.text}</span> : s.type === "delete" ? <del key={i} className="diff-del">{s.text}</del> : <ins key={i} className={cn("diff-ins")}>{s.text}</ins>)}
    </>
  );
}

export { SpellCheck as GrammarIcon };
