import { handle, json, type Params } from "@/lib/api";
import { syncProject } from "@/lib/git-sync";

export const maxDuration = 300;

export const POST = handle(async (req: Request, { params }: Params<"id">) => {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { message?: string };
  return json(await syncProject(id, body.message));
});
