import { CreateSelectionRequestSchema } from "@/contracts";
import { resolveOwner } from "@/server/identity";
import { handle, jsonOk, parseJson } from "@/server/orchestration/http";
import { createSelection } from "@/server/orchestration/sources";

export async function POST(request: Request) {
  return handle("POST /selections", async (requestId) => {
    const owner = await resolveOwner();
    const body = await parseJson(request, CreateSelectionRequestSchema);
    const selection = await createSelection(owner, body.sourceId, body.selection);
    return jsonOk(requestId, { selection }, 201);
  });
}
