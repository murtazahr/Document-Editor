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
};
