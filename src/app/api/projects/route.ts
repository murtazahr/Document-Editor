import { handle, json } from "@/lib/api";
import { createProject, getProject, listProjects, readSettings, writeBaseline } from "@/lib/storage";
import { createGithubRepoForProject } from "@/lib/git-sync";

export const maxDuration = 300;
import { BLANK_MAIN, SAMPLE_FILES } from "@/lib/sample";

export const GET = handle(async () => json(await listProjects()));

export const POST = handle(async (req: Request) => {
  const body = (await req.json().catch(() => ({}))) as { name?: string; template?: "blank" | "sample"; files?: Record<string, string>; mainFile?: string; setBaseline?: boolean; github?: boolean; private?: boolean };
  const files = body.files ?? (body.template === "sample" ? SAMPLE_FILES : { "main.tex": BLANK_MAIN });
  const meta = await createProject(body.name ?? (body.template === "sample" ? "Sample paper" : "Untitled project"), files, body.mainFile ?? "main.tex");
  if (body.setBaseline ?? body.template === "sample") {
    for (const [rel, content] of Object.entries(files)) if (rel.endsWith(".tex")) await writeBaseline(meta.id, rel, content);
  }
  // Optionally (default when connected and enabled in settings) create a GitHub repo and push.
  const settings = await readSettings();
  const wantRepo = body.github ?? (!!settings.githubToken && (settings.githubAutoCreate ?? true));
  let githubError: string | undefined;
  if (wantRepo && settings.githubToken) {
    try { await createGithubRepoForProject(meta.id, { private: body.private }); } catch (e) { githubError = e instanceof Error ? e.message : String(e); }
  }
  return json({ ...(await getProject(meta.id)), githubError }, 201);
});
