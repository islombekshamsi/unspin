import { requireOwner } from "@/server/identity";
import { handle, jsonOk } from "@/server/orchestration/http";
import { getSelection } from "@/server/orchestration/sources";

export async function GET(_req: Request, ctx: RouteContext<"/api/v1/selections/[id]">) {
  return handle("GET /selections/:id", async (requestId) => {
    const { id } = await ctx.params;
    const owner = await requireOwner();
    const selection = await getSelection(owner, id);
    return jsonOk(requestId, { selection });
  });
}
