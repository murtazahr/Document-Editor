import { handle, json, type Params } from "@/lib/api";
import { deleteBaseline, readBaseline, readTextFile, safeRelPath, writeBaseline, StorageError } from "@/lib/storage";

function fileParam(req: Request) {
  const f = new URL(req.url).searchParams.get("file");
  if (!f) throw new StorageError("file query parameter required", 400);
  return safeRelPath(f);
}

export const GET = handle(async (req: Request, { params }: Params<"id">) => {
  const { id } = await params;
  const rel = fileParam(req);
  return json({ file: rel, baseline: await readBaseline(id, rel) });
});

/** Body: { file, content? } — omit content to snapshot the current file as baseline. */
export const PUT = handle(async (req: Request, { params }: Params<"id">) => {
  const { id } = await params;
  const body = (await req.json()) as { file: string; content?: string };
  const rel = safeRelPath(body.file);
  const content = body.content ?? (await readTextFile(id, rel));
  await writeBaseline(id, rel, content);
  return json({ ok: true, file: rel, baseline: content });
});

export const DELETE = handle(async (req: Request, { params }: Params<"id">) => {
  const { id } = await params;
  const rel = fileParam(req);
  await deleteBaseline(id, rel);
  return json({ ok: true });
});
