import { handle, json, type Params } from "@/lib/api";
import { checkGrammar, DEFAULT_GRAMMAR_MODEL, type GrammarLevel } from "@/lib/grammar/claude";
import { getProject, readSettings, resolveAnthropicKey, StorageError } from "@/lib/storage";

export const maxDuration = 300;

/** Body: { text, level?: "grammar" | "clarity", model? } — text is LaTeX source (a selection or a whole file). */
export const POST = handle(async (req: Request, { params }: Params<"id">) => {
  const { id } = await params;
  await getProject(id);
  const body = (await req.json()) as { text?: string; level?: GrammarLevel; model?: string };
  const text = body.text ?? "";
  if (text.trim().length < 20) throw new StorageError("Select or write at least a sentence to check.", 400);
  if (text.length > 400_000) throw new StorageError("Text too long for one check; select a part of the file.", 413);
  const settings = await readSettings();
  const { key } = await resolveAnthropicKey();
  const result = await checkGrammar(text, { apiKey: key, model: body.model || settings.anthropicModel || DEFAULT_GRAMMAR_MODEL, level: body.level ?? "grammar", mock: process.env.ANTHROPIC_MOCK === "1" });
  return json(result);
});
