"use client";

import { useEffect, useMemo, useState } from "react";
import type { HistoryEntry, HistoryResponse } from "@/contracts";
import { Badge, Button, Disclosure, EmptyState, ErrorState, ProgressStatus } from "@/components/ui";
import type { HistoryPanelProps } from "@/features/workspace/seams";
import { ApiClientError, api } from "@/lib/api/client";
import { HISTORY_KIND_LABELS } from "../lib/describe";
import { ConflictNotice } from "./ConflictNotice";

type Pending = { targetVersionId: string; label: string; undo: boolean };
type RestoreState = { status: "idle" } | { status: "confirm"; pending: Pending } | { status: "saving"; pending: Pending } | { status: "failed"; error: ApiClientError } | { status: "conflict" } | { status: "done"; label: string };

/**
 * Immutable history. Undo and "Make current" restore an actual stored version (recorded as a new
 * history entry); nothing is reconstructed by reversing operations in the browser.
 */
export function HistoryPanel({ detail, onDetailChange, onViewVersion }: HistoryPanelProps) {
  const { dataset, version, versions } = detail;
  const [history, setHistory] = useState<{ key: string; data: HistoryResponse | null; error: ApiClientError | null } | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [restore, setRestore] = useState<RestoreState>({ status: "idle" });
  const key = `${dataset.id}:${dataset.currentVersionId}:${reloadToken}`;

  useEffect(() => {
    let cancelled = false;
    api.getHistory(dataset.id).then(
      (data) => !cancelled && setHistory({ key, data, error: null }),
      (e) => {
        if (cancelled) return;
        if (e instanceof ApiClientError) setHistory({ key, data: null, error: e });
        else throw e;
      },
    );
    return () => {
      cancelled = true;
    };
  }, [dataset.id, key]);

  const versionNumber = useMemo(() => new Map(versions.map((v, i) => [v.id, i + 1])), [versions]);
  const vLabel = (id: string | null) => (id ? `v${versionNumber.get(id) ?? "?"}` : "—");
  const ready = history?.key === key;
  const data = ready ? history.data : null;
  const entries = data ? [...data.entries].reverse() : [];
  const currentId = data?.currentVersionId ?? dataset.currentVersionId;
  const stale = !!data && data.currentVersionId !== dataset.currentVersionId;
  const currentEntry = entries.find((e) => e.resultVersionId === currentId) ?? null;
  const undoTarget = currentEntry?.baseVersionId ?? null;

  const doRestore = async (pending: Pending) => {
    setRestore({ status: "saving", pending });
    try {
      const next = await api.restoreVersion(dataset.id, { expectedVersionId: currentId, targetVersionId: pending.targetVersionId });
      setRestore({ status: "done", label: pending.label });
      onDetailChange(next);
    } catch (e) {
      if (!(e instanceof ApiClientError)) throw e;
      setRestore(e.code === "version_conflict" ? { status: "conflict" } : { status: "failed", error: e });
    }
  };

  return (
    <div className="flex flex-col gap-4 text-[13px]">
      {!ready && <ProgressStatus label="Loading history…" />}
      {ready && history.error && (
        <ErrorState title="Could not load history" message={history.error.message} code={history.error.code} action={<Button size="sm" onClick={() => setReloadToken((t) => t + 1)}>Try again</Button>} />
      )}
      {stale && (
        <ConflictNotice
          datasetId={dataset.id}
          onDetailChange={onDetailChange}
          title="A newer version exists"
          message="Another change was saved after this workspace loaded. Load the latest version before undoing or restoring."
        />
      )}

      {data && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-rule bg-sunken px-3 py-2">
          <p className="min-w-0 flex-1">
            Current version: <strong>{vLabel(currentId)}</strong>
            {version.id !== currentId && <span className="text-ink-muted"> · you are viewing {vLabel(version.id)} (read-only)</span>}
          </p>
          <Button
            size="sm"
            disabled={!undoTarget || stale || restore.status === "saving"}
            title={undoTarget ? `Make ${vLabel(undoTarget)} current again` : "Nothing to undo"}
            onClick={() => undoTarget && currentEntry && setRestore({ status: "confirm", pending: { targetVersionId: undoTarget, label: `Undo “${currentEntry.summary}”`, undo: true } })}
          >
            Undo last change
          </Button>
        </div>
      )}

      {restore.status === "confirm" || restore.status === "saving" ? (
        <div role="alertdialog" aria-label="Confirm restore" className="rounded-md border border-accent/40 bg-accent-soft/40 px-3 py-2">
          <p className="font-medium">{restore.pending.label}?</p>
          <p className="mt-1 text-ink-muted">
            This makes stored version {vLabel(restore.pending.targetVersionId)} current. Nothing is deleted: the version you leave stays in history and can be made current again.
          </p>
          <div className="mt-2 flex gap-2">
            <Button size="sm" variant="primary" loading={restore.status === "saving"} onClick={() => void doRestore(restore.pending)}>
              {restore.status === "saving" ? "Restoring…" : restore.pending.undo ? "Undo" : "Make current"}
            </Button>
            <Button size="sm" variant="ghost" disabled={restore.status === "saving"} onClick={() => setRestore({ status: "idle" })}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
      {restore.status === "done" && (
        <p role="status" className="rounded-md border border-success/30 bg-success-soft px-3 py-2 text-success">
          Done: {restore.label}. This restore is recorded below.
        </p>
      )}
      {restore.status === "failed" && <ErrorState title="Not restored" message={restore.error.message} code={restore.error.code} action={<Button size="sm" onClick={() => setRestore({ status: "idle" })}>Dismiss</Button>} />}
      {restore.status === "conflict" && <ConflictNotice datasetId={dataset.id} onDetailChange={(d) => { setRestore({ status: "idle" }); onDetailChange(d); }} onDismiss={() => setRestore({ status: "idle" })} />}

      {data && entries.length === 0 && <EmptyState title="No history yet" />}
      <ol className="flex flex-col gap-2" aria-label="History, newest first">
        {entries.map((e) => (
          <HistoryItem
            key={e.id}
            entry={e}
            vLabel={vLabel}
            isCurrent={e.resultVersionId === currentId}
            isViewed={e.resultVersionId === version.id}
            canRestore={!stale && restore.status !== "saving"}
            onView={() => onViewVersion(e.resultVersionId)}
            onMakeCurrent={() => setRestore({ status: "confirm", pending: { targetVersionId: e.resultVersionId, label: `Make ${vLabel(e.resultVersionId)} current`, undo: false } })}
          />
        ))}
      </ol>
    </div>
  );
}

function HistoryItem({
  entry: e,
  vLabel,
  isCurrent,
  isViewed,
  canRestore,
  onView,
  onMakeCurrent,
}: {
  entry: HistoryEntry;
  vLabel: (id: string | null) => string;
  isCurrent: boolean;
  isViewed: boolean;
  canRestore: boolean;
  onView: () => void;
  onMakeCurrent: () => void;
}) {
  const rows = e.rowCountBefore === null || e.rowCountBefore === e.rowCountAfter ? `${e.rowCountAfter} rows` : `${e.rowCountBefore} → ${e.rowCountAfter} rows`;
  return (
    <li className="rounded-md border border-rule px-3 py-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone={e.kind === "restore" ? "accent" : "neutral"}>{HISTORY_KIND_LABELS[e.kind]}</Badge>
        <span className="font-medium">{vLabel(e.resultVersionId)}</span>
        {isCurrent && <Badge tone="success">Current</Badge>}
        {isViewed && !isCurrent && <Badge tone="estimate">Viewing</Badge>}
        <time className="ml-auto text-[12px] text-ink-muted" dateTime={e.createdAt}>
          {new Date(e.createdAt).toLocaleString()}
        </time>
      </div>
      <p className="mt-1 text-ink">{e.summary}</p>
      <p className="tabular mt-0.5 text-[12px] text-ink-muted">
        {e.actor.label} · from {vLabel(e.baseVersionId)} · {e.affectedCount} affected · {e.changedCellIds.length} cell{e.changedCellIds.length === 1 ? "" : "s"} changed
        {e.removedRowIds.length ? ` · ${e.removedRowIds.length} rows removed` : ""} · {rows}
        {e.kind === "restore" && e.restoredVersionId ? ` · restored ${vLabel(e.restoredVersionId)}` : ""}
      </p>
      {e.operation && (
        <Disclosure className="mt-2" summary="Exact operation">
          <pre className="max-h-48 overflow-auto font-mono text-[11px] leading-4 whitespace-pre-wrap text-ink-muted">{JSON.stringify(e.operation, null, 2)}</pre>
        </Disclosure>
      )}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {!isViewed && (
          <Button size="sm" onClick={onView}>
            View {vLabel(e.resultVersionId)}
          </Button>
        )}
        {!isCurrent && (
          <Button size="sm" variant="ghost" disabled={!canRestore} onClick={onMakeCurrent}>
            Make current…
          </Button>
        )}
      </div>
    </li>
  );
}
