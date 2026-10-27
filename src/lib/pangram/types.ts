/** Shapes from https://docs.pangram.com/api-reference/ai-detection (Pangram 4 async task API). */

export type PangramWindow = {
  text: string;
  label: "AI-Generated" | "AI-Assisted" | "Human Written" | string;
  ai_assistance_score: number;
  confidence: "High" | "Medium" | "Low" | string;
  start_index: number;
  end_index: number;
  word_count: number;
  token_length: number;
  is_humanized?: boolean;
  humanizer_score?: number;
};

export type PangramResult = {
  stage: "STAGE_SUCCESS" | "STAGE_FAILED" | string;
  task_id?: string;
  text?: string;
  version?: string;
  headline?: string;
  prediction?: string;
  prediction_short?: "AI" | "Human" | "Mixed" | string;
  fraction_ai?: number;
  fraction_ai_assisted?: number;
  fraction_human?: number;
  num_ai_segments?: number;
  num_ai_assisted_segments?: number;
  num_human_segments?: number;
  dashboard_link?: string;
  windows?: PangramWindow[];
};

/** What we persist per file after a detection run. */
export type StoredDetection = {
  createdAt: string;
  model: string;
  mock: boolean;
  /** sha1 of the prose text that was analysed */
  textHash: string;
  /** the prose text that was sent (needed to map windows back later) */
  sentText: string;
  wordCount: number;
  result: PangramResult;
  /** which endpoint produced it */
  mode?: "realtime" | "bulk";
  bulkId?: string;
  /** present when only changed paragraphs were sent and the rest reused */
  incremental?: IncrementalInfoShape;
};

export type IncrementalInfoShape = {
  reusedParagraphs: number;
  changedParagraphs: number;
  totalParagraphs: number;
  wordsSent: number;
  wordsTotal: number;
  unitsSent: number;
  unitsFull: number;
};

// ---------- bulk API (https://docs.pangram.com/api-reference/bulk-api) ----------

export type BulkStatus = "queued" | "running" | "succeeded" | "failed" | "partial" | string;

export type BulkSubmitResponse = {
  bulk_id: string;
  status: BulkStatus;
  total_items: number;
  accepted_items: { index: number; id?: string; task_id: string }[];
  failed_items: { index: number; id?: string; task_id: null; stage: string; error: string }[];
};

export type BulkStatusResponse = {
  bulk_id: string;
  status: BulkStatus;
  total_items: number;
  accepted: number;
  succeeded: number;
  failed: number;
  created_at: string;
  completed_at: string | null;
};

export type BulkResultItem = { index: number; id?: string; task_id: string | null; stage: string; error?: string | null; result: PangramResult | null };
export type BulkFailedItem = { index: number; id?: string; task_id: string | null; stage: string; error?: string | null };
export type BulkResultsPage = { bulk_id: string; offset: number; limit: number; total_items: number; items: BulkResultItem[]; failed_items: BulkFailedItem[] };

/** A bulk job we submitted for a project; stored under .editor/pangram/jobs/<bulkId>.json */
export type DetectionJob = {
  bulkId: string;
  createdAt: string;
  model: string;
  mock: boolean;
  status: BulkStatus;
  /** true once results have been fetched and stored per file */
  done: boolean;
  completedAt?: string;
  items: {
    id: string; file: string; textHash: string; sentText: string; wordCount: number; outcome?: "ok" | "error"; error?: string;
    /** incremental run: the full prose and the windows reused from the previous result */
    incremental?: { fullText: string; reusedWindows: PangramWindow[]; changedParagraphs: number; reusedParagraphs: number; totalParagraphs: number; wordsTotal: number; wordsReused: number };
  }[];
  counters?: { total: number; succeeded: number; failed: number };
  error?: string;
};
