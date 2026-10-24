import { z } from "zod";
import { IdSchema } from "@/contracts";
import { requireOwner } from "@/server/identity";
import { getFindings } from "@/server/orchestration/datasets";
import { handle, jsonOk, parseWith, searchParamsObject } from "@/server/orchestration/http";

const Query = z.object({ versionId: IdSchema });

export async function GET(request: Request, ctx: RouteContext<"/api/v1/datasets/[id]/findings">) {
  return handle("GET /datasets/:id/findings", async (requestId) => {
    const { id } = await ctx.params;
    const owner = await requireOwner();
    const q = parseWith(Query, searchParamsObject(request));
    const findings = await getFindings(owner, id, q.versionId);
    return jsonOk(requestId, { versionId: q.versionId, findings });
  });
}
