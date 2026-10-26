import { promises as fs } from "node:fs";
import * as g from "./git";
import { createRepo, getUser, noreplyEmail, repoExists, slugifyRepoName, type GitHubRepo } from "./github";
import { adoptProjectDir, getProject, newProjectDir, projectRoot, readSettings, readTrackedConfig, updateProject, writeTrackedConfig, StorageError, type ProjectMeta, type GitHubLink } from "./storage";

/** High-level git/GitHub operations on projects: locking, identity, auto-sync. */

const locks = new Map<string, Promise<unknown>>();

export function withProjectLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(id) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  locks.set(id, next);
  const cleanup = () => { if (locks.get(id) === next) locks.delete(id); };
  next.then(cleanup, cleanup);
  return next;
}

export async function githubAuth(): Promise<{ token: string; ident: g.GitIdentity; login: string }> {
  const s = await readSettings();
  if (!s.githubToken) throw new StorageError("GitHub is not connected. Connect it in Settings.", 400);
  const login = s.githubLogin ?? "user";
  const ident = { name: login, email: s.githubUserId ? `${s.githubUserId}+${login}@users.noreply.github.com` : `${login}@users.noreply.github.com` };
  return { token: s.githubToken, ident, login };
}

const LOCAL_IDENT: g.GitIdentity = { name: "Rewrite Studio", email: "rewrite-studio@localhost" };

async function identityOrLocal(): Promise<g.GitIdentity> {
  try { return (await githubAuth()).ident; } catch { return LOCAL_IDENT; }
}

/** Credentials for talking to a project's remote: GitHub token when connected, none for non-GitHub remotes. */
async function authForRemote(dir: string): Promise<{ token: string | null; ident: g.GitIdentity }> {
  const s = await readSettings();
  if (s.githubToken) { const a = await githubAuth(); return { token: a.token, ident: a.ident }; }
  const remote = (await g.getRemote(dir)) ?? "";
  if (/github\.com/i.test(remote)) throw new StorageError("GitHub is not connected. Connect it in Settings to push to GitHub.", 400);
  return { token: null, ident: LOCAL_IDENT };
}

export type SyncReport = { committed: string | null; pulled: boolean; pushed: boolean; message?: string };

/** Commit all local changes (if any). */
export async function commitProject(id: string, message?: string): Promise<string | null> {
  return withProjectLock(id, async () => {
    const dir = projectRoot(id);
    await g.ensureRepo(dir);
    const meta = await getProject(id);
    await writeTrackedConfig(id, meta);
    const ident = await identityOrLocal();
    return g.commitAll(dir, message?.trim() || defaultMessage(await g.status(dir)), ident);
  });
}

function defaultMessage(st: g.GitStatus): string {
  const files = st.changes.map((c) => c.path).filter((p) => !p.startsWith(".editor/"));
  const head = files.slice(0, 3).join(", ") + (files.length > 3 ? ` +${files.length - 3} more` : "");
  return `Update ${head || "project"}`;
}

/** Commit if needed, pull --rebase, push. */
export async function syncProject(id: string, message?: string): Promise<SyncReport> {
  return withProjectLock(id, async () => {
    const meta = await getProject(id);
    if (!meta.github) throw new StorageError("This project is not linked to a GitHub repository yet.", 400);
    const dir = projectRoot(id);
    await g.ensureRepo(dir);
    const { token, ident } = await authForRemote(dir);
    await writeTrackedConfig(id, meta);
    const report: SyncReport = { committed: null, pulled: false, pushed: false };
    try {
      const st = await g.status(dir);
      if (st.changes.length) report.committed = await g.commitAll(dir, message?.trim() || defaultMessage(st), ident);
      const pulled = await g.pullRebase(dir, token, meta.github.branch);
      report.pulled = pulled.updated;
      const after = await g.status(dir);
      if (after.ahead > 0 || !after.upstream) { await g.push(dir, token, meta.github.branch); report.pushed = true; }
      await updateProject(id, { lastSyncAt: new Date().toISOString(), lastSyncError: "", updatedAt: meta.updatedAt });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await updateProject(id, { lastSyncError: msg, updatedAt: meta.updatedAt });
      throw e;
    }
    return report;
  });
}

/** Create a GitHub repository for the project, link it, and push the first commit. */
export async function createGithubRepoForProject(id: string, opts: { name?: string; private?: boolean } = {}): Promise<GitHubLink> {
  return withProjectLock(id, async () => {
    const meta = await getProject(id);
    if (meta.github) throw new StorageError("Project already linked to a GitHub repository.", 409);
    const { token, ident, login } = await githubAuth();
    const settings = await readSettings();
    const isPrivate = opts.private ?? settings.githubPrivate ?? true;
    const base = slugifyRepoName(opts.name || meta.name);
    let name = base;
    for (let i = 2; await repoExists(token, login, name); i++) name = `${base}-${i}`;
    const repo: GitHubRepo = await createRepo(token, { name, private: isPrivate, description: `LaTeX project "${meta.name}" (Rewrite Studio)` });
    const dir = projectRoot(id);
    await g.ensureRepo(dir);
    await writeTrackedConfig(id, meta);
    const branch = await g.currentBranch(dir);
    await g.setRemote(dir, repo.clone_url);
    const link: GitHubLink = { owner: repo.owner.login, repo: repo.name, htmlUrl: repo.html_url, branch };
    await g.commitAll(dir, "Initial commit", ident);
    await g.push(dir, token, branch);
    await updateProject(id, { github: link, autoSync: meta.autoSync ?? settings.githubAutoSync ?? true, lastSyncAt: new Date().toISOString(), lastSyncError: "" });
    return link;
  });
}

/** Link an existing remote (GitHub URL or any git URL) without creating a repo. */
export async function linkRemoteForProject(id: string, remoteUrl: string): Promise<GitHubLink> {
  return withProjectLock(id, async () => {
    const meta = await getProject(id);
    const dir = projectRoot(id);
    await g.ensureRepo(dir);
    await writeTrackedConfig(id, meta);
    await g.setRemote(dir, remoteUrl);
    const branch = await g.currentBranch(dir);
    const link = linkFromUrl(remoteUrl, branch);
    const ident = await identityOrLocal();
    await g.commitAll(dir, "Initial commit", ident);
    const settings = await readSettings();
    await updateProject(id, { github: link, autoSync: meta.autoSync ?? settings.githubAutoSync ?? true });
    return link;
  });
}

export function linkFromUrl(url: string, branch: string): GitHubLink {
  const m = url.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  if (m) return { owner: m[1], repo: m[2], htmlUrl: `https://github.com/${m[1]}/${m[2]}`, branch };
  return { owner: "", repo: url.split("/").pop()?.replace(/\.git$/, "") ?? "remote", htmlUrl: url.startsWith("http") ? url : "", branch };
}

export async function unlinkProject(id: string) {
  await updateProject(id, { github: undefined });
}

/** Clone a repository into a brand-new project. */
export async function importFromRemote(cloneUrl: string, name?: string): Promise<ProjectMeta> {
  const settings = await readSettings();
  const token = settings.githubToken ?? null;
  const { id, dir } = newProjectDir();
  await g.clone(cloneUrl, dir, token);
  const branch = await g.currentBranch(dir);
  const link = linkFromUrl(cloneUrl, branch);
  const cfg = await readTrackedConfig(dir);
  const mainFile = cfg?.mainFile && (await fs.access(`${dir}/${cfg.mainFile}`).then(() => true).catch(() => false)) ? cfg.mainFile : await guessMainFile(dir);
  const meta = await adoptProjectDir(id, name?.trim() || cfg?.name || link.repo, mainFile, { github: link, autoSync: settings.githubAutoSync ?? true, lastSyncAt: new Date().toISOString() });
  await g.ensureRepo(dir); // adds .gitignore if the repo lacks one
  return meta;
}

async function guessMainFile(dir: string): Promise<string> {
  const texFiles: string[] = [];
  async function walk(rel: string, depth: number) {
    if (depth > 3) return;
    for (const e of await fs.readdir(rel ? `${dir}/${rel}` : dir, { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) await walk(r, depth + 1);
      else if (e.name.endsWith(".tex")) texFiles.push(r);
    }
  }
  await walk("", 0);
  if (texFiles.includes("main.tex")) return "main.tex";
  for (const f of texFiles) {
    const head = await fs.readFile(`${dir}/${f}`, "utf8").then((s) => s.slice(0, 20_000)).catch(() => "");
    if (/\\documentclass/.test(head)) return f;
  }
  return texFiles[0] ?? "main.tex";
}

// ---------- auto-sync ----------

const AUTO_SYNC_DELAY_MS = Number(process.env.GITHUB_AUTOSYNC_DELAY_MS ?? 90_000);
const timers = new Map<string, ReturnType<typeof setTimeout>>();

/** Call after any local change; schedules a commit+push once edits settle. */
export function noteProjectChanged(id: string) {
  const t = timers.get(id);
  if (t) clearTimeout(t);
  timers.set(id, setTimeout(async () => {
    timers.delete(id);
    try {
      const meta = await getProject(id);
      if (!meta.github || meta.autoSync === false) return;
      await syncProject(id);
    } catch (e) {
      console.warn(`[auto-sync ${id}]`, e instanceof Error ? e.message : e);
    }
  }, AUTO_SYNC_DELAY_MS));
}

export function autoSyncPending(id: string) {
  return timers.has(id);
}

/** Used when the user connects GitHub: refresh identity fields from the API. */
export async function refreshGithubIdentity(token: string) {
  const u = await getUser(token);
  return { login: u.login, id: u.id, avatar: u.avatar_url, email: noreplyEmail(u) };
}
