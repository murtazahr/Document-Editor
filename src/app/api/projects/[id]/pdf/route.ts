import { promises as fs } from "node:fs";
import path from "node:path";
import { handle, json, type Params } from "@/lib/api";
import { buildDir, getProject } from "@/lib/storage";

export const GET = handle(async (_req: Request, { params }: Params<"id">) => {
  const { id } = await params;
  await getProject(id);
  const p = path.join(buildDir(id), "output.pdf");
  try {
    const buf = await fs.readFile(p);
    return new Response(new Uint8Array(buf), { headers: { "Content-Type": "application/pdf", "Cache-Control": "no-store", "Content-Disposition": "inline; filename=output.pdf" } });
  } catch {
    return json({ error: "No PDF yet. Compile first." }, 404);
  }
});
