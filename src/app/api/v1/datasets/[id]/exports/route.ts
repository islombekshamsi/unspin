import { CreateExportRequestSchema } from "@/contracts";
import { resolveOwner } from "@/server/identity";
import { createExport } from "@/server/orchestration/datasets";
import { handle, jsonOk, parseJson } from "@/server/orchestration/http";

export async function POST(request: Request, ctx: RouteContext<"/api/v1/datasets/[id]/exports">) {
  return handle("POST /datasets/:id/exports", async (requestId) => {
    const { id } = await ctx.params;
    const owner = await resolveOwner();
    const body = await parseJson(request, CreateExportRequestSchema);
    const result = await createExport(owner, id, body);
    return jsonOk(requestId, { export: result });
  });
}
