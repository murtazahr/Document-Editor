"use client";

import { useMemo, useState } from "react";
import { ExternalLink, Play, Settings as SettingsIcon, Highlighter } from "lucide-react";
import type { StoredDetection, SettingsInfo } from "@/lib/client-api";
import type { PangramWindow } from "@/lib/pangram/types";
import { cn } from "@/components/ui/cn";

export type MappedWindow = { w: PangramWindow; from: number | null; to: number | null };

type Props = {
  settings: SettingsInfo | null;
  models: string[];
  prose: string;
  wordCount: number;
  detection: StoredDetection | null;
  mapped: MappedWindow[];
  running: boolean;
  error: string | null;
  highlight: boolean;
  onToggleHighlight: (v: boolean) => void;
  onRun: (opts: { model: string; publicDashboardLink: boolean }) => void;
  onJump: (from: number, to: number) => void;
  onOpenSettings: () => void;
};

export function labelColor(label: string) {
  if (label === "AI-Generated") return "var(--danger)";
  if (label === "AI-Assisted") return "var(--verb)";
  return "var(--ins-fg)";
}

export default function DetectionPane({ settings, models, prose, wordCount, detection, mapped, running, error, highlight, onToggleHighlight, onRun, onJump, onOpenSettings }: Props) {
  const [model, setModel] = useState("default");
  const [dash, setDash] = useState(false);
  const [filter, setFilter] = useState<"all" | "AI-Generated" | "AI-Assisted" | "Human Written">("all");
  const settingsModel = settings?.pangram.model ?? null;
  const [prevSettingsModel, setPrevSettingsModel] = useState(settingsModel);
  if (prevSettingsModel !== settingsModel) { setPrevSettingsModel(settingsModel); if (settingsModel) setModel(settingsModel); }

  const ready = !!settings && (settings.pangram.hasKey || settings.pangram.mock);
  const stale = detection ? detection.sentText !== prose : false;
  const r = detection?.result;
  const list = useMemo(() => mapped.filter((m) => filter === "all" || m.w.label === filter), [mapped, filter]);
  const modelOptions = Array.from(new Set(["default", ...models, model]));

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-2 border-b border-border px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn btn-primary" onClick={() => onRun({ model, publicDashboardLink: dash })} disabled={!ready || running || wordCount < 5}><Play size={13} /> {running ? "Analysing…" : detection ? "Re-run detection" : "Run detection"}</button>
          <select className="input !w-auto !py-1 text-xs" value={model} onChange={(e) => setModel(e.target.value)} title="Pangram model selector">
            {modelOptions.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <label className="flex items-center gap-1 text-xs text-muted" title="Ask Pangram for a shareable dashboard link"><input type="checkbox" checked={dash} onChange={(e) => setDash(e.target.checked)} /> dashboard link</label>
          <span className="flex-1" />
          <button className="btn btn-ghost btn-sm" onClick={onOpenSettings}><SettingsIcon size={13} /></button>
        </div>
        <p className="text-[11px] text-muted">
          Sends the prose of this file ({wordCount.toLocaleString()} words; LaTeX markup, math, figures and references stripped) to Pangram. Each run uses credits per Pangram&apos;s pricing.
          {settings?.pangram.mock && <strong style={{ color: "var(--verb)" }}> MOCK MODE: results below are fake.</strong>}
          {settings && !ready && <> <button className="underline" onClick={onOpenSettings}>Add an API key</button> to enable detection.</>}
        </p>
        {error && <p className="text-xs" style={{ color: "var(--danger)" }}>{error}</p>}
      </div>

      {!r ? (
        <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-muted">No detection result yet for this file.</div>
      ) : (
        <div className="scroll-thin min-h-0 flex-1 overflow-auto">
          <div className="border-b border-border px-3 py-3">
            <div className="flex items-baseline justify-between gap-2">
              <div>
                <div className="text-base font-semibold">{r.headline ?? r.prediction_short ?? "Result"}</div>
                <div className="text-xs text-muted">{r.prediction}</div>
              </div>
              <span className="chip" style={{ color: labelColor(r.prediction_short === "AI" ? "AI-Generated" : r.prediction_short === "Mixed" ? "AI-Assisted" : "Human Written") }}>{r.prediction_short}</span>
            </div>
            <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-panel-2" title="Share of text by label">
              <div style={{ width: `${(r.fraction_ai ?? 0) * 100}%`, background: "var(--danger)" }} />
              <div style={{ width: `${(r.fraction_ai_assisted ?? 0) * 100}%`, background: "var(--verb)" }} />
              <div style={{ width: `${(r.fraction_human ?? 0) * 100}%`, background: "var(--ins-fg)" }} />
            </div>
            <div className="mt-1.5 flex flex-wrap gap-3 text-[11px] text-muted">
              <span><b style={{ color: "var(--danger)" }}>{Math.round((r.fraction_ai ?? 0) * 100)}%</b> AI-generated ({r.num_ai_segments ?? 0})</span>
              <span><b style={{ color: "var(--verb)" }}>{Math.round((r.fraction_ai_assisted ?? 0) * 100)}%</b> AI-assisted ({r.num_ai_assisted_segments ?? 0})</span>
              <span><b style={{ color: "var(--ins-fg)" }}>{Math.round((r.fraction_human ?? 0) * 100)}%</b> human ({r.num_human_segments ?? 0})</span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted">
              <span>{new Date(detection!.createdAt).toLocaleString()} · model {detection!.model}{r.version ? ` · v${r.version}` : ""} · {detection!.wordCount} words</span>
              {detection!.mock && <span className="chip" style={{ color: "var(--verb)" }}>mock</span>}
              {stale && <span className="chip" style={{ color: "var(--verb)" }} title="The text has changed since this result; re-run for current scores">stale</span>}
              {r.dashboard_link && <a className="chip underline" href={r.dashboard_link} target="_blank" rel="noreferrer"><ExternalLink size={10} /> dashboard</a>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-1.5 text-xs">
            <div className="seg">
              {(["all", "AI-Generated", "AI-Assisted", "Human Written"] as const).map((f) => <button key={f} data-active={filter === f} onClick={() => setFilter(f)}>{f === "all" ? `All (${mapped.length})` : f.replace(" Written", "")}</button>)}
            </div>
            <span className="flex-1" />
            <label className={cn("flex items-center gap-1", stale && "opacity-60")} title={stale ? "Highlights may be misplaced because the text changed" : "Tint each window in the editor"}><Highlighter size={12} /> <input type="checkbox" checked={highlight} onChange={(e) => onToggleHighlight(e.target.checked)} /> highlight in editor</label>
          </div>
          <ul className="divide-y divide-border">
            {list.map((m, i) => (
              <li key={i}>
                <button className="w-full px-3 py-2 text-left hover:bg-panel-2 disabled:cursor-default" disabled={m.from === null} onClick={() => m.from !== null && onJump(m.from, m.to!)} title={m.from === null ? "Could not locate this window in the current text" : "Jump to this passage"}>
                  <div className="flex items-center gap-2 text-[11px]">
                    <span className="chip" style={{ color: labelColor(m.w.label) }}>{m.w.label}</span>
                    <span className="text-muted">{m.w.confidence} confidence</span>
                    <span className="ml-auto flex items-center gap-1.5 text-muted" title="AI assistance score (0 human → 1 AI)">
                      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-panel-2"><span className="block h-full" style={{ width: `${m.w.ai_assistance_score * 100}%`, background: labelColor(m.w.label) }} /></span>
                      <span className="tabular-nums">{m.w.ai_assistance_score.toFixed(2)}</span>
                    </span>
                    {m.w.is_humanized && <span className="chip" style={{ color: "var(--danger)" }} title={`Humanizer score ${m.w.humanizer_score?.toFixed(2) ?? ""}`}>humanized</span>}
                  </div>
                  <p className="mt-1 line-clamp-3 text-[12.5px] leading-snug text-text/90">{m.w.text}</p>
                  <div className="mt-0.5 text-[10px] text-muted">{m.w.word_count} words{m.from === null ? " · not located in current text" : ""}</div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
