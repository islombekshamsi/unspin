import { CreateSelectionRequestSchema } from "@/contracts";
import { requireOwner } from "@/server/identity";
import { handle, jsonOk, parseJson } from "@/server/orchestration/http";
import { createSelection } from "@/server/orchestration/sources";

export async function POST(request: Request) {
  return handle("POST /selections", async (requestId) => {
    const owner = await requireOwner();
    const body = await parseJson(request, CreateSelectionRequestSchema);
    const selection = await createSelection(owner, body.sourceId, body.selection);
    return jsonOk(requestId, { selection }, 201);
  });
}
