import { UpdateSavedViewRequestSchema } from "@/contracts";
import { requireOwner } from "@/server/identity";
import { handle, jsonOk, parseJson } from "@/server/orchestration/http";
import { deleteView, updateView } from "@/server/orchestration/views";

export async function PATCH(request: Request, ctx: RouteContext<"/api/v1/datasets/[id]/views/[viewId]">) {
  return handle("PATCH /datasets/:id/views/:viewId", async (requestId) => {
    const { id, viewId } = await ctx.params;
    const owner = await requireOwner();
    const body = await parseJson(request, UpdateSavedViewRequestSchema);
    const view = await updateView(owner, id, viewId, body);
    return jsonOk(requestId, { view });
  });
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/v1/datasets/[id]/views/[viewId]">) {
  return handle("DELETE /datasets/:id/views/:viewId", async (requestId) => {
    const { id, viewId } = await ctx.params;
    const owner = await requireOwner();
    await deleteView(owner, id, viewId);
    return jsonOk(requestId, { deleted: true });
  });
}
