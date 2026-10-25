import { CreateSavedViewRequestSchema } from "@/contracts";
import { requireOwner } from "@/server/identity";
import { handle, jsonOk, parseJson } from "@/server/orchestration/http";
import { createView, listViews } from "@/server/orchestration/views";

export async function GET(_req: Request, ctx: RouteContext<"/api/v1/datasets/[id]/views">) {
  return handle("GET /datasets/:id/views", async (requestId) => {
    const { id } = await ctx.params;
    const owner = await requireOwner();
    const views = await listViews(owner, id);
    return jsonOk(requestId, { views });
  });
}

export async function POST(request: Request, ctx: RouteContext<"/api/v1/datasets/[id]/views">) {
  return handle("POST /datasets/:id/views", async (requestId) => {
    const { id } = await ctx.params;
    const owner = await requireOwner();
    const body = await parseJson(request, CreateSavedViewRequestSchema);
    const view = await createView(owner, id, body);
    return jsonOk(requestId, { view }, 201);
  });
}
