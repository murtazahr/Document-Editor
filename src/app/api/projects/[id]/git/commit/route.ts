import { handle, json, type Params } from "@/lib/api";
import { commitProject } from "@/lib/git-sync";

export const POST = handle(async (req: Request, { params }: Params<"id">) => {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { message?: string };
  const sha = await commitProject(id, body.message);
  return json({ committed: sha });
});
