import { handle, json } from "@/lib/api";
import { importFromRemote } from "@/lib/git-sync";
import { StorageError } from "@/lib/storage";

export const maxDuration = 300;

/** Body: { cloneUrl, name? } — clone a repository into a new project. */
export const POST = handle(async (req: Request) => {
  const body = (await req.json()) as { cloneUrl?: string; name?: string };
  const url = body.cloneUrl?.trim();
  if (!url || !/^(https?:\/\/|file:\/\/|\/)/.test(url)) throw new StorageError("A https:// clone URL is required", 400);
  const meta = await importFromRemote(url, body.name);
  return json(meta, 201);
});
