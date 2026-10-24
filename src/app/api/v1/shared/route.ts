import { handle, jsonOk } from "@/server/orchestration/http";
import { resolveShare } from "@/server/sharing";

/**
 * Read-only shared view. The token travels in a header (the page keeps it in the URL
 * fragment) so it never appears in request lines, server logs, or proxy logs.
 */
export async function GET(request: Request) {
  return handle("GET /shared", async (requestId) => {
    const view = await resolveShare(request.headers.get("x-share-token") ?? "");
    return jsonOk(requestId, {
      share: { id: view.share.id, expiresAt: view.share.expiresAt, includeSource: view.share.includeSource },
      dataset: view.dataset,
      version: view.snapshot.version,
      rows: view.snapshot.rows,
      provenance: view.provenance,
      source: view.source,
    });
  });
}
