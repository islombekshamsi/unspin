import { requireOwner } from "@/server/identity";
import { listDatasetsForSource } from "@/server/orchestration/datasets";
import { handle, jsonOk } from "@/server/orchestration/http";

export async function GET(_req: Request, ctx: RouteContext<"/api/v1/sources/[id]/datasets">) {
  return handle("GET /sources/:id/datasets", async (requestId) => {
    const { id } = await ctx.params;
    const owner = await requireOwner();
    const datasets = await listDatasetsForSource(owner, id);
    return jsonOk(requestId, { datasets });
  });
}
