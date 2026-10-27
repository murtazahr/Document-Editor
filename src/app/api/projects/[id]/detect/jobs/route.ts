import { handle, json, type Params } from "@/lib/api";
import { pendingDetectionJobs, recentDetectionJobs } from "@/lib/pangram/jobs";
import { getProject } from "@/lib/storage";

/** GET ?all=1 for recent jobs; default: pending (not yet collected) jobs. */
export const GET = handle(async (req: Request, { params }: Params<"id">) => {
  const { id } = await params;
  await getProject(id);
  const all = new URL(req.url).searchParams.get("all");
  return json({ jobs: all ? await recentDetectionJobs(id) : await pendingDetectionJobs(id) });
});
