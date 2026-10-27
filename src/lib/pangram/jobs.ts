import { countWords, latexToProse } from "@/lib/latex-prose";
import { billableUnits, BULK_MAX_UNITS, getAllBulkResults, getBulkStatus, mockDetect, submitBulk } from "./client";
import { mergeIncremental, planIncremental, type IncrementalPlan } from "./incremental";
import type { DetectionJob, StoredDetection } from "./types";
import { getProject, listDetectionJobs, listFiles, readDetectionJob, readPangramResult, readTextFile, resolvePangramKey, safeRelPath, sha1, writeDetectionJob, writePangramResult, StorageError } from "@/lib/storage";

/** Server-side orchestration of Pangram bulk jobs for a project. */

export type JobInput = {
  file: string;
  /** text to send */
  text: string;
  /** set for incremental runs: full prose + plan (reused windows) */
  plan?: { fullText: string; plan: IncrementalPlan };
};

/**
 * Decide what to send for one file: everything, or (when a compatible previous
 * result exists and `incremental` is on) only the changed paragraphs.
 * Returns null when nothing changed and the previous result can be kept as is.
 */
export async function prepareInput(projectId: string, file: string, fullText: string, incremental: boolean, mock: boolean): Promise<JobInput | { unchanged: StoredDetection }> {
  const rel = safeRelPath(file);
  if (incremental) {
    const prev = await readPangramResult<StoredDetection>(projectId, rel);
    if (prev && prev.mock === mock && prev.result.windows?.length && prev.sentText) {
      const plan = planIncremental(prev.sentText, prev.result.windows, fullText);
      if (plan.wordsToSend === 0) {
        const merged = mergeIncremental(plan, fullText, null);
        const stored: StoredDetection = { createdAt: new Date().toISOString(), model: prev.model, mock, textHash: sha1(fullText), sentText: fullText, wordCount: countWords(fullText), result: merged, mode: prev.mode, incremental: merged.incremental };
        await writePangramResult(projectId, rel, stored);
        return { unchanged: stored };
      }
      return { file: rel, text: plan.changedText, plan: { fullText, plan } };
    }
  }
  return { file: rel, text: fullText };
}

/** Build inputs for every .tex file in the project by stripping LaTeX server-side. */
export async function inputsForAllFiles(projectId: string, incremental: boolean): Promise<{ inputs: JobInput[]; unchanged: string[] }> {
  const files = await listFiles(projectId);
  const mock = process.env.PANGRAM_MOCK === "1";
  const inputs: JobInput[] = [];
  const unchanged: string[] = [];
  for (const f of files) {
    if (!f.path.endsWith(".tex")) continue;
    const text = latexToProse(await readTextFile(projectId, f.path)).text.trim();
    if (countWords(text) < 5) continue;
    const r = await prepareInput(projectId, f.path, text, incremental, mock);
    if ("unchanged" in r) unchanged.push(f.path); else inputs.push(r);
  }
  return { inputs, unchanged };
}

export async function submitDetectionJob(projectId: string, inputs: JobInput[], model: string): Promise<DetectionJob> {
  await getProject(projectId);
  if (!inputs.length) throw new StorageError("Nothing to analyse: no file with at least a few sentences of prose.", 400);
  const items = inputs.map((inp, i) => ({ id: `f${i}`, file: safeRelPath(inp.file), text: inp.text.trim(), plan: inp.plan }));
  const units = items.reduce((n, it) => n + billableUnits(countWords(it.text)), 0);
  if (units > BULK_MAX_UNITS) throw new StorageError(`This would be ${units} billable units; Pangram allows ${BULK_MAX_UNITS} per bulk request. Analyse fewer files at once.`, 413);
  const mock = process.env.PANGRAM_MOCK === "1";
  const now = new Date().toISOString();
  let bulkId: string;
  let status: DetectionJob["status"];
  if (mock) {
    bulkId = `mock-${Date.now().toString(36)}`;
    status = "queued";
  } else {
    const { key } = await resolvePangramKey();
    if (!key) throw new StorageError("No Pangram API key configured. Add one in Settings or set PANGRAM_API_KEY.", 400);
    const res = await submitBulk(key, items.map((it) => ({ id: it.id, text: it.text })), model);
    bulkId = res.bulk_id;
    status = res.status;
    for (const f of res.failed_items ?? []) {
      const it = items.find((x) => x.id === f.id);
      if (it) Object.assign(it, { outcome: "error", error: f.error });
    }
  }
  const job: DetectionJob = {
    bulkId, createdAt: now, model, mock, status, done: false,
    items: items.map((it) => ({
      id: it.id, file: it.file, textHash: sha1(it.text), sentText: it.text, wordCount: countWords(it.text),
      ...("outcome" in it ? { outcome: "error" as const, error: (it as { error?: string }).error } : {}),
      ...(it.plan ? { incremental: { fullText: it.plan.fullText, reusedWindows: it.plan.plan.reusedWindows, changedParagraphs: it.plan.plan.changedParagraphs, reusedParagraphs: it.plan.plan.reusedParagraphs, totalParagraphs: it.plan.plan.totalParagraphs, wordsTotal: it.plan.plan.wordsTotal, wordsReused: it.plan.plan.wordsReused } } : {}),
    })),
  };
  await writeDetectionJob(projectId, bulkId, job);
  return job;
}

/** Poll Pangram once; when the job is terminal, fetch results and store one detection per file. */
export async function refreshDetectionJob(projectId: string, bulkId: string): Promise<DetectionJob> {
  const job = await readDetectionJob<DetectionJob>(projectId, bulkId);
  if (!job) throw new StorageError("Job not found", 404);
  if (job.done) return job;

  if (job.mock) {
    for (const it of job.items) {
      const result = mockDetect(it.sentText);
      await storeResult(projectId, job, it, result);
      it.outcome = "ok";
    }
    job.status = "succeeded";
    job.counters = { total: job.items.length, succeeded: job.items.length, failed: 0 };
    return finish(projectId, job);
  }

  const { key } = await resolvePangramKey();
  if (!key) throw new StorageError("No Pangram API key configured.", 400);
  const st = await getBulkStatus(key, bulkId);
  job.status = st.status;
  job.counters = { total: st.total_items, succeeded: st.succeeded, failed: st.failed };
  if (!["succeeded", "failed", "partial"].includes(st.status)) {
    await writeDetectionJob(projectId, bulkId, job);
    return job;
  }
  const { items, failed } = await getAllBulkResults(key, bulkId);
  for (const r of items) {
    const it = job.items.find((x) => x.id === r.id);
    if (!it) continue;
    if (r.result && r.result.stage === "STAGE_SUCCESS") { await storeResult(projectId, job, it, r.result); it.outcome = "ok"; }
    else { it.outcome = "error"; it.error = r.error ?? "No result returned"; }
  }
  for (const f of failed) {
    const it = job.items.find((x) => x.id === f.id);
    if (it) { it.outcome = "error"; it.error = f.error ?? "Item failed"; }
  }
  for (const it of job.items) if (!it.outcome) { it.outcome = "error"; it.error = "No result for this item"; }
  return finish(projectId, job);
}

async function storeResult(projectId: string, job: DetectionJob, it: DetectionJob["items"][number], result: StoredDetection["result"]) {
  if (it.incremental) {
    const inc = it.incremental;
    const plan: IncrementalPlan = { reusedWindows: inc.reusedWindows, changedText: it.sentText, changedParagraphs: inc.changedParagraphs, reusedParagraphs: inc.reusedParagraphs, totalParagraphs: inc.totalParagraphs, wordsToSend: it.wordCount, wordsTotal: inc.wordsTotal, wordsReused: inc.wordsReused };
    const merged = mergeIncremental(plan, inc.fullText, result);
    const stored: StoredDetection = { createdAt: new Date().toISOString(), model: job.model, mock: job.mock, textHash: sha1(inc.fullText), sentText: inc.fullText, wordCount: countWords(inc.fullText), result: merged, mode: "bulk", bulkId: job.bulkId, incremental: merged.incremental };
    await writePangramResult(projectId, it.file, stored);
    return;
  }
  const stored: StoredDetection = { createdAt: new Date().toISOString(), model: job.model, mock: job.mock, textHash: it.textHash, sentText: it.sentText, wordCount: it.wordCount, result, mode: "bulk", bulkId: job.bulkId };
  await writePangramResult(projectId, it.file, stored);
}

async function finish(projectId: string, job: DetectionJob): Promise<DetectionJob> {
  job.done = true;
  job.completedAt = new Date().toISOString();
  // keep the record small once results are stored per file
  for (const it of job.items) { it.sentText = ""; if (it.incremental) it.incremental = { ...it.incremental, fullText: "", reusedWindows: [] }; }
  await writeDetectionJob(projectId, job.bulkId, job);
  return job;
}

export async function pendingDetectionJobs(projectId: string): Promise<DetectionJob[]> {
  const jobs = await listDetectionJobs<DetectionJob>(projectId);
  const cutoff = Date.now() - 48 * 3600 * 1000; // Pangram keeps bulk results for 48 h
  return jobs.filter((j) => !j.done && new Date(j.createdAt).getTime() > cutoff).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function recentDetectionJobs(projectId: string, n = 10): Promise<DetectionJob[]> {
  const jobs = await listDetectionJobs<DetectionJob>(projectId);
  return jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, n);
}
