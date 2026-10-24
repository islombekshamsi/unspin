import { requireOwner } from "@/server/identity";
import { handle, jsonOk } from "@/server/orchestration/http";
import { revokeShare } from "@/server/sharing";

export async function DELETE(_req: Request, ctx: RouteContext<"/api/v1/shares/[id]">) {
  return handle("DELETE /shares/:id", async (requestId) => {
    const { id } = await ctx.params;
    await revokeShare(await requireOwner(), id);
    return jsonOk(requestId, { revoked: true });
  });
}
