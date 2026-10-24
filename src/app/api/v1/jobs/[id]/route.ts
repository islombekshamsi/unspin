import { resolveOwner } from "@/server/identity";
import { getJob } from "@/server/orchestration/extraction";
import { handle, jsonOk } from "@/server/orchestration/http";

export async function GET(_req: Request, ctx: RouteContext<"/api/v1/jobs/[id]">) {
  return handle("GET /jobs/:id", async (requestId) => {
    const { id } = await ctx.params;
    const owner = await resolveOwner();
    const job = await getJob(owner, id);
    const active = job.status === "queued" || job.status === "running";
    return jsonOk(requestId, { job, pollAfterMs: active ? 1500 : null });
  });
}
