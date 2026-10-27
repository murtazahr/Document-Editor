import { handle, json, type Params } from "@/lib/api";
import { detect, mockDetect } from "@/lib/pangram/client";
import type { StoredDetection } from "@/lib/pangram/types";
import { countWords } from "@/lib/latex-prose";
import { inputsForAllFiles, prepareInput, submitDetectionJob } from "@/lib/pangram/jobs";
import { mergeIncremental } from "@/lib/pangram/incremental";
import { getProject, readPangramResult, readSettings, resolvePangramKey, safeRelPath, sha1, writePangramResult, StorageError } from "@/lib/storage";

export const maxDuration = 300;

export const GET = handle(async (req: Request, { params }: Params<"id">) => {
  const { id } = await params;
  const file = new URL(req.url).searchParams.get("file");
  if (!file) throw new StorageError("file query parameter required", 400);
  const stored = await readPangramResult<StoredDetection>(id, safeRelPath(file));
  return json({ detection: stored });
});

/**
 * Body: { file, text, model?, publicDashboardLink?, mode?: "bulk" | "realtime" }
 *   or  { allFiles: true, model? }            — one bulk job for every .tex file in the project
 * Bulk submissions return { job } to be polled at /detect/jobs/{bulkId}; realtime returns { detection }.
 */
export const POST = handle(async (req: Request, { params }: Params<"id">) => {
  const { id } = await params;
  await getProject(id);
  const body = (await req.json()) as { file?: string; text?: string; model?: string; publicDashboardLink?: boolean; mode?: "bulk" | "realtime"; allFiles?: boolean; incremental?: boolean };
  const settings = await readSettings();
  const model = body.model || settings.pangramModel || "default";
  const mode = body.allFiles ? "bulk" : body.mode ?? settings.pangramMode ?? "bulk";
  const incremental = body.incremental !== false; // default: only changed paragraphs since the last run
  const mock = process.env.PANGRAM_MOCK === "1";

  if (body.allFiles) {
    const { inputs, unchanged } = await inputsForAllFiles(id, incremental);
    if (!inputs.length) return json({ job: null, unchanged, message: unchanged.length ? "All files are unchanged since their last analysis; nothing was sent." : "No file with enough prose to analyse." });
    return json({ job: await submitDetectionJob(id, inputs, model), unchanged }, 202);
  }

  const rel = safeRelPath(body.file ?? "");
  const text = (body.text ?? "").trim();
  if (countWords(text) < 5) throw new StorageError("Not enough text to analyse (need at least a few sentences).", 400);
  if (text.length > 200_000) throw new StorageError("Text too long for a single detection request; split the file.", 413);
  const prepared = await prepareInput(id, rel, text, incremental, mock);
  if ("unchanged" in prepared) return json({ detection: prepared.unchanged, message: "Unchanged since the last analysis; previous windows kept, nothing sent." });

  if (mode === "bulk") return json({ job: await submitDetectionJob(id, [prepared], model) }, 202);

  let result;
  if (mock) {
    result = mockDetect(prepared.text);
  } else {
    const { key } = await resolvePangramKey();
    if (!key) throw new StorageError("No Pangram API key configured. Add one in Settings or set PANGRAM_API_KEY.", 400);
    result = await detect(key, prepared.text, { model, publicDashboardLink: !!body.publicDashboardLink && !prepared.plan });
  }
  if (prepared.plan) {
    const merged = mergeIncremental(prepared.plan.plan, prepared.plan.fullText, result);
    const stored: StoredDetection = { createdAt: new Date().toISOString(), model, mock, textHash: sha1(text), sentText: text, wordCount: countWords(text), result: merged, mode: "realtime", incremental: merged.incremental };
    await writePangramResult(id, rel, stored);
    return json({ detection: stored });
  }
  const stored: StoredDetection = { createdAt: new Date().toISOString(), model, mock, textHash: sha1(text), sentText: text, wordCount: countWords(text), result, mode: "realtime" };
  await writePangramResult(id, rel, stored);
  return json({ detection: stored });
});
