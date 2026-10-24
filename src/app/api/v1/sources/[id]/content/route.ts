import { resolveOwner } from "@/server/identity";
import { handle } from "@/server/orchestration/http";
import { getSourceBytes } from "@/server/orchestration/sources";

/** Authorized preview/download. Images and PDFs render inline; spreadsheets download. */
export async function GET(_req: Request, ctx: RouteContext<"/api/v1/sources/[id]/content">) {
  return handle("GET /sources/:id/content", async () => {
    const { id } = await ctx.params;
    const owner = await resolveOwner();
    const { source, bytes } = await getSourceBytes(owner, id);
    const inline = source.kind === "image" || source.kind === "pdf";
    const asciiName = source.filename.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
    return new Response(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: source.mimeType }), {
      status: 200,
      headers: {
        "Content-Type": source.mimeType,
        "Content-Length": String(bytes.byteLength),
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(source.filename)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  });
}
