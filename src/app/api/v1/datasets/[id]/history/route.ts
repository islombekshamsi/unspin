import { requireOwner } from "@/server/identity";
import { getHistory } from "@/server/orchestration/datasets";
import { handle, jsonOk } from "@/server/orchestration/http";

export async function GET(_req: Request, ctx: RouteContext<"/api/v1/datasets/[id]/history">) {
  return handle("GET /datasets/:id/history", async (requestId) => {
    const { id } = await ctx.params;
    const owner = await requireOwner();
    const history = await getHistory(owner, id);
    return jsonOk(requestId, history);
  });
}
