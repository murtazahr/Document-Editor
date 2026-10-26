import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

/**
 * Filesystem-backed storage. Layout (under DATA_DIR, default ./data):
 *
 *   projects/<id>/project.json        project metadata
 *   projects/<id>/<files...>          the LaTeX sources, bib files, images
 *   projects/<id>/.editor/baselines/<file>   the "original" text a file is diffed against
 *   projects/<id>/.editor/pangram/<file>.json  last AI-detection result for a file
 *   projects/<id>/.build/             compiler output (pdf, log)
 *   settings.json                     app settings (Pangram key, model)
 */

export const DATA_DIR = path.resolve(/*turbopackIgnore: true*/ process.env.DATA_DIR ?? path.join(process.cwd(), "data"));
const PROJECTS_DIR = path.join(DATA_DIR, "projects");
const EDITOR_DIR = ".editor";
export const BUILD_DIR = ".build";

export type GitHubLink = {
  owner: string;
  repo: string;
  htmlUrl: string;
  branch: string;
};

export type ProjectMeta = {
  id: string;
  name: string;
  mainFile: string;
  createdAt: string;
  updatedAt: string;
  /** set once the project folder is a git repo with a GitHub remote */
  github?: GitHubLink;
  /** commit + push automatically a little while after edits (default: settings.githubAutoSync) */
  autoSync?: boolean;
  lastSyncAt?: string;
  lastSyncError?: string;
};

export type FileEntry = {
  path: string;
  size: number;
  binary: boolean;
  hasBaseline: boolean;
};

export type Settings = {
  pangramApiKey?: string;
  pangramModel?: string;
  latexEngine?: "auto" | "latexmk" | "tectonic" | "pdflatex";
  /** GitHub OAuth token or personal access token */
  githubToken?: string;
  githubLogin?: string;
  githubUserId?: number;
  githubAvatarUrl?: string;
  /** create a GitHub repo automatically for every new project (default true once connected) */
  githubAutoCreate?: boolean;
  /** create repos as private (default true) */
  githubPrivate?: boolean;
  /** default for new projects: auto commit+push after edits (default true) */
  githubAutoSync?: boolean;
};

const TEXT_EXT = new Set([".tex", ".bib", ".cls", ".sty", ".bst", ".txt", ".md", ".bbl", ".aux", ".cfg", ".def", ".clo", ".csv", ".json"]);

export function isTextFile(p: string) {
  return TEXT_EXT.has(path.extname(p).toLowerCase());
}

export class StorageError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

async function ensureDir(p: string) {
  await fs.mkdir(p, { recursive: true });
}

export function newId() {
  return crypto.randomBytes(6).toString("base64url");
}

/** Reject path traversal and reserved directories. Returns a normalized relative path. */
export function safeRelPath(rel: string): string {
  const norm = path.posix.normalize(rel.replace(/\\/g, "/")).replace(/^\/+/, "");
  if (!norm || norm === "." || norm.startsWith("../") || norm.includes("/../") || norm === "..") {
    throw new StorageError("Invalid path", 400);
  }
  const first = norm.split("/")[0];
  if (first === EDITOR_DIR || first === BUILD_DIR || norm === "project.json") {
    throw new StorageError("Reserved path", 400);
  }
  return norm;
}

function projectDir(id: string) {
  if (!/^[A-Za-z0-9_-]{4,32}$/.test(id)) throw new StorageError("Invalid project id", 400);
  return path.join(PROJECTS_DIR, id);
}

async function readJson<T>(p: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(p, "utf8")) as T;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

async function writeJson(p: string, v: unknown) {
  await ensureDir(path.dirname(p));
  await fs.writeFile(p, JSON.stringify(v, null, 2));
}

// ---------- projects ----------

export async function listProjects(): Promise<ProjectMeta[]> {
  await ensureDir(PROJECTS_DIR);
  const ids = await fs.readdir(PROJECTS_DIR);
  const metas: ProjectMeta[] = [];
  for (const id of ids) {
    const m = await readJson<ProjectMeta>(path.join(PROJECTS_DIR, id, "project.json"));
    if (m) metas.push(m);
  }
  return metas.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getProject(id: string): Promise<ProjectMeta> {
  const m = await readJson<ProjectMeta>(path.join(projectDir(id), "project.json"));
  if (!m) throw new StorageError("Project not found", 404);
  return m;
}

export async function createProject(name: string, files: Record<string, string>, mainFile = "main.tex"): Promise<ProjectMeta> {
  const id = newId();
  const dir = projectDir(id);
  await ensureDir(dir);
  const now = new Date().toISOString();
  const meta: ProjectMeta = { id, name: name.trim() || "Untitled project", mainFile, createdAt: now, updatedAt: now };
  await writeJson(path.join(dir, "project.json"), meta);
  await writeTrackedConfig(id, meta);
  for (const [rel, content] of Object.entries(files)) {
    await writeTextFile(id, rel, content, { touch: false });
  }
  return meta;
}

/** Register an already-populated directory (e.g. a fresh clone) as a project. */
export async function adoptProjectDir(id: string, name: string, mainFile: string, extra: Partial<ProjectMeta> = {}): Promise<ProjectMeta> {
  const now = new Date().toISOString();
  const meta: ProjectMeta = { id, name, mainFile, createdAt: now, updatedAt: now, ...extra };
  await writeJson(path.join(projectDir(id), "project.json"), meta);
  await writeTrackedConfig(id, meta);
  return meta;
}

export function newProjectDir(): { id: string; dir: string } {
  const id = newId();
  return { id, dir: projectDir(id) };
}

export async function updateProject(id: string, patch: Partial<Omit<ProjectMeta, "id" | "createdAt">>): Promise<ProjectMeta> {
  const meta = await getProject(id);
  if (patch.name !== undefined) meta.name = patch.name.trim() || meta.name;
  if (patch.mainFile !== undefined) meta.mainFile = safeRelPath(patch.mainFile);
  if ("github" in patch) { if (patch.github) meta.github = patch.github; else delete meta.github; }
  if (patch.autoSync !== undefined) meta.autoSync = patch.autoSync;
  if ("lastSyncAt" in patch) meta.lastSyncAt = patch.lastSyncAt;
  if ("lastSyncError" in patch) { if (patch.lastSyncError) meta.lastSyncError = patch.lastSyncError; else delete meta.lastSyncError; }
  meta.updatedAt = patch.updatedAt ?? new Date().toISOString();
  await writeJson(path.join(projectDir(id), "project.json"), meta);
  await writeTrackedConfig(id, meta);
  return meta;
}

/** Small tracked file so a clone on another machine knows the main file (project.json itself is local-only). */
export async function writeTrackedConfig(id: string, meta: ProjectMeta) {
  await writeJson(path.join(projectDir(id), EDITOR_DIR, "config.json"), { mainFile: meta.mainFile, name: meta.name });
}

export async function readTrackedConfig(dir: string): Promise<{ mainFile?: string; name?: string } | null> {
  return readJson(path.join(dir, EDITOR_DIR, "config.json"));
}

export async function deleteProject(id: string) {
  await getProject(id);
  await fs.rm(projectDir(id), { recursive: true, force: true });
}

async function touch(id: string) {
  const meta = await getProject(id);
  meta.updatedAt = new Date().toISOString();
  await writeJson(path.join(projectDir(id), "project.json"), meta);
}

// ---------- files ----------

export async function listFiles(id: string): Promise<FileEntry[]> {
  const dir = projectDir(id);
  await getProject(id);
  const out: FileEntry[] = [];
  async function walk(rel: string) {
    const entries = await fs.readdir(path.join(dir, rel), { withFileTypes: true });
    for (const e of entries) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (!rel && (e.name === EDITOR_DIR || e.name === BUILD_DIR || e.name === "project.json")) continue;
      if (e.isDirectory()) await walk(r);
      else {
        const st = await fs.stat(path.join(dir, r));
        out.push({ path: r, size: st.size, binary: !isTextFile(r), hasBaseline: await hasBaseline(id, r) });
      }
    }
  }
  await walk("");
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

export function absFilePath(id: string, rel: string) {
  return path.join(projectDir(id), safeRelPath(rel));
}

export async function readTextFile(id: string, rel: string): Promise<string> {
  try {
    return await fs.readFile(absFilePath(id, rel), "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") throw new StorageError("File not found", 404);
    throw e;
  }
}

export async function readBinaryFile(id: string, rel: string): Promise<Buffer> {
  try {
    return await fs.readFile(absFilePath(id, rel));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") throw new StorageError("File not found", 404);
    throw e;
  }
}

export async function writeTextFile(id: string, rel: string, content: string, opts: { touch?: boolean } = {}) {
  const p = absFilePath(id, rel);
  await ensureDir(path.dirname(p));
  await fs.writeFile(p, content, "utf8");
  if (opts.touch !== false) await touch(id);
}

export async function writeBinaryFile(id: string, rel: string, data: Buffer) {
  const p = absFilePath(id, rel);
  await ensureDir(path.dirname(p));
  await fs.writeFile(p, data);
  await touch(id);
}

export async function fileExists(id: string, rel: string) {
  try {
    await fs.access(absFilePath(id, rel));
    return true;
  } catch {
    return false;
  }
}

export async function deleteFile(id: string, rel: string) {
  const p = absFilePath(id, rel);
  await fs.rm(p, { force: true });
  await fs.rm(baselinePath(id, rel), { force: true });
  await fs.rm(pangramPath(id, rel), { force: true });
  await touch(id);
}

export async function renameFile(id: string, from: string, to: string) {
  const a = absFilePath(id, from);
  const b = absFilePath(id, to);
  await ensureDir(path.dirname(b));
  await fs.rename(a, b);
  try {
    await ensureDir(path.dirname(baselinePath(id, to)));
    await fs.rename(baselinePath(id, from), baselinePath(id, to));
  } catch { /* no baseline */ }
  try {
    await ensureDir(path.dirname(pangramPath(id, to)));
    await fs.rename(pangramPath(id, from), pangramPath(id, to));
  } catch { /* no result */ }
  const meta = await getProject(id);
  if (meta.mainFile === from) await updateProject(id, { mainFile: to });
  else await touch(id);
}

// ---------- baselines ----------

function baselinePath(id: string, rel: string) {
  return path.join(projectDir(id), EDITOR_DIR, "baselines", safeRelPath(rel));
}

export async function hasBaseline(id: string, rel: string) {
  try {
    await fs.access(baselinePath(id, rel));
    return true;
  } catch {
    return false;
  }
}

export async function readBaseline(id: string, rel: string): Promise<string | null> {
  try {
    return await fs.readFile(baselinePath(id, rel), "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

export async function writeBaseline(id: string, rel: string, content: string) {
  const p = baselinePath(id, rel);
  await ensureDir(path.dirname(p));
  await fs.writeFile(p, content, "utf8");
}

export async function deleteBaseline(id: string, rel: string) {
  await fs.rm(baselinePath(id, rel), { force: true });
}

// ---------- pangram result cache ----------

function pangramPath(id: string, rel: string) {
  return path.join(projectDir(id), EDITOR_DIR, "pangram", safeRelPath(rel) + ".json");
}

export async function readPangramResult<T>(id: string, rel: string): Promise<T | null> {
  return readJson<T>(pangramPath(id, rel));
}

export async function writePangramResult(id: string, rel: string, v: unknown) {
  await writeJson(pangramPath(id, rel), v);
}

// ---------- build dir ----------

export function buildDir(id: string) {
  return path.join(projectDir(id), BUILD_DIR);
}

export function projectRoot(id: string) {
  return projectDir(id);
}

// ---------- settings ----------

const SETTINGS_PATH = path.join(DATA_DIR, "settings.json");

export async function readSettings(): Promise<Settings> {
  return (await readJson<Settings>(SETTINGS_PATH)) ?? {};
}

export async function writeSettings(patch: Settings) {
  const cur = await readSettings();
  const next: Settings = { ...cur, ...patch };
  for (const k of Object.keys(next) as (keyof Settings)[]) {
    if (next[k] === undefined || next[k] === "") delete next[k];
  }
  await writeJson(SETTINGS_PATH, next);
  return next;
}

/** Pangram key: environment variable wins over the settings file. */
export async function resolvePangramKey(): Promise<{ key: string | null; source: "env" | "settings" | "none" }> {
  if (process.env.PANGRAM_API_KEY) return { key: process.env.PANGRAM_API_KEY, source: "env" };
  const s = await readSettings();
  if (s.pangramApiKey) return { key: s.pangramApiKey, source: "settings" };
  return { key: null, source: "none" };
}

export function sha1(s: string) {
  return crypto.createHash("sha1").update(s).digest("hex");
}
