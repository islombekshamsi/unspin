import { z } from "zod";
import { IdSchema, ViewSpecSchema } from "@/contracts";
import { requireOwner } from "@/server/identity";
import { handle, jsonOk, parseWith, searchParamsObject } from "@/server/orchestration/http";
import { getOverview } from "@/server/orchestration/views";

const Query = z.object({
  versionId: IdSchema,
  preset: ViewSpecSchema.shape.preset.optional(),
  search: z.string().max(200).optional(),
  filterColumnId: IdSchema.optional(),
  filterText: z.string().max(200).optional(),
});

export async function GET(request: Request, ctx: RouteContext<"/api/v1/datasets/[id]/overview">) {
  return handle("GET /datasets/:id/overview", async (requestId) => {
    const { id } = await ctx.params;
    const owner = await requireOwner();
    const q = parseWith(Query, searchParamsObject(request));
    const overview = await getOverview(owner, id, q.versionId, {
      preset: q.preset ?? "all",
      search: q.search ?? null,
      filterColumnId: q.filterColumnId ?? null,
      filterText: q.filterText ?? null,
      sort: { columnId: null, direction: "asc" },
      columnIds: null,
    });
    return jsonOk(requestId, { overview });
  });
}
