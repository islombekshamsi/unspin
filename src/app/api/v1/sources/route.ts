import { AppError } from "@/contracts";
import { LIMITS } from "@/server/config/limits";
import { currentOwner, resolveOwner } from "@/server/identity";
import { handle, jsonOk } from "@/server/orchestration/http";
import { createSource } from "@/server/orchestration/sources";
import { getRepositories } from "@/server/storage";

/** Multipart field name: "file". */
export async function POST(request: Request) {
  return handle("POST /sources", async (requestId) => {
    const owner = await resolveOwner();
    const declared = Number(request.headers.get("content-length") ?? "0");
    // Multipart framing adds a little overhead beyond the file itself.
    if (declared > LIMITS.maxUploadBytes + 64 * 1024) {
      throw new AppError("payload_too_large", `Files are limited to ${LIMITS.maxUploadBytes / (1024 * 1024)} MiB.`, {
        details: { limitBytes: LIMITS.maxUploadBytes },
      });
    }
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw new AppError("bad_request", "Expected a multipart upload with a single file.");
    }
    const file = form.get("file");
    if (!(file instanceof File)) throw new AppError("bad_request", "Expected a file in the \"file\" field.");
    const source = await createSource(owner, file);
    return jsonOk(requestId, { source }, 201);
  });
}

export async function GET() {
  return handle("GET /sources", async (requestId) => {
    const owner = await currentOwner();
    const sources = owner ? await getRepositories().sources.list(owner) : [];
    return jsonOk(requestId, { sources });
  });
}
