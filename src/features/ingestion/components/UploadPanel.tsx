"use client";

import { useRef, useState } from "react";
import { Button, ErrorState, FileDropzone, ProgressStatus } from "@/components/ui";
import type { UploadPanelProps } from "@/features/workspace/seams";
import { ApiClientError, api } from "@/lib/api/client";
import { formatBytes } from "../lib/format";

const ACCEPT = [".csv", ".xlsx", ".pdf", ".png", ".jpg", ".jpeg", ".webp", "text/csv", "application/pdf", "image/png", "image/jpeg", "image/webp", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"].join(",");

interface UploadError {
  title: string;
  message: string;
  code?: string;
  requestId?: string;
}

export function UploadPanel({ limits, onSourceCreated }: UploadPanelProps) {
  const [uploading, setUploading] = useState<{ name: string; size: number } | null>(null);
  const [error, setError] = useState<UploadError | null>(null);
  const controller = useRef<AbortController | null>(null);

  const start = async (file: File) => {
    if (uploading) return;
    if (limits && file.size > limits.maxUploadBytes) {
      setError({
        title: `${file.name} is too large`,
        message: `It is ${formatBytes(file.size)}; files are limited to ${formatBytes(limits.maxUploadBytes)}.`,
        code: "payload_too_large",
      });
      return;
    }
    if (file.size === 0) {
      setError({ title: `${file.name} is empty`, message: "Choose a file that contains data." });
      return;
    }
    const ac = new AbortController();
    controller.current = ac;
    setUploading({ name: file.name, size: file.size });
    setError(null);
    try {
      const source = await api.uploadSource(file, ac.signal);
      onSourceCreated(source);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        setError({ title: "Upload cancelled", message: `${file.name} was not opened. Choose a file to try again.` });
      } else if (e instanceof ApiClientError) {
        setError({ title: `${file.name} could not be used`, message: e.message, code: e.code, requestId: e.requestId ?? undefined });
      } else {
        setError({ title: "Upload failed", message: "Something went wrong while uploading. Try again." });
      }
    } finally {
      controller.current = null;
      setUploading(null);
    }
  };

  return (
    <section aria-label="Upload a source file" className="flex flex-col gap-3">
      {uploading ? (
        <div className="rounded-lg border border-rule bg-surface px-5 py-6">
          <ProgressStatus
            label={`Uploading and checking ${uploading.name}`}
            detail={`${formatBytes(uploading.size)} · the file type is verified from its contents on the server`}
          />
          <div className="mt-4">
            <Button size="sm" onClick={() => controller.current?.abort()}>
              Cancel upload
            </Button>
          </div>
        </div>
      ) : (
        <FileDropzone accept={ACCEPT} onFile={(f) => void start(f)} title="Drop a chart, PDF, or spreadsheet here">
          <p>
            {limits ? limits.acceptedKinds.join(", ") : "PNG, JPEG, WebP, PDF, CSV, XLSX"}
            {limits ? ` · up to ${formatBytes(limits.maxUploadBytes)}` : ""}
          </p>
          {limits && (
            <p className="mt-1 text-[12px] text-ink-faint">
              Spreadsheets: up to {limits.maxStructuredRows.toLocaleString()} rows and {limits.maxColumns} columns per import · PDFs: up to {limits.maxPdfPages} pages · Images: up to{" "}
              {Math.round(limits.maxImagePixels / 1_000_000)} megapixels
            </p>
          )}
          {!limits && <p className="mt-1 text-[12px] text-ink-faint">Checking this server&apos;s limits…</p>}
        </FileDropzone>
      )}
      {error && (
        <ErrorState
          title={error.title}
          message={error.message}
          code={error.code}
          requestId={error.requestId}
          action={
            <Button size="sm" variant="ghost" onClick={() => setError(null)}>
              Dismiss
            </Button>
          }
        />
      )}
      <p className="text-[12px] leading-4 text-ink-faint">
        Legacy .xls, macro-enabled .xlsm, password-protected files, archives, and executables are refused. The file name is shown to you only; the type is decided from the file&apos;s contents.
      </p>
    </section>
  );
}
