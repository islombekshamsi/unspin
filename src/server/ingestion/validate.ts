import { createHash } from "node:crypto";
import { AppError, type ValidatedUpload } from "@/contracts";
import { LIMITS } from "@/server/config/limits";
import { inspectImage } from "@/server/sources/image";
import { withPdf } from "@/server/sources/pdf";
import { oleLooksEncryptedOoxml, sniff } from "@/server/sources/signatures";
import { validateCsvBytes } from "./csv";
import { validateXlsxBytes } from "./xlsx";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const SUPPORTED = "Upload a PNG, JPEG, WebP, PDF, CSV, or XLSX file.";

function cleanFilename(name: string): string {
  // Display metadata only: strip any path and control characters, bound the length.
  const base = name.replace(/^.*[\\/]/, "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return (base || "upload").slice(0, 512);
}

/**
 * Decides the source kind from the bytes alone (signature, then a real parser).
 * The filename and declared MIME type are kept as display metadata and never decide the kind.
 */
export async function validateUploadBytes(input: { bytes: Uint8Array; filename: string; declaredMimeType: string | null }): Promise<ValidatedUpload> {
  const { bytes } = input;
  if (bytes.byteLength > LIMITS.maxUploadBytes) {
    throw new AppError("payload_too_large", `Files are limited to ${LIMITS.maxUploadBytes / (1024 * 1024)} MiB.`, {
      details: { limitBytes: LIMITS.maxUploadBytes, byteSize: bytes.byteLength },
    });
  }
  if (bytes.byteLength === 0) throw new AppError("no_data_found", "The file is empty.");

  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const filename = cleanFilename(input.filename);
  const base = { filename, byteSize: bytes.byteLength, sha256 };
  const s = sniff(bytes);

  switch (s.kind) {
    case "png":
    case "jpeg":
    case "webp": {
      const image = await inspectImage(bytes, s.kind);
      return {
        ...base,
        mimeType: `image/${s.kind}`,
        kind: "image",
        pageCount: null,
        sheetNames: null,
        processingDisclosure: "gemini_selected_region",
        capabilities: { preview: true, crop: true, selectSheet: false, textCoordinates: false },
        image,
      };
    }
    case "pdf": {
      const pageCount = await withPdf(bytes, async (doc) => doc.numPages);
      if (pageCount < 1) throw new AppError("no_data_found", "The PDF has no pages.");
      if (pageCount > LIMITS.maxPdfPages) {
        throw new AppError("payload_too_large", `The PDF has ${pageCount} pages; the limit is ${LIMITS.maxPdfPages}. Extract the pages you need into a smaller PDF.`, {
          details: { pageCount, limitPages: LIMITS.maxPdfPages },
        });
      }
      return {
        ...base,
        mimeType: "application/pdf",
        kind: "pdf",
        pageCount,
        sheetNames: null,
        processingDisclosure: "gemini_selected_region",
        capabilities: { preview: true, crop: true, selectSheet: false, textCoordinates: false },
        image: null,
      };
    }
    case "zip": {
      const { sheetNames } = await validateXlsxBytes(bytes);
      return {
        ...base,
        mimeType: XLSX_MIME,
        kind: "xlsx",
        pageCount: null,
        sheetNames,
        processingDisclosure: "local_parser",
        capabilities: { preview: true, crop: false, selectSheet: true, textCoordinates: false },
        image: null,
      };
    }
    case "ole":
      if (oleLooksEncryptedOoxml(bytes)) {
        throw new AppError("encrypted_file", "This file is password-protected. Remove the password, save it as .xlsx, and upload it again.");
      }
      throw new AppError(
        "unsupported_media_type",
        "Legacy Office files (such as .xls) are not supported. Open the file in a spreadsheet application, save it as .xlsx, and upload that.",
      );
    case "rejected":
      throw new AppError("unsupported_media_type", `This file looks like ${s.what}, which is not supported. ${SUPPORTED}`);
    case "text_candidate": {
      validateCsvBytes(bytes);
      return {
        ...base,
        mimeType: "text/csv",
        kind: "csv",
        pageCount: null,
        sheetNames: null,
        processingDisclosure: "local_parser",
        capabilities: { preview: true, crop: false, selectSheet: false, textCoordinates: false },
        image: null,
      };
    }
  }
}
