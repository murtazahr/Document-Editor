"use client";

import { useCallback, useEffect, useState } from "react";
import { GitBranch, RefreshCw, GitCommitHorizontal, ExternalLink, History, Link2, Unlink, Camera } from "lucide-react";
import { api } from "@/lib/client-api";
import type { GitStatus, GitCommit } from "@/lib/git";
import type { GitHubLink } from "@/lib/storage";
import { cn } from "@/components/ui/cn";

export type GitInfo = {
  connected: boolean;
  login: string | null;
  github: GitHubLink | null;
  autoSync: boolean;
  autoSyncPending: boolean;
  lastSyncAt: string | null;
  lastSyncError: string | null;
  status: GitStatus;
  history: GitCommit[];
};

type Props = {
  projectId: string;
  projectName: string;
  activeFile: string | null;
  /** bumps whenever the editor saved, to refresh status */
  changeTick: number;
  onOpenSettings: () => void;
  onUseAsBaseline: (text: string, label: string) => void;
  onInfo?: (info: GitInfo) => void;
};

function ago(iso: string | null) {
  if (!iso) return "never";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}

export default function GitPane({ projectId, projectName, activeFile, changeTick, onOpenSettings, onUseAsBaseline, onInfo }: Props) {
  const [info, setInfo] = useState<GitInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [repoName, setRepoName] = useState("");
  const [priv, setPriv] = useState(true);
  const [remoteUrl, setRemoteUrl] = useState("");
  const [showLink, setShowLink] = useState(false);

  const load = useCallback(() => {
    api<GitInfo>(`/api/projects/${projectId}/git`).then((i) => { setInfo(i); onInfo?.(i); }).catch((e: Error) => setError(e.message));
  }, [projectId, onInfo]);

  useEffect(() => { load(); }, [load, changeTick]);
  useEffect(() => { const t = setInterval(load, 30_000); return () => clearInterval(t); }, [load]);

  const run = async (label: string, fn: () => Promise<unknown>, okMsg?: string) => {
    setBusy(label); setError(null);
    try { await fn(); if (okMsg) setToast(okMsg); } catch (e) { setError((e as Error).message); } finally { setBusy(null); load(); }
  };
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(null), 3000); return () => clearTimeout(t); } }, [toast]);

  if (error && !info) return <div className="p-4 text-sm text-danger">{error}</div>;
  if (!info) return <div className="p-4 text-sm text-muted">Loading…</div>;

  const changes = info.status.changes.filter((c) => !c.path.startsWith(".editor/"));
  const editorChanges = info.status.changes.length - changes.length;

  if (!info.github) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
        <GitBranch size={28} className="text-muted" />
        <div className="max-w-sm">
          <h3 className="text-base font-semibold">Not on GitHub yet</h3>
          <p className="mt-1 text-sm text-muted">
            {info.connected ? <>Create a repository under <b>@{info.login}</b> for this project. Every edit is then committed and pushed automatically.</> : <>Connect your GitHub account in Settings to create a repository for this project and keep it in sync.</>}
          </p>
        </div>
        {info.connected ? (
          <div className="w-full max-w-sm space-y-2 text-left">
            <input className="input" placeholder={`Repository name (default: ${projectName})`} value={repoName} onChange={(e) => setRepoName(e.target.value)} />
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={priv} onChange={(e) => setPriv(e.target.checked)} /> Private repository</label>
            <button className="btn btn-primary w-full justify-center" disabled={!!busy} onClick={() => run("create", () => api(`/api/projects/${projectId}/git/repo`, { method: "POST", body: JSON.stringify({ name: repoName || undefined, private: priv }) }), "Repository created and pushed")}>
              <GitBranch size={14} /> {busy === "create" ? "Creating…" : "Create GitHub repository"}
            </button>
          </div>
        ) : (
          <button className="btn btn-primary" onClick={onOpenSettings}><GitBranch size={14} /> Connect GitHub</button>
        )}
        <button className="text-xs text-muted underline" onClick={() => setShowLink((s) => !s)}>Link an existing remote instead</button>
        {showLink && (
          <div className="flex w-full max-w-sm gap-2">
            <input className="input" placeholder="https://github.com/you/repo.git" value={remoteUrl} onChange={(e) => setRemoteUrl(e.target.value)} />
            <button className="btn" disabled={!remoteUrl || !!busy} onClick={() => run("link", () => api(`/api/projects/${projectId}/git/repo`, { method: "POST", body: JSON.stringify({ remoteUrl }) }), "Remote linked")}><Link2 size={14} /></button>
          </div>
        )}
        {error && <p className="max-w-sm text-xs text-danger">{error}</p>}
      </div>
    );
  }

  const gh = info.github;
  const needsGithub = !info.connected && /github\.com/i.test(gh.htmlUrl);
  return (
    <div className="flex h-full flex-col">
      <div className="space-y-2 border-b border-border px-3 py-2">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <GitBranch size={15} />
          {gh.htmlUrl ? <a className="font-medium underline-offset-2 hover:underline" href={gh.htmlUrl} target="_blank" rel="noreferrer">{gh.owner ? `${gh.owner}/${gh.repo}` : gh.repo}</a> : <span className="font-medium">{gh.repo}</span>}
          <span className="chip font-mono">{info.status.branch ?? gh.branch}</span>
          {info.status.ahead > 0 && <span className="chip" title="Commits not yet pushed">↑{info.status.ahead}</span>}
          {info.status.behind > 0 && <span className="chip" title="Commits on GitHub not pulled yet">↓{info.status.behind}</span>}
          <span className="flex-1" />
          <button className="btn btn-ghost btn-sm" onClick={load} title="Refresh"><RefreshCw size={12} /></button>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
          <span>{changes.length ? `${changes.length} changed file${changes.length === 1 ? "" : "s"}` : "No local changes"}{editorChanges ? ` (+${editorChanges} editor metadata)` : ""}</span>
          <span>· last sync {ago(info.lastSyncAt)}</span>
          {info.autoSyncPending && <span className="chip" style={{ color: "var(--verb)" }}>auto-sync queued</span>}
          <label className="ml-auto flex items-center gap-1" title="Commit and push automatically about 90 s after you stop editing">
            <input type="checkbox" checked={info.autoSync} onChange={(e) => run("auto", () => api(`/api/projects/${projectId}/git`, { method: "PATCH", body: JSON.stringify({ autoSync: e.target.checked }) }))} /> auto-sync
          </label>
        </div>
        {info.lastSyncError && <p className="rounded bg-panel-2 px-2 py-1 text-xs" style={{ color: "var(--danger)" }}>Last sync failed: {info.lastSyncError}</p>}
        {error && <p className="text-xs" style={{ color: "var(--danger)" }}>{error}</p>}
        {toast && <p className="text-xs" style={{ color: "var(--ins-fg)" }}>{toast}</p>}
        <div className="flex gap-2">
          <input className="input" placeholder="Commit message (optional)" value={message} onChange={(e) => setMessage(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") run("sync", () => api(`/api/projects/${projectId}/git/sync`, { method: "POST", body: JSON.stringify({ message }) }).then(() => setMessage("")), "Synced with GitHub"); }} />
          <button className="btn btn-primary" disabled={!!busy || needsGithub} title={needsGithub ? "Connect GitHub to push" : "Commit local changes, pull remote changes, push"} onClick={() => run("sync", () => api(`/api/projects/${projectId}/git/sync`, { method: "POST", body: JSON.stringify({ message }) }).then(() => setMessage("")), "Synced with GitHub")}>
            <RefreshCw size={13} className={cn(busy === "sync" && "animate-spin")} /> {busy === "sync" ? "Syncing…" : "Sync"}
          </button>
          <button className="btn" disabled={!!busy || info.status.changes.length === 0} title="Commit locally without pushing" onClick={() => run("commit", () => api(`/api/projects/${projectId}/git/commit`, { method: "POST", body: JSON.stringify({ message }) }).then(() => setMessage("")), "Committed")}>
            <GitCommitHorizontal size={13} /> Commit
          </button>
        </div>
      </div>

      <div className="scroll-thin min-h-0 flex-1 overflow-auto">
        {changes.length > 0 && (
          <div className="border-b border-border px-3 py-2">
            <div className="panel-title mb-1">Uncommitted changes</div>
            <ul className="space-y-0.5 font-mono text-xs">
              {changes.map((c) => <li key={c.path} className="flex gap-2"><span className="w-5 text-muted">{c.status}</span><span className="truncate">{c.path}</span></li>)}
            </ul>
          </div>
        )}
        <div className="px-3 py-2">
          <div className="panel-title mb-1 flex items-center gap-1"><History size={11} /> History</div>
          {info.history.length === 0 ? <p className="text-xs text-muted">No commits yet.</p> : (
            <ul className="divide-y divide-border">
              {info.history.map((c) => (
                <li key={c.sha} className="group flex items-start gap-2 py-1.5 text-xs">
                  <span className="mt-0.5 font-mono text-muted">{c.short}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{c.subject}</div>
                    <div className="text-[10px] text-muted">{c.author} · {new Date(c.date).toLocaleString()}</div>
                  </div>
                  <span className="hidden shrink-0 gap-1 group-hover:flex">
                    {activeFile && <button className="btn btn-ghost btn-sm !p-1" title={`Use ${activeFile} at this commit as the diff baseline`} onClick={() => run("baseline", async () => { const r = await api<{ content: string }>(`/api/projects/${projectId}/git/file?rev=${c.sha}&path=${encodeURIComponent(activeFile)}`); onUseAsBaseline(r.content, c.short); })}><Camera size={12} /></button>}
                    {gh.htmlUrl && gh.owner && <a className="btn btn-ghost btn-sm !p-1" href={`${gh.htmlUrl}/commit/${c.sha}`} target="_blank" rel="noreferrer" title="Open on GitHub"><ExternalLink size={12} /></a>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="px-3 pb-3">
          <button className="text-[11px] text-muted underline" onClick={() => { if (confirm("Unlink this project from GitHub? Local history and the remote repository are kept; auto-sync stops.")) run("unlink", () => api(`/api/projects/${projectId}/git`, { method: "DELETE" })); }}><Unlink size={10} className="mr-1 inline" />Unlink from GitHub</button>
        </div>
      </div>
    </div>
  );
}
