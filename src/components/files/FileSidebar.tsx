"use client";

import { useRef } from "react";
import { FilePlus, Upload, Star, Trash2, Pencil, FileText, Image as ImageIcon, GitCompare } from "lucide-react";
import type { FileEntry } from "@/lib/client-api";
import { cn } from "@/components/ui/cn";

type Props = {
  files: FileEntry[];
  active: string | null;
  mainFile: string;
  projectId: string;
  onOpen: (path: string) => void;
  onCreate: (path: string) => void;
  onUpload: (files: FileList) => void;
  onRename: (from: string, to: string) => void;
  onDelete: (path: string) => void;
  onSetMain: (path: string) => void;
};

export default function FileSidebar({ files, active, mainFile, projectId, onOpen, onCreate, onUpload, onRename, onDelete, onSetMain }: Props) {
  const upload = useRef<HTMLInputElement>(null);
  return (
    <aside className="flex h-full w-full flex-col border-r border-border bg-panel">
      <div className="flex items-center justify-between px-3 py-2">
        <span className="panel-title">Files</span>
        <div className="flex gap-0.5">
          <button className="btn btn-ghost btn-sm" title="New file" onClick={() => { const n = prompt("New file name (e.g. sections/intro.tex)"); if (n) onCreate(n); }}><FilePlus size={14} /></button>
          <button className="btn btn-ghost btn-sm" title="Upload files (.tex, .bib, images)" onClick={() => upload.current?.click()}><Upload size={14} /></button>
          <input ref={upload} type="file" multiple hidden onChange={(e) => { if (e.target.files?.length) onUpload(e.target.files); e.target.value = ""; }} />
        </div>
      </div>
      <ul className="scroll-thin flex-1 overflow-auto px-1.5 pb-3">
        {files.map((f) => {
          const isActive = f.path === active;
          return (
            <li key={f.path} className={cn("group flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px]", isActive ? "bg-accent-soft" : "hover:bg-panel-2")}>
              {f.binary ? <ImageIcon size={13} className="shrink-0 text-muted" /> : <FileText size={13} className="shrink-0 text-muted" />}
              {f.binary ? (
                <a className="flex-1 truncate" href={`/api/projects/${projectId}/files/${f.path}?raw=1`} target="_blank" rel="noreferrer" title={f.path}>{f.path}</a>
              ) : (
                <button className="flex-1 truncate text-left" onClick={() => onOpen(f.path)} title={f.path}>{f.path}</button>
              )}
              {f.path === mainFile && <Star size={12} className="shrink-0" style={{ color: "var(--verb)" }} aria-label="main file" />}
              {f.hasBaseline && <GitCompare size={12} className="shrink-0 text-muted" aria-label="has baseline" />}
              <span className="hidden shrink-0 gap-0.5 group-hover:flex">
                {!f.binary && f.path !== mainFile && f.path.endsWith(".tex") && <button className="btn btn-ghost btn-sm !p-1" title="Set as main file" onClick={() => onSetMain(f.path)}><Star size={12} /></button>}
                <button className="btn btn-ghost btn-sm !p-1" title="Rename" onClick={() => { const n = prompt("Rename to", f.path); if (n && n !== f.path) onRename(f.path, n); }}><Pencil size={12} /></button>
                <button className="btn btn-ghost btn-sm btn-danger !p-1" title="Delete" onClick={() => { if (confirm(`Delete ${f.path}?`)) onDelete(f.path); }}><Trash2 size={12} /></button>
              </span>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
