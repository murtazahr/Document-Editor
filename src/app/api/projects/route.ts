import { handle, json } from "@/lib/api";
import { createProject, listProjects, writeBaseline } from "@/lib/storage";
import { BLANK_MAIN, SAMPLE_FILES } from "@/lib/sample";

export const GET = handle(async () => json(await listProjects()));

export const POST = handle(async (req: Request) => {
  const body = (await req.json().catch(() => ({}))) as { name?: string; template?: "blank" | "sample"; files?: Record<string, string>; mainFile?: string; setBaseline?: boolean };
  const files = body.files ?? (body.template === "sample" ? SAMPLE_FILES : { "main.tex": BLANK_MAIN });
  const meta = await createProject(body.name ?? (body.template === "sample" ? "Sample paper" : "Untitled project"), files, body.mainFile ?? "main.tex");
  if (body.setBaseline ?? body.template === "sample") {
    for (const [rel, content] of Object.entries(files)) if (rel.endsWith(".tex")) await writeBaseline(meta.id, rel, content);
  }
  return json(meta, 201);
});
