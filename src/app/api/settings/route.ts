import { handle, json } from "@/lib/api";
import { detectEngines, pickEngine } from "@/lib/latex-compile";
import { readSettings, resolveAnthropicKey, resolvePangramKey, writeSettings } from "@/lib/storage";
import { DEFAULT_GRAMMAR_MODEL, GRAMMAR_MODELS } from "@/lib/grammar/claude";

export const GET = handle(async () => {
  const s = await readSettings();
  const key = await resolvePangramKey();
  const engines = await detectEngines();
  const akey = await resolveAnthropicKey();
  return json({
    anthropic: { hasKey: !!akey.key, source: akey.source, mock: process.env.ANTHROPIC_MOCK === "1", model: s.anthropicModel ?? DEFAULT_GRAMMAR_MODEL, models: GRAMMAR_MODELS, keyHint: akey.key ? `…${akey.key.slice(-4)}` : null },
    pangram: { hasKey: !!key.key, source: key.source, mock: process.env.PANGRAM_MOCK === "1", model: s.pangramModel ?? "default", mode: s.pangramMode ?? "bulk", keyHint: key.key ? `…${key.key.slice(-4)}` : null },
    latex: { engines, selected: await pickEngine(), preference: process.env.LATEX_ENGINE ?? s.latexEngine ?? "auto", envOverride: !!process.env.LATEX_ENGINE },
  });
});

export const PUT = handle(async (req: Request) => {
  const body = (await req.json()) as { pangramApiKey?: string; pangramModel?: string; pangramMode?: "bulk" | "realtime"; latexEngine?: "auto" | "latexmk" | "tectonic" | "pdflatex"; clearKey?: boolean; anthropicApiKey?: string; anthropicModel?: string; clearAnthropicKey?: boolean };
  await writeSettings({
    ...(body.pangramApiKey !== undefined ? { pangramApiKey: body.pangramApiKey.trim() } : {}),
    ...(body.clearKey ? { pangramApiKey: "" } : {}),
    ...(body.pangramModel !== undefined ? { pangramModel: body.pangramModel } : {}),
    ...(body.pangramMode !== undefined ? { pangramMode: body.pangramMode } : {}),
    ...(body.anthropicApiKey !== undefined ? { anthropicApiKey: body.anthropicApiKey.trim() } : {}),
    ...(body.clearAnthropicKey ? { anthropicApiKey: "" } : {}),
    ...(body.anthropicModel !== undefined ? { anthropicModel: body.anthropicModel } : {}),
    ...(body.latexEngine !== undefined ? { latexEngine: body.latexEngine } : {}),
  });
  return json({ ok: true });
});
