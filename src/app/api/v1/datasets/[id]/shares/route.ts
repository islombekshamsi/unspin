import { AppError } from "@/contracts";
import { requireOwner } from "@/server/identity";
import { handle, jsonOk, parseJson } from "@/server/orchestration/http";
import { CreateShareRequestSchema, createShare, listShares } from "@/server/sharing";
import { getRepositories } from "@/server/storage";

/** Explicit, read-only, expiring share of one version. The token is returned once and never stored. */
export async function POST(request: Request, ctx: RouteContext<"/api/v1/datasets/[id]/shares">) {
  return handle("POST /datasets/:id/shares", async (requestId) => {
    const { id } = await ctx.params;
    const owner = await requireOwner();
    if (!getRepositories().shares) {
      throw new AppError("not_configured", "Read-only sharing needs durable storage, which this server does not have.");
    }
    const body = await parseJson(request, CreateShareRequestSchema);
    const { share, token } = await createShare(owner, id, body);
    return jsonOk(requestId, { share, token }, 201);
  });
}

export async function GET(_req: Request, ctx: RouteContext<"/api/v1/datasets/[id]/shares">) {
  return handle("GET /datasets/:id/shares", async (requestId) => {
    const { id } = await ctx.params;
    const owner = await requireOwner();
    return jsonOk(requestId, { shares: await listShares(owner, id) });
  });
}
