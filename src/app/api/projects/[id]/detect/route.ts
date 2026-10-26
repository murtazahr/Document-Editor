import { handle, json, type Params } from "@/lib/api";
import { detect, mockDetect } from "@/lib/pangram/client";
import type { StoredDetection } from "@/lib/pangram/types";
import { countWords } from "@/lib/latex-prose";
import { getProject, readPangramResult, readSettings, resolvePangramKey, safeRelPath, sha1, writePangramResult, StorageError } from "@/lib/storage";

export const maxDuration = 300;

export const GET = handle(async (req: Request, { params }: Params<"id">) => {
  const { id } = await params;
  const file = new URL(req.url).searchParams.get("file");
  if (!file) throw new StorageError("file query parameter required", 400);
  const stored = await readPangramResult<StoredDetection>(id, safeRelPath(file));
  return json({ detection: stored });
});

/** Body: { file, text, model?, publicDashboardLink? } — `text` is the prose extracted client-side. */
export const POST = handle(async (req: Request, { params }: Params<"id">) => {
  const { id } = await params;
  await getProject(id);
  const body = (await req.json()) as { file: string; text: string; model?: string; publicDashboardLink?: boolean };
  const rel = safeRelPath(body.file);
  const text = (body.text ?? "").trim();
  if (countWords(text) < 5) throw new StorageError("Not enough text to analyse (need at least a few sentences).", 400);
  if (text.length > 200_000) throw new StorageError("Text too long for a single detection request; split the file.", 413);
  const settings = await readSettings();
  const model = body.model || settings.pangramModel || "default";
  const mock = process.env.PANGRAM_MOCK === "1";
  let result;
  if (mock) {
    result = mockDetect(text);
  } else {
    const { key } = await resolvePangramKey();
    if (!key) throw new StorageError("No Pangram API key configured. Add one in Settings or set PANGRAM_API_KEY.", 400);
    result = await detect(key, text, { model, publicDashboardLink: !!body.publicDashboardLink });
  }
  const stored: StoredDetection = { createdAt: new Date().toISOString(), model, mock, textHash: sha1(text), sentText: text, wordCount: countWords(text), result };
  await writePangramResult(id, rel, stored);
  return json({ detection: stored });
});
