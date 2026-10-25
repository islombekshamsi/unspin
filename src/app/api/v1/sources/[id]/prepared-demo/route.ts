import { PrepareDemoRequestSchema } from "@/contracts";
import { requireOwner } from "@/server/identity";
import { handle, jsonOk, parseJson } from "@/server/orchestration/http";
import { getPreparedDemo, prepareDemo } from "@/server/demos";
export async function POST(request: Request, ctx: RouteContext<"/api/v1/sources/[id]/prepared-demo">) {
  return handle("POST /sources/:id/prepared-demo",async(requestId)=> {
    const owner=await requireOwner();const {id}=await ctx.params;
    const body=await parseJson(request,PrepareDemoRequestSchema);
    return jsonOk(requestId,{ report:await prepareDemo(owner,id,body.mode) });
  });
}
export async function GET(_request: Request, ctx: RouteContext<"/api/v1/sources/[id]/prepared-demo">) {
  return handle("GET /sources/:id/prepared-demo",async(requestId)=> {
    const owner=await requireOwner();const {id}=await ctx.params;
    return jsonOk(requestId,{ report:await getPreparedDemo(owner,id) });
  });
}
