import { RowsQuerySchema } from "@/contracts";
import { resolveOwner } from "@/server/identity";
import { getRows } from "@/server/orchestration/datasets";
import { handle, jsonOk, parseWith, searchParamsObject } from "@/server/orchestration/http";

export async function GET(request: Request, ctx: RouteContext<"/api/v1/datasets/[id]/rows">) {
  return handle("GET /datasets/:id/rows", async (requestId) => {
    const { id } = await ctx.params;
    const owner = await resolveOwner();
    const q = parseWith(RowsQuerySchema, searchParamsObject(request));
    const page = await getRows(owner, id, q);
    return jsonOk(requestId, page);
  });
}
