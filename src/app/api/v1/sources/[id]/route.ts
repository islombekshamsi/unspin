import { requireOwner } from "@/server/identity";
import { handle, jsonOk } from "@/server/orchestration/http";
import { deleteSource, getSourceRecord } from "@/server/orchestration/sources";

export async function GET(_req: Request, ctx: RouteContext<"/api/v1/sources/[id]">) {
  return handle("GET /sources/:id", async (requestId) => {
    const { id } = await ctx.params;
    const owner = await requireOwner();
    const { source } = await getSourceRecord(owner, id);
    return jsonOk(requestId, { source });
  });
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/v1/sources/[id]">) {
  return handle("DELETE /sources/:id", async (requestId) => {
    const { id } = await ctx.params;
    const owner = await requireOwner();
    const result = await deleteSource(owner, id);
    return jsonOk(requestId, result);
  });
}
