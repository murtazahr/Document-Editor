import { handle, json } from "@/lib/api";
import { refreshDetectionJob } from "@/lib/pangram/jobs";
import { getProject } from "@/lib/storage";

type Ctx = { params: Promise<{ id: string; bulkId: string }> };

/** Poll once: refreshes the job from Pangram and, when terminal, stores the per-file results. */
export const GET = handle(async (_req: Request, { params }: Ctx) => {
  const { id, bulkId } = await params;
  await getProject(id);
  return json({ job: await refreshDetectionJob(id, bulkId) });
});
