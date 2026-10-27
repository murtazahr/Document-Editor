"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { api, type SettingsInfo } from "@/lib/client-api";
import GitHubSettings from "./GitHubSettings";

export default function SettingsDialog({ onClose, onSaved }: { onClose: () => void; onSaved?: () => void }) {
  const [info, setInfo] = useState<SettingsInfo | null>(null);
  const [key, setKey] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState("default");
  const [mode, setMode] = useState<"bulk" | "realtime">("bulk");
  const [akey, setAkey] = useState("");
  const [amodel, setAmodel] = useState("claude-sonnet-5-5");
  const [engine, setEngine] = useState("auto");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () =>
    api<SettingsInfo>("/api/settings").then((s) => {
      setInfo(s);
      setModel(s.pangram.model);
      setMode(s.pangram.mode);
      setAmodel(s.anthropic.model);
      setEngine(s.latex.preference);
      if (s.pangram.hasKey || s.pangram.mock) {
        api<{ models: string[] }>("/api/pangram/models").then((m) => setModels(m.models)).catch(() => setModels([]));
      }
    }).catch((e: Error) => setMsg(e.message));
  useEffect(() => { load(); }, []);

  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      await api("/api/settings", { method: "PUT", body: JSON.stringify({ ...(key ? { pangramApiKey: key } : {}), ...(akey ? { anthropicApiKey: akey } : {}), anthropicModel: amodel, pangramModel: model, pangramMode: mode, latexEngine: engine }) });
      setKey("");
      setAkey("");
      setMsg("Saved.");
      await load();
      onSaved?.();
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  const clearKey = async () => {
    setBusy(true);
    try { await api("/api/settings", { method: "PUT", body: JSON.stringify({ clearKey: true }) }); await load(); onSaved?.(); } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl border border-border bg-panel p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold">Settings</h2>
          <button className="btn btn-ghost" onClick={onClose}><X size={16} /></button>
        </div>
        {!info ? <p className="text-muted">Loading…</p> : (
          <div className="space-y-6">
            <section>
              <h3 className="panel-title mb-2">GitHub</h3>
              <GitHubSettings onChanged={onSaved} />
            </section>
            <section>
              <h3 className="panel-title mb-2">Pangram AI detection</h3>
              {info.pangram.mock && <p className="mb-2 rounded bg-accent-soft px-2 py-1 text-xs">PANGRAM_MOCK=1 is set: detection returns locally generated fake results and no credits are used.</p>}
              <p className="mb-2 text-xs text-muted">
                {info.pangram.source === "env" && <>Key is provided by the <code>PANGRAM_API_KEY</code> environment variable ({info.pangram.keyHint}); it overrides anything saved here.</>}
                {info.pangram.source === "settings" && <>Key saved in the app data folder ({info.pangram.keyHint}). It is stored in plain text in <code>data/settings.json</code>.</>}
                {info.pangram.source === "none" && <>No key configured. Get one from your Pangram dashboard and paste it below, or set <code>PANGRAM_API_KEY</code>.</>}
              </p>
              <div className="flex gap-2">
                <input className="input" type="password" placeholder="Paste API key" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" />
                {info.pangram.source === "settings" && <button className="btn btn-danger" onClick={clearKey} disabled={busy}>Remove</button>}
              </div>
              <label className="mt-3 block text-xs text-muted">Default model
                <select className="input mt-1" value={model} onChange={(e) => setModel(e.target.value)}>
                  {(models.length ? Array.from(new Set(["default", ...models])) : ["default"]).map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </label>
              <p className="mt-1 text-[11px] text-muted">Models come from Pangram&apos;s <code>GET /models</code> for your key; &quot;default&quot; follows Pangram&apos;s current default model.</p>
              <label className="mt-3 block text-xs text-muted">API mode
                <select className="input mt-1" value={mode} onChange={(e) => setMode(e.target.value as "bulk" | "realtime")}>
                  <option value="bulk">Bulk (about 20% cheaper; asynchronous, results when the job completes)</option>
                  <option value="realtime">Realtime (task API; result within seconds; dashboard links available)</option>
                </select>
              </label>
            </section>
            <section>
              <h3 className="panel-title mb-2">Grammar checker (Claude)</h3>
              {info.anthropic.mock && <p className="mb-2 rounded bg-accent-soft px-2 py-1 text-xs">ANTHROPIC_MOCK=1 is set: the grammar checker returns locally generated fake suggestions.</p>}
              <p className="mb-2 text-xs text-muted">
                {info.anthropic.source === "env" && <>Key is provided by the <code>ANTHROPIC_API_KEY</code> environment variable ({info.anthropic.keyHint}); it overrides anything saved here.</>}
                {info.anthropic.source === "settings" && <>Key saved in the app data folder ({info.anthropic.keyHint}), stored in plain text in <code>data/settings.json</code>.</>}
                {info.anthropic.source === "none" && <>No key configured. Create one in the Anthropic Console and paste it below, or set <code>ANTHROPIC_API_KEY</code>.</>}
              </p>
              <div className="flex gap-2">
                <input className="input" type="password" placeholder="Paste Anthropic API key (sk-ant-…)" value={akey} onChange={(e) => setAkey(e.target.value)} autoComplete="off" />
                {info.anthropic.source === "settings" && <button className="btn btn-danger" disabled={busy} onClick={async () => { setBusy(true); try { await api("/api/settings", { method: "PUT", body: JSON.stringify({ clearAnthropicKey: true }) }); await load(); onSaved?.(); } finally { setBusy(false); } }}>Remove</button>}
              </div>
              <label className="mt-3 block text-xs text-muted">Model
                <select className="input mt-1" value={amodel} onChange={(e) => setAmodel(e.target.value)}>
                  {Array.from(new Set([...info.anthropic.models, amodel])).map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </label>
              <p className="mt-1 text-[11px] text-muted">Sonnet is a good default for copy-editing; Haiku is cheaper, Opus more thorough. Each check is billed by Anthropic per token; the Grammar tab shows tokens used.</p>
            </section>
            <section>
              <h3 className="panel-title mb-2">LaTeX engine</h3>
              <div className="mb-2 flex flex-wrap gap-1.5 text-xs">
                {(["latexmk", "tectonic", "pdflatex"] as const).map((e) => (
                  <span key={e} className="chip">{e}: {info.latex.engines[e] ? <span className="text-ins-fg" style={{ color: "var(--ins-fg)" }}>found</span> : <span style={{ color: "var(--danger)" }}>not found</span>}</span>
                ))}
              </div>
              <select className="input" value={engine} onChange={(e) => setEngine(e.target.value)} disabled={info.latex.envOverride}>
                <option value="auto">auto (latexmk → tectonic → pdflatex)</option>
                <option value="latexmk">latexmk</option>
                <option value="tectonic">tectonic</option>
                <option value="pdflatex">pdflatex</option>
              </select>
              {info.latex.envOverride && <p className="mt-1 text-[11px] text-muted">Overridden by the <code>LATEX_ENGINE</code> environment variable.</p>}
              {!info.latex.selected && <p className="mt-1 text-[11px]" style={{ color: "var(--danger)" }}>No engine found on PATH. Install TeX Live (provides latexmk) or Tectonic, or run the Docker image. See README.</p>}
            </section>
            <div className="flex items-center justify-end gap-2">
              {msg && <span className="text-xs text-muted">{msg}</span>}
              <button className="btn btn-primary" onClick={save} disabled={busy}>Save</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
