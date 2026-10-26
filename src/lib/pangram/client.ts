import type { PangramResult, PangramWindow } from "./types";

export const PANGRAM_BASE = "https://text.external-api.pangram.com";

export class PangramError extends Error {
  constructor(message: string, public status = 502) {
    super(message);
  }
}

const ERROR_HINTS: Record<number, string> = {
  400: "Request body malformed.",
  401: "API key missing or invalid.",
  402: "Insufficient Pangram credits.",
  403: "Model not enabled for this API key.",
  404: "Task not found.",
  422: "Input text or model selector invalid.",
  429: "Pangram rate limit exceeded; try again shortly.",
  500: "Pangram server error.",
  503: "Selected model temporarily unavailable.",
};

async function pangramFetch(key: string, path: string, init: RequestInit = {}) {
  const res = await fetch(PANGRAM_BASE + path, {
    ...init,
    headers: { "x-api-key": key, "Content-Type": "application/json", ...(init.headers ?? {}) },
    cache: "no-store",
  });
  if (!res.ok) {
    let detail = "";
    try { detail = (await res.text()).slice(0, 300); } catch { /* ignore */ }
    throw new PangramError(`Pangram ${res.status}: ${ERROR_HINTS[res.status] ?? res.statusText}${detail ? ` (${detail})` : ""}`, res.status);
  }
  return res.json();
}

export async function listModels(key: string): Promise<string[]> {
  const j = (await pangramFetch(key, "/models")) as { models?: string[] };
  return Array.isArray(j.models) ? j.models : [];
}

export type DetectOptions = {
  model?: string;
  publicDashboardLink?: boolean;
  timeoutMs?: number;
  pollMs?: number;
};

/** Submit a task and poll until it reaches a terminal stage. */
export async function detect(key: string, text: string, opts: DetectOptions = {}): Promise<PangramResult> {
  const model = opts.model || "default";
  const submit = (await pangramFetch(key, "/task", {
    method: "POST",
    body: JSON.stringify({ text, model, public_dashboard_link: !!opts.publicDashboardLink }),
  })) as { task_id?: string };
  if (!submit.task_id) throw new PangramError("Pangram did not return a task_id");
  const deadline = Date.now() + (opts.timeoutMs ?? 180_000);
  const poll = Math.max(500, opts.pollMs ?? 1000);
  for (;;) {
    const r = (await pangramFetch(key, `/task/${encodeURIComponent(submit.task_id)}`)) as PangramResult;
    if (r.stage === "STAGE_SUCCESS") return r;
    if (r.stage === "STAGE_FAILED") throw new PangramError(`Pangram task failed: ${r.headline ?? "unknown error"}`);
    if (Date.now() > deadline) throw new PangramError("Timed out waiting for Pangram result", 504);
    await new Promise((res) => setTimeout(res, poll));
  }
}

/**
 * Deterministic fake result for UI development without spending credits.
 * Enabled with PANGRAM_MOCK=1. Clearly labelled as mock in the UI.
 */
export function mockDetect(text: string): PangramResult {
  const paras = text.split(/\n\s*\n/).filter((p) => p.trim());
  const windows: PangramWindow[] = [];
  let cursor = 0;
  let h = 7;
  for (const p of paras) {
    const start = text.indexOf(p, cursor);
    const end = start + p.length;
    cursor = end;
    for (const ch of p) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const score = (h % 1000) / 1000;
    const label = score > 0.66 ? "AI-Generated" : score > 0.33 ? "AI-Assisted" : "Human Written";
    windows.push({
      text: p, label, ai_assistance_score: Number(score.toFixed(3)),
      confidence: score > 0.85 || score < 0.15 ? "High" : score > 0.6 || score < 0.4 ? "Medium" : "Low",
      start_index: start, end_index: end, word_count: p.split(/\s+/).length, token_length: Math.round(p.length / 4),
      is_humanized: h % 7 === 0, humanizer_score: Number(((h % 100) / 100).toFixed(2)),
    });
  }
  const total = windows.reduce((n, w) => n + w.word_count, 0) || 1;
  const frac = (lab: string) => windows.filter((w) => w.label === lab).reduce((n, w) => n + w.word_count, 0) / total;
  const fa = frac("AI-Generated"), fas = frac("AI-Assisted"), fh = frac("Human Written");
  return {
    stage: "STAGE_SUCCESS", text, version: "mock", headline: fa > 0.5 ? "AI Detected (mock)" : fh > 0.7 ? "Human Written (mock)" : "Mixed (mock)",
    prediction: "Mock prediction generated locally. Set PANGRAM_API_KEY and unset PANGRAM_MOCK for real results.",
    prediction_short: fa > 0.5 ? "AI" : fh > 0.7 ? "Human" : "Mixed",
    fraction_ai: fa, fraction_ai_assisted: fas, fraction_human: fh,
    num_ai_segments: windows.filter((w) => w.label === "AI-Generated").length,
    num_ai_assisted_segments: windows.filter((w) => w.label === "AI-Assisted").length,
    num_human_segments: windows.filter((w) => w.label === "Human Written").length,
    windows,
  };
}
