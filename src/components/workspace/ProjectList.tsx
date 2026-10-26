"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileText, Plus, Sparkles, Trash2, Settings, GitBranch, Download } from "lucide-react";
import Avatar from "@/components/ui/Avatar";
import { useSearchParams } from "next/navigation";
import { api, type ProjectMeta } from "@/lib/client-api";
import SettingsDialog from "./SettingsDialog";
import ImportDialog from "./ImportDialog";
import type { GitHubStatus } from "./GitHubSettings";

export default function ProjectList() {
  const [projects, setProjects] = useState<ProjectMeta[] | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [gh, setGh] = useState<GitHubStatus | null>(null);
  const router = useRouter();
  const search = useSearchParams();
  const ghNotice = search.get("github");
  const ghReason = search.get("reason");

  const load = useCallback(() => {
    api<ProjectMeta[]>("/api/projects").then(setProjects).catch((e: Error) => setError(e.message));
  }, []);
  const loadGh = useCallback(() => { api<GitHubStatus>("/api/github/status").then(setGh).catch(() => setGh(null)); }, []);
  useEffect(() => { load(); loadGh(); }, [load, loadGh]);

  const create = async (template: "blank" | "sample") => {
    setBusy(true);
    setError(null);
    try {
      const p = await api<ProjectMeta & { githubError?: string }>("/api/projects", { method: "POST", body: JSON.stringify({ name: template === "sample" ? "Sample paper" : name, template }) });
      if (p.githubError) alert(`Project created, but the GitHub repository could not be created:\n${p.githubError}\n\nYou can retry from the project's Git tab.`);
      router.push(`/p/${p.id}`);
    } catch (e) { setError((e as Error).message); setBusy(false); }
  };

  const remove = async (p: ProjectMeta) => {
    if (!confirm(`Delete "${p.name}" and all its files? This cannot be undone.`)) return;
    await api(`/api/projects/${p.id}`, { method: "DELETE" });
    load();
  };

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Rewrite Studio</h1>
          <p className="mt-1 text-muted">LaTeX editor with a baseline diff for rewriting and Pangram AI-detection feedback.</p>
        </div>
        <div className="flex items-center gap-2">
          {gh?.connected ? (
            <span className="chip" title="GitHub connected">{gh.avatarUrl && <Avatar src={gh.avatarUrl} size={16} />} @{gh.login}</span>
          ) : gh && (
            <button className="btn" onClick={() => setSettingsOpen(true)} title="Connect GitHub to version-control and sync every project"><GitBranch size={14} /> Connect GitHub</button>
          )}
          <button className="btn" onClick={() => setSettingsOpen(true)}><Settings size={14} /> Settings</button>
        </div>
      </div>
      {ghNotice === "connected" && <p className="mb-4 rounded-md border border-border bg-accent-soft px-3 py-2 text-sm">GitHub connected. New projects will get their own repository{gh?.autoCreate === false ? " when you enable it in Settings" : ""}.</p>}
      {ghNotice === "error" && <p className="mb-4 rounded-md border border-border px-3 py-2 text-sm text-danger">GitHub connection failed{ghReason ? `: ${ghReason}` : ""}.</p>}

      <form className="mb-8 flex gap-2" onSubmit={(e) => { e.preventDefault(); create("blank"); }}>
        <input className="input" placeholder="New project name" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn btn-primary" disabled={busy} type="submit"><Plus size={14} /> Create</button>
        <button className="btn" disabled={busy} type="button" onClick={() => create("sample")} title="A short AI-style paper with its baseline already set, so you can start rewriting immediately"><Sparkles size={14} /> Sample paper</button>
        {gh?.connected && <button className="btn" disabled={busy} type="button" onClick={() => setImportOpen(true)} title="Clone one of your GitHub repositories as a project"><Download size={14} /> Import</button>}
      </form>

      {error && <p className="mb-4 text-sm text-danger">{error}</p>}

      {projects === null ? (
        <p className="text-muted">Loading…</p>
      ) : projects.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-10 text-center text-muted">
          No projects yet. Create one above, or start from the sample paper.
        </div>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-panel">
          {projects.map((p) => (
            <li key={p.id} className="flex items-center gap-3 px-4 py-3 hover:bg-panel-2">
              <FileText size={18} className="text-muted" />
              <Link href={`/p/${p.id}`} className="flex-1">
                <div className="font-medium">{p.name}</div>
                <div className="text-xs text-muted">{p.mainFile} · updated {new Date(p.updatedAt).toLocaleString()}</div>
              </Link>
              {p.github && <a className="chip hover:underline" href={p.github.htmlUrl || undefined} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} title={p.lastSyncError ? `Last sync failed: ${p.lastSyncError}` : "GitHub repository"}><GitBranch size={11} /> {p.github.owner ? `${p.github.owner}/${p.github.repo}` : p.github.repo}{p.lastSyncError && <span style={{ color: "var(--danger)" }}> !</span>}</a>}
              <button className="btn btn-ghost btn-danger" onClick={() => remove(p)} title="Delete project"><Trash2 size={14} /></button>
            </li>
          ))}
        </ul>
      )}
      {settingsOpen && <SettingsDialog onClose={() => { setSettingsOpen(false); loadGh(); }} onSaved={loadGh} />}
      {importOpen && <ImportDialog onClose={() => setImportOpen(false)} />}
    </main>
  );
}
