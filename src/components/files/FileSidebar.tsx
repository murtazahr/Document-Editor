"use client";

import { useMemo, useRef, useState } from "react";
import { FilePlus, Upload, Star, Trash2, Pencil, FileText, Image as ImageIcon, GitCompare, ChevronDown, ChevronRight, Folder } from "lucide-react";
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

type Node = { name: string; path: string; file?: FileEntry; children: Node[] };

function buildTree(files: FileEntry[]): Node {
  const root: Node = { name: "", path: "", children: [] };
  for (const f of files) {
    const parts = f.path.split("/");
    let cur = root;
    for (let i = 0; i < parts.length; i++) {
      const name = parts[i];
      const p = parts.slice(0, i + 1).join("/");
      let next = cur.children.find((c) => c.name === name && (i < parts.length - 1 ? !c.file : !!c.file));
      if (!next) { next = { name, path: p, children: [], ...(i === parts.length - 1 ? { file: f } : {}) }; cur.children.push(next); }
      cur = next;
    }
  }
  const sort = (n: Node) => { n.children.sort((a, b) => (a.file ? 1 : 0) - (b.file ? 1 : 0) || a.name.localeCompare(b.name)); n.children.forEach(sort); };
  sort(root);
  return root;
}

export default function FileSidebar({ files, active, mainFile, projectId, onOpen, onCreate, onUpload, onRename, onDelete, onSetMain }: Props) {
  const upload = useRef<HTMLInputElement>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const tree = useMemo(() => buildTree(files), [files]);
  const toggle = (p: string) => setCollapsed((s) => { const n = new Set(s); if (n.has(p)) n.delete(p); else n.add(p); return n; });

  const renderNode = (n: Node, depth: number): React.ReactNode => {
    if (!n.file) {
      const open = !collapsed.has(n.path);
      return (
        <li key={"d:" + n.path}>
          <button className="flex w-full items-center gap-1 rounded-md px-2 py-1 text-[13px] text-muted hover:bg-panel-2" style={{ paddingLeft: 8 + depth * 12 }} onClick={() => toggle(n.path)}>
            {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            <Folder size={13} className="shrink-0" />
            <span className="truncate">{n.name}</span>
          </button>
          {open && <ul>{n.children.map((c) => renderNode(c, depth + 1))}</ul>}
        </li>
      );
    }
    const f = n.file;
    const isActive = f.path === active;
    const dir = f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/") + 1) : "";
    return (
      <li key={f.path} className={cn("group flex items-center gap-1.5 rounded-md py-1 pr-2 text-[13px]", isActive ? "bg-accent-soft" : "hover:bg-panel-2")} style={{ paddingLeft: 8 + depth * 12 + 14 }}>
        {f.binary ? <ImageIcon size={13} className="shrink-0 text-muted" /> : <FileText size={13} className="shrink-0 text-muted" />}
        {f.binary ? (
          <a className="flex-1 truncate" href={`/api/projects/${projectId}/files/${f.path}?raw=1`} target="_blank" rel="noreferrer" title={f.path}>{n.name}</a>
        ) : (
          <button className="flex-1 truncate text-left" onClick={() => onOpen(f.path)} title={f.path}>{n.name}</button>
        )}
        {f.path === mainFile && <Star size={12} className="shrink-0" style={{ color: "var(--verb)" }} aria-label="main file" />}
        {f.hasBaseline && <GitCompare size={12} className="shrink-0 text-muted" aria-label="has baseline" />}
        <span className="hidden shrink-0 gap-0.5 group-hover:flex">
          {!f.binary && f.path !== mainFile && f.path.endsWith(".tex") && <button className="btn btn-ghost btn-sm !p-1" title="Set as main file" onClick={() => onSetMain(f.path)}><Star size={12} /></button>}
          <button className="btn btn-ghost btn-sm !p-1" title="Rename or move" onClick={() => { const nn = prompt("Rename / move to (path relative to the project root)", f.path); if (nn && nn !== f.path) onRename(f.path, nn); }}><Pencil size={12} /></button>
          <button className="btn btn-ghost btn-sm btn-danger !p-1" title="Delete" onClick={() => { if (confirm(`Delete ${f.path}?`)) onDelete(f.path); }}><Trash2 size={12} /></button>
        </span>
        <span className="sr-only">{dir}</span>
      </li>
    );
  };

  return (
    <aside className="flex h-full w-full flex-col border-r border-border bg-panel">
      <div className="flex items-center justify-between px-3 py-2">
        <span className="panel-title">Files</span>
        <div className="flex gap-0.5">
          <button className="btn btn-ghost btn-sm" title="New file (use a / for folders, e.g. sections/intro.tex)" onClick={() => { const base = active && active.includes("/") ? active.slice(0, active.lastIndexOf("/") + 1) : ""; const nn = prompt("New file path (folders are created as needed)", base); if (nn) onCreate(nn); }}><FilePlus size={14} /></button>
          <button className="btn btn-ghost btn-sm" title={`Upload files into ${active && active.includes("/") ? active.slice(0, active.lastIndexOf("/")) : "the project root"}`} onClick={() => upload.current?.click()}><Upload size={14} /></button>
          <input ref={upload} type="file" multiple hidden onChange={(e) => { if (e.target.files?.length) onUpload(e.target.files); e.target.value = ""; }} />
        </div>
      </div>
      <ul className="scroll-thin flex-1 overflow-auto px-1.5 pb-3">{tree.children.map((c) => renderNode(c, 0))}</ul>
    </aside>
  );
}
