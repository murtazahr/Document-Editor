import { handle, json, type Params } from "@/lib/api";
import { deleteProject, getProject, listFiles, updateProject } from "@/lib/storage";

export const GET = handle(async (_req: Request, { params }: Params<"id">) => {
  const { id } = await params;
  const meta = await getProject(id);
  return json({ ...meta, files: await listFiles(id) });
});

export const PATCH = handle(async (req: Request, { params }: Params<"id">) => {
  const { id } = await params;
  const body = (await req.json()) as { name?: string; mainFile?: string };
  return json(await updateProject(id, body));
});

export const DELETE = handle(async (_req: Request, { params }: Params<"id">) => {
  const { id } = await params;
  await deleteProject(id);
  return json({ ok: true });
});
