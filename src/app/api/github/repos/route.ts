import { handle, json } from "@/lib/api";
import { listRepos } from "@/lib/github";
import { githubAuth } from "@/lib/git-sync";

export const GET = handle(async (req: Request) => {
  const q = (new URL(req.url).searchParams.get("q") ?? "").toLowerCase();
  const { token } = await githubAuth();
  const repos = await listRepos(token);
  const out = repos.filter((r) => !q || r.full_name.toLowerCase().includes(q)).map((r) => ({ fullName: r.full_name, name: r.name, private: r.private, htmlUrl: r.html_url, cloneUrl: r.clone_url, defaultBranch: r.default_branch, pushedAt: r.pushed_at, description: r.description }));
  return json({ repos: out });
});
