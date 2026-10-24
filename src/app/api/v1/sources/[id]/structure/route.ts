import { z } from "zod";
import { CsvDelimiterSchema } from "@/contracts";
import { requireOwner } from "@/server/identity";
import { handle, jsonOk, parseWith, searchParamsObject } from "@/server/orchestration/http";
import { inspectSource } from "@/server/orchestration/sources";

const Query = z.object({
  delimiter: CsvDelimiterSchema.optional(),
  sheetName: z.string().min(1).max(200).optional(),
});

/** CSV/XLSX inspection: delimiter/header suggestions, sheets, raw preview. */
export async function GET(request: Request, ctx: RouteContext<"/api/v1/sources/[id]/structure">) {
  return handle("GET /sources/:id/structure", async (requestId) => {
    const { id } = await ctx.params;
    const owner = await requireOwner();
    const q = parseWith(Query, searchParamsObject(request));
    const inspection = await inspectSource(owner, id, q);
    return jsonOk(requestId, { inspection });
  });
}
