import { CreateAnalysisConsentRequestSchema } from "@/contracts";
import { requireOwner } from "@/server/identity";
import { createAnalysisConsent } from "@/server/orchestration/analysis";
import { handle, jsonOk, parseJson } from "@/server/orchestration/http";

export async function POST(request: Request, ctx: RouteContext<"/api/v1/datasets/[id]/analysis/consent">) {
  return handle("POST /datasets/:id/analysis/consent", async (requestId) => {
    const { id } = await ctx.params;
    const owner = await requireOwner();
    const body = await parseJson(request, CreateAnalysisConsentRequestSchema);
    const consent = await createAnalysisConsent(owner, id, body);
    return jsonOk(requestId, { consent }, 201);
  });
}
