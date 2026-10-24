import { z } from "zod";
import { IdSchema } from "@/contracts";
import { resolveOwner } from "@/server/identity";
import { getDatasetDetail } from "@/server/orchestration/datasets";
import { handle, jsonOk, parseWith, searchParamsObject } from "@/server/orchestration/http";

const Query = z.object({ versionId: IdSchema.optional() });

export async function GET(request: Request, ctx: RouteContext<"/api/v1/datasets/[id]">) {
  return handle("GET /datasets/:id", async (requestId) => {
    const { id } = await ctx.params;
    const owner = await resolveOwner();
    const q = parseWith(Query, searchParamsObject(request));
    const detail = await getDatasetDetail(owner, id, q.versionId);
    return jsonOk(requestId, detail);
  });
}
