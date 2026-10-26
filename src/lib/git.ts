import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Thin wrapper over the git CLI. Credentials are passed per invocation as an
 * HTTP Authorization header (never written to .git/config or the remote URL).
 */

export class GitError extends Error {
  constructor(message: string, public stderr = "", public status = 500) {
    super(message);
  }
}

export type GitIdentity = { name: string; email: string };

export type GitStatus = {
  isRepo: boolean;
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  changes: { path: string; status: string }[];
};

export type GitCommit = { sha: string; short: string; author: string; date: string; subject: string };

function authArgs(token?: string | null): string[] {
  if (!token) return [];
  const b64 = Buffer.from(`x-access-token:${token}`).toString("base64");
  return ["-c", `http.https://github.com/.extraheader=Authorization: Basic ${b64}`];
}

function identityArgs(ident?: GitIdentity): string[] {
  if (!ident) return [];
  return ["-c", `user.name=${ident.name}`, "-c", `user.email=${ident.email}`];
}

export function git(cwd: string, args: string[], opts: { token?: string | null; ident?: GitIdentity; timeoutMs?: number; allowFail?: boolean } = {}): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile("git", [...authArgs(opts.token), ...identityArgs(opts.ident), ...args], {
      cwd, timeout: opts.timeoutMs ?? 120_000, maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "", SSH_ASKPASS: "", GCM_INTERACTIVE: "never", LC_ALL: "C" },
    }, (err, stdout, stderr) => {
      const e = err as (NodeJS.ErrnoException & { code?: number | string }) | null;
      const code = e ? (typeof e.code === "number" ? e.code : 1) : 0;
      const out = { code, stdout: String(stdout), stderr: String(stderr) };
      if (e && (e as NodeJS.ErrnoException).code === "ENOENT") return reject(new GitError("git is not installed on the server", "", 503));
      if (code !== 0 && !opts.allowFail) {
        // scrub any token that might appear in error output
        const scrubbed = out.stderr.replace(/Basic [A-Za-z0-9+/=]+/g, "Basic ***").replace(/gh[pousr]_[A-Za-z0-9]{20,}/g, "***");
        return reject(new GitError(`git ${args[0]} failed: ${scrubbed.trim().split("\n").slice(-3).join(" ") || `exit ${code}`}`, scrubbed));
      }
      resolve(out);
    });
  });
}

export async function gitAvailable(): Promise<boolean> {
  try { await git(process.cwd(), ["--version"]); return true; } catch { return false; }
}

export async function isRepo(dir: string): Promise<boolean> {
  try { await fs.access(path.join(dir, ".git")); return true; } catch { return false; }
}

export const PROJECT_GITIGNORE = `# Rewrite Studio
.build/
project.json
*.aux
*.log
*.out
*.toc
*.synctex.gz
*.fls
*.fdb_latexmk
*.bbl
*.blg
.DS_Store
`;

/** git init with a main branch and a .gitignore; no-op if already a repo. */
export async function ensureRepo(dir: string): Promise<void> {
  if (!(await isRepo(dir))) {
    await git(dir, ["init", "-q", "-b", "main"]);
  }
  const gi = path.join(dir, ".gitignore");
  try { await fs.access(gi); } catch { await fs.writeFile(gi, PROJECT_GITIGNORE); }
}

export async function status(dir: string): Promise<GitStatus> {
  if (!(await isRepo(dir))) return { isRepo: false, branch: null, upstream: null, ahead: 0, behind: 0, changes: [] };
  const r = await git(dir, ["status", "--porcelain=v1", "-b", "--untracked-files=all"]);
  const lines = r.stdout.split("\n").filter(Boolean);
  const head = lines.shift() ?? "";
  let branch: string | null = null, upstream: string | null = null, ahead = 0, behind = 0;
  const m = head.match(/^## (?:No commits yet on )?([^\s.]+)(?:\.\.\.(\S+))?(?: \[(.*)\])?/);
  if (m) {
    branch = m[1];
    upstream = m[2] ?? null;
    const flags = m[3] ?? "";
    const a = flags.match(/ahead (\d+)/); const b = flags.match(/behind (\d+)/);
    if (a) ahead = Number(a[1]);
    if (b) behind = Number(b[1]);
  }
  const changes = lines.map((l) => ({ status: l.slice(0, 2).trim() || "??", path: l.slice(3).replace(/^"|"$/g, "") }));
  return { isRepo: true, branch, upstream, ahead, behind, changes };
}

export async function hasCommits(dir: string): Promise<boolean> {
  const r = await git(dir, ["rev-parse", "--verify", "-q", "HEAD"], { allowFail: true });
  return r.code === 0;
}

/** Stage everything and commit. Returns the new sha, or null when there was nothing to commit. */
export async function commitAll(dir: string, message: string, ident: GitIdentity): Promise<string | null> {
  await git(dir, ["add", "-A"]);
  const staged = await git(dir, ["diff", "--cached", "--quiet"], { allowFail: true });
  if (staged.code === 0) return null;
  await git(dir, ["commit", "-q", "-m", message], { ident });
  return (await git(dir, ["rev-parse", "HEAD"])).stdout.trim();
}

export async function setRemote(dir: string, url: string, name = "origin") {
  const r = await git(dir, ["remote", "get-url", name], { allowFail: true });
  if (r.code === 0) await git(dir, ["remote", "set-url", name, url]);
  else await git(dir, ["remote", "add", name, url]);
}

export async function getRemote(dir: string, name = "origin"): Promise<string | null> {
  const r = await git(dir, ["remote", "get-url", name], { allowFail: true });
  return r.code === 0 ? r.stdout.trim() : null;
}

export async function currentBranch(dir: string): Promise<string> {
  const r = await git(dir, ["symbolic-ref", "--short", "-q", "HEAD"], { allowFail: true });
  return r.stdout.trim() || "main";
}

export async function push(dir: string, token: string | null, branch?: string) {
  const b = branch ?? (await currentBranch(dir));
  await git(dir, ["push", "-u", "origin", `HEAD:${b}`], { token, timeoutMs: 180_000 });
}

/**
 * Bring in remote changes with a rebase. On conflict the rebase is aborted and
 * a GitError is thrown so the local tree stays usable.
 */
export async function pullRebase(dir: string, token: string | null, branch?: string): Promise<{ updated: boolean }> {
  const b = branch ?? (await currentBranch(dir));
  const before = (await git(dir, ["rev-parse", "HEAD"], { allowFail: true })).stdout.trim();
  await git(dir, ["fetch", "-q", "origin", b], { token, timeoutMs: 180_000 }).catch((e: GitError) => {
    if (/couldn't find remote ref|no such ref/i.test(e.stderr)) return; // remote branch doesn't exist yet
    throw e;
  });
  const remoteHas = (await git(dir, ["rev-parse", "--verify", "-q", `origin/${b}`], { allowFail: true })).code === 0;
  if (!remoteHas) return { updated: false };
  const r = await git(dir, ["rebase", `origin/${b}`], { allowFail: true, ident: { name: "Rewrite Studio", email: "noreply@localhost" } });
  if (r.code !== 0) {
    await git(dir, ["rebase", "--abort"], { allowFail: true });
    throw new GitError("Remote has changes that conflict with local edits. Resolve them with git on the command line (the rebase was aborted, your local files are untouched).", r.stderr, 409);
  }
  const after = (await git(dir, ["rev-parse", "HEAD"])).stdout.trim();
  return { updated: before !== after };
}

export async function log(dir: string, n = 30): Promise<GitCommit[]> {
  if (!(await hasCommits(dir))) return [];
  const r = await git(dir, ["log", `-n${n}`, "--format=%H%x1f%h%x1f%an%x1f%aI%x1f%s"]);
  return r.stdout.split("\n").filter(Boolean).map((l) => {
    const [sha, short, author, date, subject] = l.split("\x1f");
    return { sha, short, author, date, subject };
  });
}

export async function showFile(dir: string, rev: string, rel: string): Promise<string> {
  if (!/^[0-9a-fA-F]{4,40}$|^HEAD(~\d+)?$/.test(rev)) throw new GitError("Invalid revision", "", 400);
  const r = await git(dir, ["show", `${rev}:${rel}`], { allowFail: true });
  if (r.code !== 0) throw new GitError(`File ${rel} does not exist at ${rev}`, r.stderr, 404);
  return r.stdout;
}

export async function clone(url: string, dir: string, token: string | null) {
  await fs.mkdir(path.dirname(dir), { recursive: true });
  await git(path.dirname(dir), ["clone", "-q", url, dir], { token, timeoutMs: 300_000 });
}
