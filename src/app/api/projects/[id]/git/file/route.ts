import { handle, json, type Params } from "@/lib/api";
import { showFile } from "@/lib/git";
import { getProject, projectRoot, safeRelPath, StorageError } from "@/lib/storage";

/** GET ?rev=<sha>&path=<file> → file content at that commit. */
export const GET = handle(async (req: Request, { params }: Params<"id">) => {
  const { id } = await params;
  await getProject(id);
  const u = new URL(req.url);
  const rev = u.searchParams.get("rev");
  const p = u.searchParams.get("path");
  if (!rev || !p) throw new StorageError("rev and path are required", 400);
  return json({ rev, path: p, content: await showFile(projectRoot(id), rev, safeRelPath(p)) });
});
