import { describe, it, expect, beforeAll } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

// Point storage at a temp dir before the modules are imported.
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "rs-git-"));
process.env.DATA_DIR = path.join(tmp, "data");
const storage = await import("@/lib/storage");
const sync = await import("@/lib/git-sync");
const g = await import("@/lib/git");

const bare = path.join(tmp, "remote.git");

describe("git sync against a local bare remote", () => {
  let id: string;
  beforeAll(async () => {
    execFileSync("git", ["init", "-q", "--bare", "-b", "main", bare]);
    const meta = await storage.createProject("My Paper", { "main.tex": "\\documentclass{article}\\begin{document}Hi\\end{document}\n" });
    id = meta.id;
    await storage.writeBaseline(id, "main.tex", "baseline");
  });

  it("links a remote, makes the initial commit and syncs", async () => {
    const link = await sync.linkRemoteForProject(id, bare);
    expect(link.branch).toBe("main");
    const r = await sync.syncProject(id);
    expect(r.pushed).toBe(true);
    const st = await g.status(storage.projectRoot(id));
    expect(st.changes).toEqual([]);
    expect(st.upstream).toBe("origin/main");
    // project.json and .build are ignored, baseline + config are tracked
    const tracked = execFileSync("git", ["ls-files"], { cwd: storage.projectRoot(id) }).toString().split("\n").filter(Boolean).sort();
    expect(tracked).toEqual([".editor/baselines/main.tex", ".editor/config.json", ".gitignore", "main.tex"]);
  });

  it("hides .git from the file listing and the file API", async () => {
    const files = await storage.listFiles(id);
    expect(files.some((f) => f.path.startsWith(".git/"))).toBe(false);
    expect(files.map((f) => f.path)).toContain(".gitignore");
    expect(() => storage.safeRelPath(".git/config")).toThrow(/Reserved/);
    expect(() => storage.safeRelPath("sub/.git/HEAD")).toThrow(/Reserved/);
  });

  it("commits local edits with a default message and pushes", async () => {
    await storage.writeTextFile(id, "main.tex", "\\documentclass{article}\\begin{document}Hello\\end{document}\n");
    const r = await sync.syncProject(id);
    expect(r.committed).toMatch(/^[0-9a-f]{40}$/);
    expect(r.pushed).toBe(true);
    const log = await g.log(storage.projectRoot(id));
    expect(log[0].subject).toBe("Update main.tex");
    const remoteHead = execFileSync("git", ["rev-parse", "main"], { cwd: bare }).toString().trim();
    expect(remoteHead).toBe(log[0].sha);
  });

  it("pulls remote changes made elsewhere (rebase) and reports them", async () => {
    const other = path.join(tmp, "other");
    execFileSync("git", ["clone", "-q", bare, other]);
    await fs.writeFile(path.join(other, "refs.bib"), "@misc{x, title={y}}\n");
    execFileSync("git", ["-c", "user.name=o", "-c", "user.email=o@x", "add", "-A"], { cwd: other });
    execFileSync("git", ["-c", "user.name=o", "-c", "user.email=o@x", "commit", "-q", "-m", "add bib"], { cwd: other });
    execFileSync("git", ["push", "-q", "origin", "main"], { cwd: other });
    const r = await sync.syncProject(id);
    expect(r.pulled).toBe(true);
    expect(await storage.fileExists(id, "refs.bib")).toBe(true);
  });

  it("aborts cleanly on a conflicting remote change", async () => {
    const other = path.join(tmp, "other");
    await fs.writeFile(path.join(other, "main.tex"), "remote version\n");
    execFileSync("git", ["-c", "user.name=o", "-c", "user.email=o@x", "commit", "-q", "-am", "remote edit"], { cwd: other });
    execFileSync("git", ["push", "-q", "origin", "main"], { cwd: other });
    await storage.writeTextFile(id, "main.tex", "local version\n");
    await expect(sync.syncProject(id)).rejects.toThrow(/conflict/i);
    // local tree intact, no rebase in progress
    expect(await storage.readTextFile(id, "main.tex")).toBe("local version\n");
    expect(await fs.access(path.join(storage.projectRoot(id), ".git", "rebase-merge")).then(() => true).catch(() => false)).toBe(false);
    expect((await storage.getProject(id)).lastSyncError).toMatch(/conflict/i);
  });

  it("imports a repository as a new project and finds the main file", async () => {
    const meta = await sync.importFromRemote(bare, "Imported");
    expect(meta.github?.branch).toBe("main");
    expect(meta.mainFile).toBe("main.tex");
    expect(await storage.readBaseline(meta.id, "main.tex")).toBe("baseline");
    expect(await g.showFile(storage.projectRoot(meta.id), "HEAD", "refs.bib")).toContain("@misc");
  });
});

describe("slugifyRepoName", () => {
  it("produces valid GitHub names", async () => {
    const { slugifyRepoName } = await import("@/lib/github");
    expect(slugifyRepoName("My Paper: Draft (v2)!")).toBe("My-Paper-Draft-v2");
    expect(slugifyRepoName("   ")).toBe("paper");
    expect(slugifyRepoName("Études sur les modèles")).toBe("Etudes-sur-les-modeles");
  });
});
