import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { CATEGORIES, chunkText, mockSuggestions, resolveSuggestions, type RawSuggestion, type Suggestion } from "./resolve";

export const DEFAULT_GRAMMAR_MODEL = "claude-sonnet-5-5";
export const GRAMMAR_MODELS = ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5"] as const;

export type GrammarLevel = "grammar" | "clarity";

export class GrammarError extends Error {
  constructor(message: string, public status = 502) {
    super(message);
  }
}

const SuggestionSchema = z.object({
  original: z.string().describe("Exact, verbatim, contiguous substring of the input, copied character for character (including any LaTeX inside it). Keep it minimal: a few words up to one sentence."),
  replacement: z.string().describe("The corrected text for exactly that span."),
  reason: z.string().describe("One short sentence explaining the fix."),
  category: z.enum(CATEGORIES),
});
const OutputSchema = z.object({ suggestions: z.array(SuggestionSchema) });

function systemPrompt(level: GrammarLevel) {
  return `You are a meticulous copy editor for academic writing. The user gives you LaTeX source.

Return corrections as a list of minimal edits. For each edit, "original" must be an exact verbatim substring of the input (copy it character for character, including LaTeX commands, braces, tildes and math inside the span) and "replacement" is the corrected version of exactly that span. Keep spans short: the smallest run of words that makes the fix unambiguous, never more than one sentence. Do not merge separate fixes into one span.

Fix: spelling, grammar (agreement, tense, articles, prepositions), punctuation, and wrong or misused words.${level === "clarity" ? "\nAlso fix clearly awkward or wordy phrasing when a shorter, plainer wording keeps the exact meaning (for example filler openers like \"It is important to note that\")." : "\nDo not make stylistic rewrites; only fix actual errors."}

Never change: LaTeX commands and their arguments (\\cite, \\ref, \\label, \\includegraphics, environments), math between $...$ or in equation environments, URLs, code, bibliography entries, technical terms, numbers, or the author's meaning, claims and voice. Do not rewrite whole paragraphs. Do not comment on content. If nothing needs fixing, return an empty list.`;
}

export type GrammarResult = {
  suggestions: Suggestion[];
  unresolved: number;
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number };
  model: string;
  mock: boolean;
  chunks: number;
};

/** Check `text` (LaTeX source). Offsets in the result are relative to `text`. */
export async function checkGrammar(text: string, opts: { apiKey: string | null; model?: string; level?: GrammarLevel; mock?: boolean }): Promise<GrammarResult> {
  const level = opts.level ?? "grammar";
  const model = opts.model || DEFAULT_GRAMMAR_MODEL;
  const chunks = chunkText(text, 8000);
  const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };
  const all: Suggestion[] = [];
  let unresolved = 0;

  if (opts.mock) {
    chunks.forEach((c, i) => {
      const r = resolveSuggestions(c.text, mockSuggestions(c.text), c.offset, `c${i}s`);
      all.push(...r.resolved);
      unresolved += r.unresolved.length;
    });
    return { suggestions: all.sort((a, b) => a.from - b.from), unresolved, usage, model: "mock", mock: true, chunks: chunks.length };
  }

  if (!opts.apiKey) throw new GrammarError("No Anthropic API key configured. Add one in Settings or set ANTHROPIC_API_KEY.", 400);
  const client = new Anthropic({ apiKey: opts.apiKey, timeout: 180_000, maxRetries: 2 });
  const system = systemPrompt(level);

  const runChunk = async (chunk: { text: string; offset: number }, i: number) => {
    let response;
    try {
      response = await client.messages.parse({
        model,
        max_tokens: 16000,
        system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: `Check the following LaTeX source and return the edits.\n\n<latex>\n${chunk.text}\n</latex>` }],
        output_config: { effort: "low", format: zodOutputFormat(OutputSchema) },
      });
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError) throw new GrammarError("Anthropic rejected the API key.", 401);
      if (e instanceof Anthropic.PermissionDeniedError) throw new GrammarError(`Anthropic: ${e.message}`, 403);
      if (e instanceof Anthropic.NotFoundError) throw new GrammarError(`Model "${model}" not found or not available to this key.`, 404);
      if (e instanceof Anthropic.RateLimitError) throw new GrammarError("Anthropic rate limit reached; try again shortly.", 429);
      if (e instanceof Anthropic.BadRequestError) throw new GrammarError(`Anthropic rejected the request: ${e.message}`, 400);
      if (e instanceof Anthropic.APIError) throw new GrammarError(`Anthropic API error ${e.status ?? ""}: ${e.message}`, 502);
      throw e;
    }
    usage.inputTokens += response.usage.input_tokens;
    usage.outputTokens += response.usage.output_tokens;
    usage.cacheReadTokens += response.usage.cache_read_input_tokens ?? 0;
    if (response.stop_reason === "refusal") {
      throw new GrammarError(`The model declined this request${response.stop_details?.category ? ` (${response.stop_details.category})` : ""}.`, 422);
    }
    if (response.stop_reason === "max_tokens") throw new GrammarError("The response was cut off (max_tokens). Check a smaller selection.", 502);
    const parsed = response.parsed_output;
    if (!parsed) throw new GrammarError("Could not parse the model's response.", 502);
    const r = resolveSuggestions(chunk.text, parsed.suggestions as RawSuggestion[], chunk.offset, `c${i}s`);
    unresolved += r.unresolved.length;
    return r.resolved;
  };

  // a few chunks in parallel keeps long files responsive without hammering rate limits
  const PAR = 3;
  for (let i = 0; i < chunks.length; i += PAR) {
    const batch = chunks.slice(i, i + PAR).map((c, j) => runChunk(c, i + j));
    for (const res of await Promise.all(batch)) all.push(...res);
  }
  return { suggestions: all.sort((a, b) => a.from - b.from), unresolved, usage, model, mock: false, chunks: chunks.length };
}
