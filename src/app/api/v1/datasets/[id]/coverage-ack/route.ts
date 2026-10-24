import { AcknowledgeCoverageRequestSchema } from "@/contracts";
import { requireOwner } from "@/server/identity";
import { acknowledgeCoverage } from "@/server/orchestration/datasets";
import { handle, jsonOk, parseJson } from "@/server/orchestration/http";

/** Records the user's explicit acknowledgement of partial/uncertain coverage. */
export async function POST(request: Request, ctx: RouteContext<"/api/v1/datasets/[id]/coverage-ack">) {
  return handle("POST /datasets/:id/coverage-ack", async (requestId) => {
    const { id } = await ctx.params;
    const owner = await requireOwner();
    const body = await parseJson(request, AcknowledgeCoverageRequestSchema);
    const dataset = await acknowledgeCoverage(owner, id, body.expectedVersionId);
    return jsonOk(requestId, { dataset });
  });
}
