import { handle, json } from "@/lib/api";
import { refreshGithubIdentity } from "@/lib/git-sync";
import { writeSettings, StorageError } from "@/lib/storage";

/** Connect with a personal access token (classic: `repo` scope; fine-grained: Administration write + Contents write). */
export const POST = handle(async (req: Request) => {
  const body = (await req.json()) as { token?: string };
  const token = body.token?.trim();
  if (!token) throw new StorageError("Token required", 400);
  const me = await refreshGithubIdentity(token);
  await writeSettings({ githubToken: token, githubLogin: me.login, githubUserId: me.id, githubAvatarUrl: me.avatar });
  return json({ ok: true, login: me.login });
});

export const PATCH = handle(async (req: Request) => {
  const body = (await req.json()) as { autoCreate?: boolean; privateRepos?: boolean; autoSync?: boolean };
  await writeSettings({
    ...(body.autoCreate !== undefined ? { githubAutoCreate: body.autoCreate } : {}),
    ...(body.privateRepos !== undefined ? { githubPrivate: body.privateRepos } : {}),
    ...(body.autoSync !== undefined ? { githubAutoSync: body.autoSync } : {}),
  });
  return json({ ok: true });
});

export const DELETE = handle(async () => {
  await writeSettings({ githubToken: "", githubLogin: "", githubAvatarUrl: "", githubUserId: undefined });
  return json({ ok: true });
});
