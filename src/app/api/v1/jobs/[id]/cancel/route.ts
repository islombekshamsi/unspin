import { requireOwner } from "@/server/identity";
import { cancelJob } from "@/server/orchestration/extraction";
import { handle, jsonOk } from "@/server/orchestration/http";

/** Best-effort: a provider request already in flight may still complete upstream. */
export async function POST(_req: Request, ctx: RouteContext<"/api/v1/jobs/[id]/cancel">) {
  return handle("POST /jobs/:id/cancel", async (requestId) => {
    const { id } = await ctx.params;
    const owner = await requireOwner();
    const job = await cancelJob(owner, id);
    return jsonOk(requestId, { job });
  });
}
