import { handle, json } from "@/lib/api";
import { listModels } from "@/lib/pangram/client";
import { resolvePangramKey } from "@/lib/storage";

export const GET = handle(async () => {
  if (process.env.PANGRAM_MOCK === "1") return json({ models: ["default", "pangram-4"], mock: true });
  const { key } = await resolvePangramKey();
  if (!key) return json({ models: [], error: "No API key configured" });
  return json({ models: await listModels(key) });
});
