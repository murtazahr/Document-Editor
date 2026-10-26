"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { X, Lock, Globe } from "lucide-react";
import { api, type ProjectMeta } from "@/lib/client-api";

type Repo = { fullName: string; name: string; private: boolean; htmlUrl: string; cloneUrl: string; defaultBranch: string; pushedAt: string; description: string | null };

export default function ImportDialog({ onClose }: { onClose: () => void }) {
  const [repos, setRepos] = useState<Repo[] | null>(null);
  const [q, setQ] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => { api<{ repos: Repo[] }>("/api/github/repos").then((r) => setRepos(r.repos)).catch((e: Error) => { setRepos([]); setError(e.message); }); }, []);

  const importRepo = async (cloneUrl: string, name?: string) => {
    setBusy(cloneUrl); setError(null);
    try { const p = await api<ProjectMeta>("/api/projects/import", { method: "POST", body: JSON.stringify({ cloneUrl, name }) }); router.push(`/p/${p.id}`); }
    catch (e) { setError((e as Error).message); setBusy(null); }
  };

  const list = (repos ?? []).filter((r) => !q || r.fullName.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-xl border border-border bg-panel p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">Import from GitHub</h2>
          <button className="btn btn-ghost" onClick={onClose}><X size={16} /></button>
        </div>
        <input className="input mb-2" placeholder="Filter your repositories…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        <div className="scroll-thin min-h-0 flex-1 overflow-auto rounded-md border border-border">
          {repos === null ? <p className="p-3 text-sm text-muted">Loading repositories…</p> : list.length === 0 ? <p className="p-3 text-sm text-muted">No repositories.</p> : (
            <ul className="divide-y divide-border">
              {list.map((r) => (
                <li key={r.fullName}>
                  <button className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-panel-2 disabled:opacity-50" disabled={!!busy} onClick={() => importRepo(r.cloneUrl, r.name)}>
                    {r.private ? <Lock size={12} className="text-muted" /> : <Globe size={12} className="text-muted" />}
                    <span className="flex-1 truncate">{r.fullName}<span className="ml-2 text-xs text-muted">{r.description}</span></span>
                    <span className="text-[11px] text-muted">{new Date(r.pushedAt).toLocaleDateString()}</span>
                    {busy === r.cloneUrl && <span className="text-xs text-muted">cloning…</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="mt-3 flex gap-2">
          <input className="input" placeholder="…or any https clone URL" value={url} onChange={(e) => setUrl(e.target.value)} />
          <button className="btn" disabled={!url || !!busy} onClick={() => importRepo(url)}>Clone</button>
        </div>
        {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      </div>
    </div>
  );
}
