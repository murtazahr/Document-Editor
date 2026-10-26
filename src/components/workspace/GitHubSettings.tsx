"use client";

import { useCallback, useEffect, useState } from "react";
import { GitBranch } from "lucide-react";
import Avatar from "@/components/ui/Avatar";
import { api } from "@/lib/client-api";

export type GitHubStatus = {
  oauthConfigured: boolean;
  gitAvailable: boolean;
  connected: boolean;
  login: string | null;
  avatarUrl: string | null;
  autoCreate: boolean;
  privateRepos: boolean;
  autoSync: boolean;
};

export default function GitHubSettings({ onChanged }: { onChanged?: () => void }) {
  const [st, setSt] = useState<GitHubStatus | null>(null);
  const [token, setToken] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { api<GitHubStatus>("/api/github/status").then(setSt).catch((e: Error) => setMsg(e.message)); }, []);
  useEffect(() => { load(); }, [load]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true); setMsg(null);
    try { await fn(); load(); onChanged?.(); } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };

  if (!st) return <p className="text-xs text-muted">Loading…</p>;
  return (
    <div className="space-y-2">
      {!st.gitAvailable && <p className="rounded bg-panel-2 px-2 py-1 text-xs" style={{ color: "var(--danger)" }}>git is not installed on the server; GitHub sync needs it.</p>}
      {st.connected ? (
        <div className="flex items-center gap-2 text-sm">
          {st.avatarUrl && <Avatar src={st.avatarUrl} size={24} />}
          <span>Connected as <b>@{st.login}</b></span>
          <span className="flex-1" />
          <button className="btn btn-sm btn-danger" disabled={busy} onClick={() => act(() => api("/api/github/token", { method: "DELETE" }))}>Disconnect</button>
        </div>
      ) : (
        <div className="space-y-2">
          {st.oauthConfigured ? (
            <a className="btn btn-primary" href="/api/github/connect"><GitBranch size={14} /> Connect with GitHub</a>
          ) : (
            <p className="text-xs text-muted">One-click sign-in needs <code>GITHUB_CLIENT_ID</code> / <code>GITHUB_CLIENT_SECRET</code> from a GitHub OAuth app (see README). Alternatively paste a personal access token (classic: <code>repo</code> scope; fine-grained: Administration + Contents read/write).</p>
          )}
          <div className="flex gap-2">
            <input className="input" type="password" placeholder="Personal access token" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" />
            <button className="btn" disabled={!token || busy} onClick={() => act(() => api("/api/github/token", { method: "POST", body: JSON.stringify({ token }) }).then(() => setToken("")))}>Connect</button>
          </div>
        </div>
      )}
      <div className="grid gap-1 text-xs">
        <label className="flex items-center gap-2"><input type="checkbox" checked={st.autoCreate} disabled={busy} onChange={(e) => act(() => api("/api/github/token", { method: "PATCH", body: JSON.stringify({ autoCreate: e.target.checked }) }))} /> Create a GitHub repository for every new project</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={st.privateRepos} disabled={busy} onChange={(e) => act(() => api("/api/github/token", { method: "PATCH", body: JSON.stringify({ privateRepos: e.target.checked }) }))} /> New repositories are private</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={st.autoSync} disabled={busy} onChange={(e) => act(() => api("/api/github/token", { method: "PATCH", body: JSON.stringify({ autoSync: e.target.checked }) }))} /> Auto-sync new projects (commit + push ~90 s after edits stop)</label>
      </div>
      <p className="text-[11px] text-muted">The token is stored in plain text in <code>data/settings.json</code> and only used server-side.</p>
      {msg && <p className="text-xs" style={{ color: "var(--danger)" }}>{msg}</p>}
    </div>
  );
}
