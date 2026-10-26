import { handle, json, type Params } from "@/lib/api";
import { compileProject } from "@/lib/latex-compile";
import { getProject } from "@/lib/storage";

export const maxDuration = 300;

export const POST = handle(async (_req: Request, { params }: Params<"id">) => {
  const { id } = await params;
  const meta = await getProject(id);
  const result = await compileProject(id, meta.mainFile);
  return json(result);
});
