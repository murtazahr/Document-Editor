/** Minimal GitHub REST + OAuth helpers (server-side only). */

export const GITHUB_API = "https://api.github.com";

export class GitHubError extends Error {
  constructor(message: string, public status = 502) {
    super(message);
  }
}

export type GitHubUser = { id: number; login: string; avatar_url: string; name: string | null; email: string | null };
export type GitHubRepo = { id: number; name: string; full_name: string; private: boolean; html_url: string; clone_url: string; default_branch: string; pushed_at: string; description: string | null; owner: { login: string } };

export async function gh<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(GITHUB_API + path, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "rewrite-studio", ...(init.body ? { "Content-Type": "application/json" } : {}), ...(init.headers ?? {}) },
    cache: "no-store",
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data as { message?: string; errors?: { message?: string }[] }).message ?? res.statusText;
    const detail = (data as { errors?: { message?: string }[] }).errors?.map((e) => e.message).filter(Boolean).join("; ");
    throw new GitHubError(`GitHub ${res.status}: ${msg}${detail ? ` (${detail})` : ""}`, res.status);
  }
  return data as T;
}

export const getUser = (token: string) => gh<GitHubUser>(token, "/user");

export async function listRepos(token: string): Promise<GitHubRepo[]> {
  return gh<GitHubRepo[]>(token, "/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator");
}

export async function createRepo(token: string, opts: { name: string; private: boolean; description?: string }): Promise<GitHubRepo> {
  return gh<GitHubRepo>(token, "/user/repos", { method: "POST", body: JSON.stringify({ name: opts.name, private: opts.private, description: opts.description ?? "", auto_init: false }) });
}

export async function repoExists(token: string, owner: string, name: string): Promise<boolean> {
  try { await gh(token, `/repos/${owner}/${name}`); return true; } catch (e) { if (e instanceof GitHubError && e.status === 404) return false; throw e; }
}

/** GitHub repo names: letters, digits, '-', '_', '.' ; max 100 chars. */
export function slugifyRepoName(name: string): string {
  const s = name.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "").slice(0, 90);
  return s || "paper";
}

export function noreplyEmail(user: GitHubUser): string {
  return user.email ?? `${user.id}+${user.login}@users.noreply.github.com`;
}

// ---------- OAuth web flow ----------

export function oauthConfigured() {
  return !!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET);
}

export function authorizeUrl(redirectUri: string, state: string) {
  const u = new URL("https://github.com/login/oauth/authorize");
  u.searchParams.set("client_id", process.env.GITHUB_CLIENT_ID!);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("scope", "repo");
  u.searchParams.set("state", state);
  return u.toString();
}

export async function exchangeCode(code: string, redirectUri: string): Promise<string> {
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: process.env.GITHUB_CLIENT_ID, client_secret: process.env.GITHUB_CLIENT_SECRET, code, redirect_uri: redirectUri }),
  });
  const j = (await res.json().catch(() => ({}))) as { access_token?: string; error?: string; error_description?: string };
  if (!res.ok || !j.access_token) throw new GitHubError(`OAuth exchange failed: ${j.error_description ?? j.error ?? res.statusText}`, 502);
  return j.access_token;
}
