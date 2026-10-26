import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { buildDir, projectRoot, readSettings } from "./storage";

export type Engine = "latexmk" | "tectonic" | "pdflatex";

export type Diagnostic = { file?: string; line?: number; message: string; severity: "error" | "warning" };

export type CompileResult = {
  ok: boolean;
  engine: Engine | null;
  durationMs: number;
  log: string;
  errors: Diagnostic[];
  warnings: Diagnostic[];
  pdf: boolean;
  message?: string;
};

function run(cmd: string, args: string[], cwd: string, timeoutMs: number): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    const child = execFile(cmd, args, { cwd, timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, max_print_line: "10000" } }, (err, stdout, stderr) => {
      const e = err as (NodeJS.ErrnoException & { killed?: boolean; code?: number | string }) | null;
      resolve({ code: e ? (typeof e.code === "number" ? e.code : e.code === "ENOENT" ? -1 : 1) : 0, stdout: String(stdout), stderr: String(stderr), timedOut: !!e?.killed });
    });
    child.on("error", () => { /* handled via callback */ });
  });
}

const available = new Map<Engine, boolean>();

export async function detectEngines(): Promise<Record<Engine, boolean>> {
  const engines: Engine[] = ["latexmk", "tectonic", "pdflatex"];
  for (const e of engines) {
    if (!available.has(e)) {
      const r = await run(e, ["--version"], process.cwd(), 10_000);
      available.set(e, r.code === 0);
    }
  }
  return { latexmk: !!available.get("latexmk"), tectonic: !!available.get("tectonic"), pdflatex: !!available.get("pdflatex") };
}

export async function pickEngine(): Promise<Engine | null> {
  const settings = await readSettings();
  const pref = (process.env.LATEX_ENGINE as Engine | "auto" | undefined) ?? settings.latexEngine ?? "auto";
  const found = await detectEngines();
  if (pref !== "auto" && pref) return found[pref] ? pref : null;
  for (const e of ["latexmk", "tectonic", "pdflatex"] as Engine[]) if (found[e]) return e;
  return null;
}

/** Parse LaTeX log / tectonic output into diagnostics. */
export function parseLog(log: string): { errors: Diagnostic[]; warnings: Diagnostic[] } {
  const errors: Diagnostic[] = [];
  const warnings: Diagnostic[] = [];
  const lines = log.split(/\r?\n/);
  const seen = new Set<string>();
  const add = (d: Diagnostic) => {
    const k = `${d.severity}|${d.file ?? ""}|${d.line ?? ""}|${d.message}`;
    if (seen.has(k)) return;
    seen.add(k);
    (d.severity === "error" ? errors : warnings).push(d);
  };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    let m: RegExpMatchArray | null;
    // -file-line-error style:  ./main.tex:12: Undefined control sequence.
    if ((m = l.match(/^(?:error: )?(\.\/)?([^\s:]+\.(?:tex|sty|cls|bib|bbl)):(\d+): (.+)$/))) {
      add({ file: m[2], line: Number(m[3]), message: m[4].trim(), severity: "error" });
      continue;
    }
    // classic "! Undefined control sequence." followed by "l.12 ..."
    if ((m = l.match(/^! (.+)$/))) {
      let line: number | undefined;
      for (let j = i + 1; j < Math.min(lines.length, i + 8); j++) {
        const lm = lines[j].match(/^l\.(\d+)/);
        if (lm) { line = Number(lm[1]); break; }
      }
      add({ line, message: m[1].trim(), severity: "error" });
      continue;
    }
    if ((m = l.match(/^(?:warning: )?(?:LaTeX|Package \w+|Class \w+) Warning: (.+)$/))) {
      let msg = m[1].trim();
      // continuation lines
      let j = i + 1;
      while (j < lines.length && lines[j].startsWith("(") === false && /^\s*\(?[A-Za-z]/.test(lines[j]) && !/Warning|^!|^\\|^l\./.test(lines[j]) && lines[j].trim() && msg.length < 400 && !lines[j].match(/^\s*$/) && lines[j].length > 60) {
        msg += " " + lines[j].trim();
        j++;
      }
      const lm = msg.match(/on input line (\d+)/);
      add({ line: lm ? Number(lm[1]) : undefined, message: msg, severity: "warning" });
      continue;
    }
    if ((m = l.match(/^(Overfull|Underfull) \\[hv]box .* at lines? (\d+)/))) {
      add({ line: Number(m[2]), message: l.trim(), severity: "warning" });
      continue;
    }
    if ((m = l.match(/^(?:warning|error): (.+)$/)) && !/^(warning: )/.test(l)) {
      add({ message: m[1].trim(), severity: "error" });
    }
  }
  return { errors, warnings };
}

export async function compileProject(id: string, mainFile: string): Promise<CompileResult> {
  const t0 = Date.now();
  const engine = await pickEngine();
  const cwd = projectRoot(id);
  const out = buildDir(id);
  await fs.mkdir(out, { recursive: true });
  const pdfName = path.basename(mainFile).replace(/\.tex$/i, "") + ".pdf";
  const pdfPath = path.join(out, pdfName);
  await fs.rm(pdfPath, { force: true });

  if (!engine) {
    return {
      ok: false, engine: null, durationMs: Date.now() - t0, log: "", errors: [], warnings: [], pdf: false,
      message: "No LaTeX engine found on PATH. Install TeX Live (latexmk) or Tectonic, or run the provided Docker image. See README.",
    };
  }
  const timeout = Number(process.env.LATEX_TIMEOUT_MS ?? 180_000);
  let log = "";
  let res: Awaited<ReturnType<typeof run>>;
  if (engine === "latexmk") {
    res = await run("latexmk", ["-pdf", "-interaction=nonstopmode", "-halt-on-error", "-file-line-error", "-synctex=0", `-outdir=${out}`, mainFile], cwd, timeout);
    log = res.stdout + "\n" + res.stderr;
    try { log = await fs.readFile(path.join(out, path.basename(mainFile).replace(/\.tex$/i, "") + ".log"), "utf8"); } catch { /* keep stdout */ }
  } else if (engine === "tectonic") {
    res = await run("tectonic", ["-X", "compile", "--outdir", out, "--keep-logs", "--synctex=false", mainFile], cwd, timeout);
    log = res.stdout + "\n" + res.stderr;
  } else {
    const args = ["-interaction=nonstopmode", "-halt-on-error", "-file-line-error", `-output-directory=${out}`, mainFile];
    res = await run("pdflatex", args, cwd, timeout);
    if (res.code === 0) res = await run("pdflatex", args, cwd, timeout);
    log = res.stdout + "\n" + res.stderr;
  }
  const pdfExists = await fs.stat(pdfPath).then(() => true).catch(() => false);
  await fs.writeFile(path.join(out, "last.log"), log).catch(() => {});
  if (pdfExists) await fs.copyFile(pdfPath, path.join(out, "output.pdf"));
  const { errors, warnings } = parseLog(log);
  const ok = res.code === 0 && pdfExists;
  return {
    ok, engine, durationMs: Date.now() - t0, log: log.slice(-200_000), errors, warnings, pdf: pdfExists,
    message: res.timedOut ? `Compilation timed out after ${Math.round(timeout / 1000)}s` : !ok && errors.length === 0 ? `${engine} exited with code ${res.code}` : undefined,
  };
}
