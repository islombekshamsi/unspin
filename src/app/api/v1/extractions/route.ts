import { CreateExtractionRequestSchema } from "@/contracts";
import { requireOwner } from "@/server/identity";
import { createExtraction } from "@/server/orchestration/extraction";
import { handle, jsonOk, parseJson } from "@/server/orchestration/http";

/**
 * Creates an idempotent job for a selection. In inline mode the bounded request
 * runs before responding; in worker mode the job is returned queued.
 */
export async function POST(request: Request) {
  return handle("POST /extractions", async (requestId) => {
    const owner = await requireOwner();
    const body = await parseJson(request, CreateExtractionRequestSchema);
    const job = await createExtraction(owner, body);
    return jsonOk(requestId, { job }, job.status === "queued" || job.status === "running" ? 202 : 200);
  });
}
