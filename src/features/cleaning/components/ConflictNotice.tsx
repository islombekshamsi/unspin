"use client";

import { useState } from "react";
import type { DatasetDetail } from "@/contracts";
import { Button, ErrorState } from "@/components/ui";
import type { ApiClientError } from "@/lib/api/client";
import { loadLatest } from "../lib/useTransformFlow";

/** Recoverable 409: the dataset moved on since this view loaded. Nothing was saved. */
export function ConflictNotice({
  datasetId,
  onDetailChange,
  onDismiss,
  className,
  title = "Not saved: the dataset changed",
  message = "Another change was saved after you loaded this version, so this change was not applied. Load the latest version, check it, and preview again.",
}: {
  datasetId: string;
  onDetailChange: (d: DatasetDetail) => void;
  onDismiss?: () => void;
  className?: string;
  title?: string;
  message?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiClientError | null>(null);
  return (
    <ErrorState
      className={className}
      title={title}
      message={error ? `Loading the latest version failed: ${error.message}` : message}
      code={error?.code ?? "version_conflict"}
      action={
        <>
          <Button
            size="sm"
            variant="primary"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              setError(await loadLatest(datasetId, onDetailChange));
              setBusy(false);
            }}
          >
            Load latest
          </Button>
          {onDismiss && (
            <Button size="sm" variant="ghost" onClick={onDismiss}>
              Dismiss
            </Button>
          )}
        </>
      }
    />
  );
}
