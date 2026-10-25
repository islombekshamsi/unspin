import { requireOwner } from "@/server/identity";
import { getAnalysis } from "@/server/orchestration/analysis";
import { handle, jsonOk } from "@/server/orchestration/http";

export async function GET(_req: Request, ctx: RouteContext<"/api/v1/datasets/[id]/analysis/[analysisId]">) {
  return handle("GET /datasets/:id/analysis/:analysisId", async (requestId) => {
    const { id, analysisId } = await ctx.params;
    const owner = await requireOwner();
    const record = await getAnalysis(owner, id, analysisId);
    return jsonOk(requestId, { record });
  });
}
