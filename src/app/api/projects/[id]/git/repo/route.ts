import { handle, json, type Params } from "@/lib/api";
import { createGithubRepoForProject, linkRemoteForProject } from "@/lib/git-sync";
import { StorageError } from "@/lib/storage";

export const maxDuration = 300;

/** Body: { name?, private? } to create a GitHub repo, or { remoteUrl } to link an existing remote. */
export const POST = handle(async (req: Request, { params }: Params<"id">) => {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { name?: string; private?: boolean; remoteUrl?: string };
  if (body.remoteUrl) {
    if (!/^(https?:\/\/|file:\/\/|\/|git@)/.test(body.remoteUrl.trim())) throw new StorageError("Invalid remote URL", 400);
    return json({ github: await linkRemoteForProject(id, body.remoteUrl.trim()) }, 201);
  }
  return json({ github: await createGithubRepoForProject(id, body) }, 201);
});
