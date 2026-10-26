import { handle, json, type Params } from "@/lib/api";
import * as g from "@/lib/git";
import { autoSyncPending, unlinkProject } from "@/lib/git-sync";
import { getProject, projectRoot, readSettings, updateProject } from "@/lib/storage";

export const GET = handle(async (_req: Request, { params }: Params<"id">) => {
  const { id } = await params;
  const meta = await getProject(id);
  const dir = projectRoot(id);
  const settings = await readSettings();
  const st = await g.status(dir);
  const history = st.isRepo ? await g.log(dir, 40) : [];
  return json({
    connected: !!settings.githubToken,
    login: settings.githubLogin ?? null,
    github: meta.github ?? null,
    autoSync: meta.autoSync ?? settings.githubAutoSync ?? true,
    autoSyncPending: autoSyncPending(id),
    lastSyncAt: meta.lastSyncAt ?? null,
    lastSyncError: meta.lastSyncError ?? null,
    status: st,
    history,
  });
});

export const PATCH = handle(async (req: Request, { params }: Params<"id">) => {
  const { id } = await params;
  const body = (await req.json()) as { autoSync?: boolean };
  const meta = await getProject(id);
  if (body.autoSync !== undefined) await updateProject(id, { autoSync: body.autoSync, updatedAt: meta.updatedAt });
  return json({ ok: true });
});

/** Unlink from GitHub (keeps the local git history and the remote repo). */
export const DELETE = handle(async (_req: Request, { params }: Params<"id">) => {
  const { id } = await params;
  await unlinkProject(id);
  return json({ ok: true });
});
