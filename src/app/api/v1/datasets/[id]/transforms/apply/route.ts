import { ApplyTransformRequestSchema } from "@/contracts";
import { requireOwner } from "@/server/identity";
import { applyTransform } from "@/server/orchestration/datasets";
import { handle, jsonOk, parseJson } from "@/server/orchestration/http";

export async function POST(request: Request, ctx: RouteContext<"/api/v1/datasets/[id]/transforms/apply">) {
  return handle("POST /datasets/:id/transforms/apply", async (requestId) => {
    const { id } = await ctx.params;
    const owner = await requireOwner();
    const body = await parseJson(request, ApplyTransformRequestSchema);
    const detail = await applyTransform(owner, id, body);
    return jsonOk(requestId, detail);
  });
}
