import { CreateAnalysisRequestSchema } from "@/contracts";
import { requireOwner } from "@/server/identity";
import { createAnalysisJob, listAnalysis } from "@/server/orchestration/analysis";
import { handle, jsonOk, parseJson } from "@/server/orchestration/http";

export async function GET(_req: Request, ctx: RouteContext<"/api/v1/datasets/[id]/analysis">) {
  return handle("GET /datasets/:id/analysis", async (requestId) => {
    const { id } = await ctx.params;
    const owner = await requireOwner();
    const records = await listAnalysis(owner, id);
    return jsonOk(requestId, { records });
  });
}

export async function POST(request: Request, ctx: RouteContext<"/api/v1/datasets/[id]/analysis">) {
  return handle("POST /datasets/:id/analysis", async (requestId) => {
    const { id } = await ctx.params;
    const owner = await requireOwner();
    const body = await parseJson(request, CreateAnalysisRequestSchema);
    const job = await createAnalysisJob(owner, id, body);
    return jsonOk(requestId, { job }, 201);
  });
}
