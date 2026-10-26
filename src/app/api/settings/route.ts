import { handle, json } from "@/lib/api";
import { detectEngines, pickEngine } from "@/lib/latex-compile";
import { readSettings, resolvePangramKey, writeSettings } from "@/lib/storage";

export const GET = handle(async () => {
  const s = await readSettings();
  const key = await resolvePangramKey();
  const engines = await detectEngines();
  return json({
    pangram: { hasKey: !!key.key, source: key.source, mock: process.env.PANGRAM_MOCK === "1", model: s.pangramModel ?? "default", keyHint: key.key ? `…${key.key.slice(-4)}` : null },
    latex: { engines, selected: await pickEngine(), preference: process.env.LATEX_ENGINE ?? s.latexEngine ?? "auto", envOverride: !!process.env.LATEX_ENGINE },
  });
});

export const PUT = handle(async (req: Request) => {
  const body = (await req.json()) as { pangramApiKey?: string; pangramModel?: string; latexEngine?: "auto" | "latexmk" | "tectonic" | "pdflatex"; clearKey?: boolean };
  await writeSettings({
    ...(body.pangramApiKey !== undefined ? { pangramApiKey: body.pangramApiKey.trim() } : {}),
    ...(body.clearKey ? { pangramApiKey: "" } : {}),
    ...(body.pangramModel !== undefined ? { pangramModel: body.pangramModel } : {}),
    ...(body.latexEngine !== undefined ? { latexEngine: body.latexEngine } : {}),
  });
  return json({ ok: true });
});
