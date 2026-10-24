import { ChartQueryRequestSchema } from "@/contracts";
import { resolveOwner } from "@/server/identity";
import { chartQuery } from "@/server/orchestration/datasets";
import { handle, jsonOk, parseJson } from "@/server/orchestration/http";

export async function POST(request: Request, ctx: RouteContext<"/api/v1/datasets/[id]/chart-query">) {
  return handle("POST /datasets/:id/chart-query", async (requestId) => {
    const { id } = await ctx.params;
    const owner = await resolveOwner();
    const body = await parseJson(request, ChartQueryRequestSchema);
    const result = await chartQuery(owner, id, body);
    return jsonOk(requestId, { result });
  });
}
