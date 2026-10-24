import { PreviewTransformRequestSchema } from "@/contracts";
import { resolveOwner } from "@/server/identity";
import { previewTransform } from "@/server/orchestration/datasets";
import { handle, jsonOk, parseJson } from "@/server/orchestration/http";

export async function POST(request: Request, ctx: RouteContext<"/api/v1/datasets/[id]/transforms/preview">) {
  return handle("POST /datasets/:id/transforms/preview", async (requestId) => {
    const { id } = await ctx.params;
    const owner = await resolveOwner();
    const body = await parseJson(request, PreviewTransformRequestSchema);
    const preview = await previewTransform(owner, id, body);
    return jsonOk(requestId, { preview });
  });
}
