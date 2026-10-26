import { handle, json } from "@/lib/api";

type Ctx = { params: Promise<{ id: string; path: string[] }> };
import { deleteFile, isTextFile, readBaseline, readBinaryFile, readTextFile, renameFile, safeRelPath, writeTextFile } from "@/lib/storage";

const MIME: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".svg": "image/svg+xml", ".pdf": "application/pdf", ".eps": "application/postscript" };

function relOf(path: string[]) {
  return safeRelPath(path.map(decodeURIComponent).join("/"));
}

export const GET = handle(async (req: Request, { params }: Ctx) => {
  const p = await params;
  const rel = relOf(p.path);
  const url = new URL(req.url);
  if (url.searchParams.get("raw") || !isTextFile(rel)) {
    const buf = await readBinaryFile(p.id, rel);
    const ext = rel.slice(rel.lastIndexOf(".")).toLowerCase();
    return new Response(new Uint8Array(buf), { headers: { "Content-Type": MIME[ext] ?? "application/octet-stream" } });
  }
  const content = await readTextFile(p.id, rel);
  const baseline = await readBaseline(p.id, rel);
  return json({ path: rel, content, baseline });
});

export const PUT = handle(async (req: Request, { params }: Ctx) => {
  const p = await params;
  const rel = relOf(p.path);
  const body = (await req.json()) as { content: string };
  await writeTextFile(p.id, rel, body.content ?? "");
  return json({ ok: true, savedAt: new Date().toISOString() });
});

export const PATCH = handle(async (req: Request, { params }: Ctx) => {
  const p = await params;
  const rel = relOf(p.path);
  const body = (await req.json()) as { to: string };
  const to = safeRelPath(body.to);
  await renameFile(p.id, rel, to);
  return json({ ok: true, path: to });
});

export const DELETE = handle(async (_req: Request, { params }: Ctx) => {
  const p = await params;
  const rel = relOf(p.path);
  await deleteFile(p.id, rel);
  return json({ ok: true });
});
