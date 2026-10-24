"use client";

import { useEffect, useState } from "react";
import type { QualityFinding } from "@/contracts";
import { Badge, Button, Disclosure, EmptyState, ErrorState, ProgressStatus, UnavailableNote, cx, type BadgeTone } from "@/components/ui";
import type { QualityPanelProps } from "@/features/workspace/seams";
import { ApiClientError, api } from "@/lib/api/client";
import { FINDING_KIND_LABELS, SEVERITY_LABELS, describeOperation, isDestructive } from "../lib/describe";
import { useTransformFlow } from "../lib/useTransformFlow";
import { OperationBuilder } from "./OperationBuilder";
import { PreviewDialog } from "./PreviewDialog";

const SEVERITY_TONE: Record<QualityFinding["severity"], BadgeTone> = { blocking: "danger", review: "estimate", info: "neutral" };

/**
 * Observed issues for the displayed version, each a question for review. Fixes are explicit,
 * previewed, allowlisted operations; there is no "fix all".
 */
export function QualityPanel({ detail, isCurrentVersion, linked, onLinkedSelect, onDetailChange }: QualityPanelProps) {
  const { dataset, version } = detail;
  const [loaded, setLoaded] = useState<{ versionId: string; findings: QualityFinding[] | null; error: ApiClientError | null } | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  // Dismissal is local to this panel; there is no dismissal endpoint, so it resets on reload.
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const [showDismissed, setShowDismissed] = useState(false);
  const flow = useTransformFlow(detail, onDetailChange);

  useEffect(() => {
    let cancelled = false;
    api.getFindings(dataset.id, version.id).then(
      (findings) => !cancelled && setLoaded({ versionId: version.id, findings, error: null }),
      (e) => {
        if (cancelled) return;
        if (e instanceof ApiClientError) setLoaded({ versionId: version.id, findings: null, error: e });
        else throw e;
      },
    );
    return () => {
      cancelled = true;
    };
  }, [dataset.id, version.id, reloadToken]);

  const ready = loaded?.versionId === version.id;
  const findings = ready ? (loaded.findings ?? []) : [];
  const visible = findings.filter((f) => showDismissed || !dismissed.has(f.id));
  const dismissedCount = findings.filter((f) => dismissed.has(f.id)).length;
  const selectedFinding = linked && linked.datasetVersionId === version.id ? linked : null;
  const busy = flow.state.status === "previewing" || flow.state.status === "applying";

  return (
    <div className="flex flex-col gap-4 p-4 text-[13px]">
      {!isCurrentVersion && <UnavailableNote>This is an older version. Findings are shown for it, but changes can only be made to the current version.</UnavailableNote>}
      {flow.state.status === "applied" && (
        <p role="status" className="rounded-md border border-success/30 bg-success-soft px-3 py-2 text-success">
          {flow.state.summary} It is recorded in History and can be undone.
        </p>
      )}

      <section aria-labelledby="findings-heading" className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-2">
          <h3 id="findings-heading" className="text-[12px] font-semibold tracking-wide text-ink-muted uppercase">
            Observed issues
          </h3>
          {ready && findings.length > 0 && (
            <span className="tabular text-[12px] text-ink-muted">
              {visible.length} shown{dismissedCount ? ` · ${dismissedCount} dismissed here` : ""}
            </span>
          )}
        </div>
        {!ready && <ProgressStatus label="Checking this version…" />}
        {ready && loaded.error && (
          <ErrorState
            title="Could not load findings"
            message={loaded.error.message}
            code={loaded.error.code}
            action={
              <Button size="sm" onClick={() => setReloadToken((t) => t + 1)}>
                Try again
              </Button>
            }
          />
        )}
        {ready && !loaded.error && findings.length === 0 && (
          <EmptyState title="No issues observed">The checks found no missing values, repeats, mixed formats, ambiguous dates, or mixed units. This is not a guarantee that the values are correct.</EmptyState>
        )}
        <ul className="flex flex-col gap-2">
          {visible.map((f) => {
            const isSelected = !!selectedFinding && sameIds(selectedFinding.rowIds, f.affectedRowIds) && sameIds(selectedFinding.cellIds, f.affectedCellIds);
            return (
              <li key={f.id} className={cx("rounded-md border px-3 py-2", isSelected ? "border-accent bg-accent-soft/50" : "border-rule", dismissed.has(f.id) && "opacity-60")}>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge tone={SEVERITY_TONE[f.severity]}>{SEVERITY_LABELS[f.severity]}</Badge>
                  <span className="font-semibold text-ink">{FINDING_KIND_LABELS[f.kind]}</span>
                  <span className="tabular ml-auto text-[12px] text-ink-muted">{affectedText(f)}</span>
                </div>
                <p className="mt-1 text-ink">{f.message}</p>
                {f.evidence.length > 0 && (
                  <Disclosure className="mt-2" summary="Evidence">
                    <ul className="list-disc space-y-0.5 pl-4 text-ink-muted">
                      {f.evidence.map((e) => (
                        <li key={e}>{e}</li>
                      ))}
                    </ul>
                  </Disclosure>
                )}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {(f.affectedRowIds.length > 0 || f.affectedCellIds.length > 0) && (
                    <Button
                      size="sm"
                      aria-pressed={isSelected}
                      onClick={() => onLinkedSelect({ origin: "grid", datasetVersionId: version.id, rowIds: f.affectedRowIds, cellIds: f.affectedCellIds, provenanceIds: [] })}
                    >
                      Select affected
                    </Button>
                  )}
                  {f.suggestedOperation && isCurrentVersion && (
                    <Button size="sm" variant={isDestructive(f.suggestedOperation) ? "secondary" : "primary"} disabled={busy} onClick={() => void flow.preview(f.suggestedOperation!)}>
                      {isDestructive(f.suggestedOperation) ? "Preview optional removal" : "Preview fix"}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      const next = new Set(dismissed);
                      if (next.has(f.id)) next.delete(f.id);
                      else next.add(f.id);
                      setDismissed(next);
                    }}
                  >
                    {dismissed.has(f.id) ? "Restore" : "Dismiss"}
                  </Button>
                </div>
                {f.suggestedOperation && (
                  <p className="mt-1 text-[11px] text-ink-faint">Suggested: {describeOperation(f.suggestedOperation, version.columns)}</p>
                )}
              </li>
            );
          })}
        </ul>
        {dismissedCount > 0 && (
          <Button size="sm" variant="ghost" className="self-start" onClick={() => setShowDismissed((s) => !s)}>
            {showDismissed ? "Hide dismissed" : `Show ${dismissedCount} dismissed`}
          </Button>
        )}
        {dismissedCount > 0 && <p className="text-[11px] text-ink-faint">Dismissing hides a finding in this panel only. It is not saved and returns when the page reloads.</p>}
      </section>

      {isCurrentVersion && (
        <section aria-labelledby="ops-heading" className="flex flex-col gap-2 border-t border-rule pt-4">
          <h3 id="ops-heading" className="text-[12px] font-semibold tracking-wide text-ink-muted uppercase">
            Operations
          </h3>
          <p className="text-[12px] text-ink-muted">Each operation shows its actual before/after values first. Nothing changes until you apply it.</p>
          <OperationBuilder key={version.id} columns={version.columns} linked={linked} versionId={version.id} busy={busy} onPreview={(op) => void flow.preview(op)} />
        </section>
      )}

      <PreviewDialog flow={flow} detail={detail} onDetailChange={onDetailChange} />
    </div>
  );
}

function affectedText(f: QualityFinding): string {
  const parts: string[] = [];
  if (f.affectedCellIds.length) parts.push(`${f.affectedCellIds.length} cell${f.affectedCellIds.length === 1 ? "" : "s"}`);
  if (f.affectedRowIds.length) parts.push(`${f.affectedRowIds.length} row${f.affectedRowIds.length === 1 ? "" : "s"}`);
  if (!parts.length && f.affectedColumnIds.length) parts.push(`${f.affectedColumnIds.length} column${f.affectedColumnIds.length === 1 ? "" : "s"}`);
  return parts.join(" · ") || "whole dataset";
}

function sameIds(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((x) => s.has(x));
}
