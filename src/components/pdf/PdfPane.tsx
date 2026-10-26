"use client";

import { useState } from "react";
import { AlertTriangle, ExternalLink, Play, ChevronDown, ChevronRight } from "lucide-react";
import type { CompileResult } from "@/lib/client-api";
import { cn } from "@/components/ui/cn";

type Props = {
  pdfUrl: string | null;
  compiling: boolean;
  result: CompileResult | null;
  onCompile: () => void;
  onJumpLine: (line: number) => void;
};

export default function PdfPane({ pdfUrl, compiling, result, onCompile, onJumpLine }: Props) {
  const [showLog, setShowLog] = useState(false);
  const [showWarnings, setShowWarnings] = useState(false);
  const diags = result ? [...result.errors, ...(showWarnings ? result.warnings : [])] : [];
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <button className="btn btn-primary" onClick={onCompile} disabled={compiling}><Play size={13} /> {compiling ? "Compiling…" : "Compile"}</button>
        <span className="text-xs text-muted">
          {result ? (result.ok ? `OK · ${result.engine} · ${(result.durationMs / 1000).toFixed(1)}s` : result.message ?? `${result.errors.length} error(s)`) : <>Press <span className="kbd">⌘S</span> to save &amp; compile</>}
        </span>
        <span className="flex-1" />
        {pdfUrl && <a className="btn btn-ghost btn-sm" href={pdfUrl} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Open</a>}
      </div>
      {result && (result.errors.length > 0 || result.warnings.length > 0 || !result.ok) && (
        <div className="max-h-48 overflow-auto border-b border-border bg-panel-2 text-xs">
          {!result.ok && result.engine && result.errors.length === 0 && <div className="flex items-center gap-2 px-3 py-2" style={{ color: "var(--danger)" }}><AlertTriangle size={13} /> {result.message ?? "Compilation failed"}</div>}
          {diags.map((d, i) => (
            <button key={i} className={cn("flex w-full items-start gap-2 px-3 py-1.5 text-left hover:bg-panel", d.severity === "error" ? "" : "text-muted")} onClick={() => d.line && onJumpLine(d.line)}>
              <span className="w-14 shrink-0 font-mono" style={{ color: d.severity === "error" ? "var(--danger)" : "var(--verb)" }}>{d.severity === "error" ? "error" : "warn"}{d.line ? `:${d.line}` : ""}</span>
              <span className="break-words">{d.message}</span>
            </button>
          ))}
          <div className="flex gap-3 px-3 py-1.5 text-muted">
            {result.warnings.length > 0 && <button className="underline" onClick={() => setShowWarnings((s) => !s)}>{showWarnings ? "Hide" : "Show"} {result.warnings.length} warning(s)</button>}
            <button className="flex items-center gap-1 underline" onClick={() => setShowLog((s) => !s)}>{showLog ? <ChevronDown size={11} /> : <ChevronRight size={11} />} Full log</button>
          </div>
          {showLog && <pre className="max-h-64 overflow-auto whitespace-pre-wrap border-t border-border px-3 py-2 font-mono text-[11px]">{result.log || "(empty)"}</pre>}
        </div>
      )}
      <div className="min-h-0 flex-1 bg-panel-2">
        {pdfUrl ? (
          <iframe key={pdfUrl} src={pdfUrl} title="PDF preview" className="h-full w-full border-0" />
        ) : (
          <div className="flex h-full items-center justify-center p-8 text-center text-sm text-muted">
            {result && !result.engine ? result.message : "No PDF yet. Compile to see the output here."}
          </div>
        )}
      </div>
    </div>
  );
}
