import { RestoreVersionRequestSchema } from "@/contracts";
import { requireOwner } from "@/server/identity";
import { restoreVersion } from "@/server/orchestration/datasets";
import { handle, jsonOk, parseJson } from "@/server/orchestration/http";

export async function POST(request: Request, ctx: RouteContext<"/api/v1/datasets/[id]/restore">) {
  return handle("POST /datasets/:id/restore", async (requestId) => {
    const { id } = await ctx.params;
    const owner = await requireOwner();
    const body = await parseJson(request, RestoreVersionRequestSchema);
    const detail = await restoreVersion(owner, id, body);
    return jsonOk(requestId, detail);
  });
}
