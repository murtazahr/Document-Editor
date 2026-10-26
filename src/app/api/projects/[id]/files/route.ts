import { handle, json, type Params } from "@/lib/api";
import { fileExists, getProject, isTextFile, listFiles, safeRelPath, writeBinaryFile, writeTextFile, StorageError } from "@/lib/storage";

export const GET = handle(async (_req: Request, { params }: Params<"id">) => {
  const { id } = await params;
  return json(await listFiles(id));
});

/** Create a text file (JSON) or upload one or more files (multipart/form-data). */
export const POST = handle(async (req: Request, { params }: Params<"id">) => {
  const { id } = await params;
  await getProject(id);
  const ct = req.headers.get("content-type") ?? "";
  if (ct.startsWith("multipart/form-data")) {
    const form = await req.formData();
    const dir = String(form.get("dir") ?? "").replace(/^\/+|\/+$/g, "");
    const written: string[] = [];
    for (const [key, value] of form.entries()) {
      if (key !== "files" || typeof value === "string") continue;
      const rel = safeRelPath((dir ? dir + "/" : "") + value.name);
      const buf = Buffer.from(await value.arrayBuffer());
      if (isTextFile(rel)) await writeTextFile(id, rel, buf.toString("utf8"));
      else await writeBinaryFile(id, rel, buf);
      written.push(rel);
    }
    return json({ written, files: await listFiles(id) }, 201);
  }
  const body = (await req.json()) as { path: string; content?: string; overwrite?: boolean };
  const rel = safeRelPath(body.path ?? "");
  if (!body.overwrite && (await fileExists(id, rel))) throw new StorageError("File already exists", 409);
  await writeTextFile(id, rel, body.content ?? "");
  return json({ path: rel, files: await listFiles(id) }, 201);
});
