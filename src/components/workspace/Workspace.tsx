"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, PanelLeft, Settings as SettingsIcon, Save, FileSearch, GitCompare, ScanSearch, GitBranch } from "lucide-react";
import LatexEditor, { type LatexEditorHandle, type HighlightRange } from "@/components/editor/LatexEditor";
import FileSidebar from "@/components/files/FileSidebar";
import PdfPane from "@/components/pdf/PdfPane";
import DiffView from "@/components/diff/DiffView";
import DetectionPane, { type MappedWindow } from "@/components/pangram/DetectionPane";
import SettingsDialog from "./SettingsDialog";
import GitPane, { type GitInfo } from "./GitPane";
import { api, encPath, type ProjectDetail, type FileContent, type CompileResult, type StoredDetection, type SettingsInfo } from "@/lib/client-api";
import { latexToProse, proseRangeToSource, findLoose, countWords } from "@/lib/latex-prose";
import { cn } from "@/components/ui/cn";

type Tab = "pdf" | "diff" | "detect" | "git";
type SaveState = "saved" | "unsaved" | "saving" | "error";

export default function Workspace({ id }: { id: string }) {
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [baseline, setBaseline] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [tab, setTab] = useState<Tab>("diff");
  const [sidebar, setSidebar] = useState(true);
  const [split, setSplit] = useState(50);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<SettingsInfo | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [compiling, setCompiling] = useState(false);
  const [compileResult, setCompileResult] = useState<CompileResult | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [detection, setDetection] = useState<StoredDetection | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [detectError, setDetectError] = useState<string | null>(null);
  const [highlightDet, setHighlightDet] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [saveTick, setSaveTick] = useState(0);
  const [gitInfo, setGitInfo] = useState<GitInfo | null>(null);

  const editor = useRef<LatexEditorHandle>(null);
  const savedContent = useRef("");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeRef = useRef<string | null>(null);
  const contentRef = useRef("");
  useEffect(() => { activeRef.current = active; contentRef.current = content; }, [active, content]);

  const notify = (m: string) => { setToast(m); setTimeout(() => setToast(null), 3000); };

  // ---------- loading ----------
  const loadProject = useCallback(async () => {
    const p = await api<ProjectDetail>(`/api/projects/${id}`);
    setProject(p);
    return p;
  }, [id]);

  const loadSettings = useCallback(async () => {
    try {
      const s = await api<SettingsInfo>("/api/settings");
      setSettings(s);
      if (s.pangram.hasKey || s.pangram.mock) {
        try { setModels((await api<{ models: string[] }>("/api/pangram/models")).models); } catch { setModels([]); }
      } else setModels([]);
    } catch { /* ignore */ }
  }, []);

  const openFile = useCallback(async (path: string) => {
    const f = await api<FileContent>(`/api/projects/${id}/files/${encPath(path)}`);
    savedContent.current = f.content;
    setActive(path);
    setContent(f.content);
    setBaseline(f.baseline);
    setSaveState("saved");
    setDetectError(null);
    try { setDetection((await api<{ detection: StoredDetection | null }>(`/api/projects/${id}/detect?file=${encodeURIComponent(path)}`)).detection); } catch { setDetection(null); }
  }, [id]);

  useEffect(() => {
    (async () => {
      try {
        const p = await loadProject();
        await loadSettings();
        const first = p.files.find((f) => f.path === p.mainFile) ?? p.files.find((f) => f.path.endsWith(".tex")) ?? p.files.find((f) => !f.binary);
        if (first) await openFile(first.path);
        // show an existing PDF if there is one
        const head = await fetch(`/api/projects/${id}/pdf`, { method: "HEAD" }).catch(() => null);
        if (head?.ok) setPdfUrl(`/api/projects/${id}/pdf?t=${Date.now()}`);
      } catch (e) { setLoadError((e as Error).message); }
    })();
  }, [id, loadProject, loadSettings, openFile]);

  // ---------- saving ----------
  const saveNow = useCallback(async (): Promise<boolean> => {
    const path = activeRef.current;
    const text = contentRef.current;
    if (!path || text === savedContent.current) return true;
    setSaveState("saving");
    try {
      await api(`/api/projects/${id}/files/${encPath(path)}`, { method: "PUT", body: JSON.stringify({ content: text }) });
      savedContent.current = text;
      setSaveState(contentRef.current === text ? "saved" : "unsaved");
      setSaveTick((t) => t + 1);
      return true;
    } catch (e) {
      setSaveState("error");
      notify(`Save failed: ${(e as Error).message}`);
      return false;
    }
  }, [id]);

  const onChange = (v: string) => {
    setContent(v);
    setSaveState(v === savedContent.current ? "saved" : "unsaved");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(saveNow, 800);
  };

  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (contentRef.current !== savedContent.current) { e.preventDefault(); } };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, []);

  const switchFile = async (path: string) => {
    if (path === active) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (!(await saveNow())) return;
    await openFile(path);
  };

  // ---------- compile ----------
  const compile = useCallback(async () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (!(await saveNow())) return;
    setCompiling(true);
    setTab("pdf");
    try {
      const r = await api<CompileResult>(`/api/projects/${id}/compile`, { method: "POST" });
      setCompileResult(r);
      if (r.pdf) setPdfUrl(`/api/projects/${id}/pdf?t=${Date.now()}`);
    } catch (e) {
      setCompileResult({ ok: false, engine: null, durationMs: 0, log: "", errors: [], warnings: [], pdf: false, message: (e as Error).message });
    } finally { setCompiling(false); }
  }, [id, saveNow]);

  // ---------- files ----------
  const refreshFiles = async () => { await loadProject(); };
  const createFile = async (path: string) => {
    try { await api(`/api/projects/${id}/files`, { method: "POST", body: JSON.stringify({ path, content: "" }) }); await refreshFiles(); await switchFile(path); } catch (e) { notify((e as Error).message); }
  };
  const uploadFiles = async (list: FileList) => {
    const fd = new FormData();
    for (const f of Array.from(list)) fd.append("files", f);
    try { await api(`/api/projects/${id}/files`, { method: "POST", body: fd }); await refreshFiles(); notify(`Uploaded ${list.length} file(s)`); } catch (e) { notify((e as Error).message); }
  };
  const renameFile = async (from: string, to: string) => {
    try { await api(`/api/projects/${id}/files/${encPath(from)}`, { method: "PATCH", body: JSON.stringify({ to }) }); await refreshFiles(); if (active === from) await openFile(to); } catch (e) { notify((e as Error).message); }
  };
  const deleteFile = async (path: string) => {
    try {
      await api(`/api/projects/${id}/files/${encPath(path)}`, { method: "DELETE" });
      const p = await loadProject();
      if (active === path) { const next = p.files.find((f) => !f.binary); if (next) await openFile(next.path); else { setActive(null); setContent(""); setBaseline(null); } }
    } catch (e) { notify((e as Error).message); }
  };
  const setMain = async (path: string) => { try { await api(`/api/projects/${id}`, { method: "PATCH", body: JSON.stringify({ mainFile: path }) }); await refreshFiles(); } catch (e) { notify((e as Error).message); } };

  // ---------- baseline ----------
  const snapshotBaseline = async () => {
    if (!active) return;
    await saveNow();
    const r = await api<{ baseline: string }>(`/api/projects/${id}/baseline`, { method: "PUT", body: JSON.stringify({ file: active, content }) });
    setBaseline(r.baseline);
    await refreshFiles();
    notify("Baseline set to current text");
  };
  const setBaselineText = async (text: string, label?: string) => {
    if (!active) return;
    const r = await api<{ baseline: string }>(`/api/projects/${id}/baseline`, { method: "PUT", body: JSON.stringify({ file: active, content: text }) });
    setBaseline(r.baseline);
    await refreshFiles();
    if (label) { notify(`Baseline set to ${active} @ ${label}`); setTab("diff"); }
  };
  const clearBaseline = async () => {
    if (!active) return;
    await api(`/api/projects/${id}/baseline?file=${encodeURIComponent(active)}`, { method: "DELETE" });
    setBaseline(null);
    await refreshFiles();
  };

  // ---------- detection ----------
  const prose = useMemo(() => latexToProse(content), [content]);
  const proseWords = useMemo(() => countWords(prose.text), [prose.text]);

  const runDetection = async (opts: { model: string; publicDashboardLink: boolean }) => {
    if (!active) return;
    setDetecting(true);
    setDetectError(null);
    try {
      const r = await api<{ detection: StoredDetection }>(`/api/projects/${id}/detect`, { method: "POST", body: JSON.stringify({ file: active, text: prose.text, ...opts }) });
      setDetection(r.detection);
      setHighlightDet(true);
    } catch (e) { setDetectError((e as Error).message); } finally { setDetecting(false); }
  };

  /** Locate each detector window in the current prose, then map to source offsets. */
  const mappedWindows: MappedWindow[] = useMemo(() => {
    const wins = detection?.result.windows ?? [];
    if (!wins.length) return [];
    const exact = detection!.result.text === prose.text && detection!.sentText === prose.text;
    let cursor = 0;
    return wins.map((w) => {
      let range: { start: number; end: number } | null = null;
      if (exact && Number.isFinite(w.start_index) && Number.isFinite(w.end_index) && w.end_index > w.start_index) range = { start: w.start_index, end: w.end_index };
      else {
        range = findLoose(prose.text, w.text, cursor) ?? findLoose(prose.text, w.text, 0);
      }
      if (!range) return { w, from: null, to: null };
      cursor = range.end;
      const src = proseRangeToSource(prose.map, range.start, range.end);
      return { w, from: src?.from ?? null, to: src?.to ?? null };
    });
  }, [detection, prose]);

  const highlights: HighlightRange[] = useMemo(() => {
    if (!highlightDet || !detection) return [];
    const out: HighlightRange[] = [];
    for (const m of mappedWindows) {
      if (m.from === null || m.to === null) continue;
      const cls = m.w.label === "AI-Generated" ? "cm-det-ai" : m.w.label === "AI-Assisted" ? "cm-det-assisted" : "cm-det-human";
      out.push({ from: m.from, to: m.to, cls: cls + (m.w.is_humanized ? " cm-det-humanized" : "") });
    }
    return out;
  }, [highlightDet, detection, mappedWindows]);

  // ---------- layout: drag to resize ----------
  const dragging = useRef(false);
  const mainRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (!dragging.current || !mainRef.current) return;
      const r = mainRef.current.getBoundingClientRect();
      setSplit(Math.min(80, Math.max(20, ((e.clientX - r.left) / r.width) * 100)));
    };
    const up = () => { dragging.current = false; document.body.style.cursor = ""; };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
  }, []);

  const jumpToLine = (line: number) => {
    const lines = content.split("\n");
    let off = 0;
    for (let i = 0; i < Math.min(line - 1, lines.length); i++) off += lines[i].length + 1;
    editor.current?.reveal(off, off + (lines[line - 1]?.length ?? 0));
  };
  const reveal = (from: number, to?: number) => editor.current?.reveal(from, to);

  if (loadError) return <div className="p-8 text-danger">{loadError} · <Link className="underline" href="/">back</Link></div>;
  if (!project) return <div className="p-8 text-muted">Loading project…</div>;

  return (
    <div className="flex h-full flex-col">
      {/* top bar */}
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border bg-panel px-2">
        <Link href="/" className="btn btn-ghost btn-sm" title="All projects"><ArrowLeft size={14} /></Link>
        <button className="btn btn-ghost btn-sm" onClick={() => setSidebar((s) => !s)} title="Toggle file list"><PanelLeft size={14} /></button>
        <span className="truncate font-medium">{project.name}</span>
        <span className="text-muted">/</span>
        <span className="truncate font-mono text-xs text-muted">{active ?? "—"}</span>
        <span className={cn("text-[11px]", saveState === "error" ? "text-danger" : "text-muted")}>
          {saveState === "saved" ? "Saved" : saveState === "saving" ? "Saving…" : saveState === "unsaved" ? "Unsaved" : "Save failed"}
        </span>
        <span className="flex-1" />
        {gitInfo?.github && (
          <button className="chip hover:underline" onClick={() => setTab("git")} title={gitInfo.lastSyncError ? `Last sync failed: ${gitInfo.lastSyncError}` : gitInfo.autoSync ? "Auto-sync on" : "Auto-sync off"}>
            <GitBranch size={11} />
            {gitInfo.lastSyncError ? <span style={{ color: "var(--danger)" }}>sync failed</span> : gitInfo.status.changes.length ? `${gitInfo.status.changes.length} unsynced` : "synced"}
          </button>
        )}
        <button className="btn btn-sm" onClick={saveNow} disabled={saveState === "saved" || saveState === "saving"}><Save size={13} /> Save</button>
        <button className="btn btn-primary btn-sm" onClick={compile} disabled={compiling}>{compiling ? "Compiling…" : "Compile"}</button>
        <button className="btn btn-ghost btn-sm" onClick={() => setSettingsOpen(true)} title="Settings"><SettingsIcon size={14} /></button>
      </header>

      <div className="flex min-h-0 flex-1">
        {sidebar && (
          <div className="w-56 shrink-0">
            <FileSidebar files={project.files} active={active} mainFile={project.mainFile} projectId={id} onOpen={switchFile} onCreate={createFile} onUpload={uploadFiles} onRename={renameFile} onDelete={deleteFile} onSetMain={setMain} />
          </div>
        )}
        <div ref={mainRef} className="flex min-w-0 flex-1">
          <div className="min-w-0" style={{ width: `${split}%` }}>
            {active ? <LatexEditor ref={editor} value={content} onChange={onChange} highlights={highlights} onSave={compile} /> : <div className="p-8 text-muted">No text file selected.</div>}
          </div>
          <div className="w-1 shrink-0 cursor-col-resize bg-border hover:bg-accent" onMouseDown={() => { dragging.current = true; document.body.style.cursor = "col-resize"; }} />
          <div className="flex min-w-0 flex-1 flex-col bg-panel">
            <div className="flex shrink-0 items-center border-b border-border px-2">
              {([["diff", "Diff", GitCompare], ["pdf", "PDF", FileSearch], ["detect", "AI detection", ScanSearch], ["git", "Git", GitBranch]] as const).map(([k, label, Icon]) => (
                <button key={k} className={cn("flex items-center gap-1.5 border-b-2 px-3 py-2 text-[13px]", tab === k ? "border-accent text-text" : "border-transparent text-muted hover:text-text")} onClick={() => setTab(k)}>
                  <Icon size={14} /> {label}
                  {k === "detect" && detection && <span className="ml-1 h-1.5 w-1.5 rounded-full" style={{ background: detection.result.prediction_short === "AI" ? "var(--danger)" : detection.result.prediction_short === "Mixed" ? "var(--verb)" : "var(--ins-fg)" }} />}
                </button>
              ))}
            </div>
            <div className="min-h-0 flex-1">
              {tab === "pdf" && <PdfPane pdfUrl={pdfUrl} compiling={compiling} result={compileResult} onCompile={compile} onJumpLine={jumpToLine} />}
              {tab === "diff" && <DiffView baseline={baseline} current={content} onJump={reveal} onSnapshotBaseline={snapshotBaseline} onSetBaseline={setBaselineText} onClearBaseline={clearBaseline} />}
              {tab === "git" && <GitPane projectId={id} projectName={project.name} activeFile={active} changeTick={saveTick} onOpenSettings={() => setSettingsOpen(true)} onUseAsBaseline={(text, label) => setBaselineText(text, label)} onInfo={setGitInfo} />}
              {tab === "detect" && (
                <DetectionPane settings={settings} models={models} prose={prose.text} wordCount={proseWords} detection={detection} mapped={mappedWindows} running={detecting} error={detectError} highlight={highlightDet} onToggleHighlight={setHighlightDet} onRun={runDetection} onJump={reveal} onOpenSettings={() => setSettingsOpen(true)} />
              )}
            </div>
          </div>
        </div>
      </div>
      {toast && <div className="fixed bottom-4 left-1/2 -translate-x-1/2 rounded-md border border-border bg-panel px-3 py-2 text-sm shadow-lg">{toast}</div>}
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} onSaved={loadSettings} />}
    </div>
  );
}
