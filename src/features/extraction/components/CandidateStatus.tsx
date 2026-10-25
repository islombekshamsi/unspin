"use client";

import { useState } from "react";
import { Badge, Button, Disclosure } from "@/components/ui";
import type { CandidateStatusProps } from "@/features/workspace/seams";
import { ApiClientError, api } from "@/lib/api/client";
import { coverageStatus, methodStatus } from "../lib/presentation";

const DISCLOSURE_TEXT = {
  selected_image_region: "selected image region sent",
  rendered_pdf_region: "rendered PDF region sent",
  whole_pdf_with_page_hint: "whole PDF sent with a page hint",
} as const;

const SEVERITY_LABEL = { blocking: "Blocking", review: "Review", info: "Note" } as const;

export function CandidateStatus({ detail, onAcknowledged }: CandidateStatusProps) {
  const { dataset, version } = detail;
  const method = dataset.extraction?.promptVersion === "text-data-v1"
    ? { tone: "estimate" as const, label: "Structured from text — review required", detail: "AI transcribed explicit statements into a table. Source quotes are model transcriptions; verify them against the selected page. The displayed chart was built from this table." }
    : methodStatus(dataset.extractionMethod);
  const coverage = coverageStatus(dataset);
  const [acking, setAcking] = useState(false);
  const [ackError, setAckError] = useState<string | null>(null);
  const summary = version.reviewSummary;
  const issues = dataset.importIssues;
  const reviewCount = issues.filter((i) => i.severity !== "info").length;

  async function acknowledge() {
    setAcking(true);
    setAckError(null);
    try {
      onAcknowledged(await api.acknowledgeCoverage(dataset.id, dataset.currentVersionId));
    } catch (e) {
      setAckError(
        e instanceof ApiClientError && e.code === "version_conflict"
          ? "The dataset changed since it was opened. Reload it, then acknowledge again."
          : e instanceof ApiClientError
            ? e.message
            : "Could not record the acknowledgement.",
      );
    } finally {
      setAcking(false);
    }
  }

  return (
    <section aria-label="Extraction status" className="flex flex-col gap-1 text-[13px] leading-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Badge tone={method.tone}>{method.label}</Badge>
        {dataset.coverage === "complete_selection" && <span className="text-[12px] text-ink-muted">{coverage.label}</span>}
        {version.unresolvedFindingCount > 0 && (
          <span className="text-[12px] text-ink-muted">
            {version.unresolvedFindingCount} finding{version.unresolvedFindingCount === 1 ? "" : "s"} to review
          </span>
        )}
        {dataset.extraction && (
          <span className="text-[12px] text-ink-faint">
            Gemini · <span className="font-mono">{dataset.extraction.model}</span> · prompt{" "}
            <span className="font-mono">{dataset.extraction.promptVersion}</span> · {DISCLOSURE_TEXT[dataset.extraction.inputDisclosure]}
          </span>
        )}
      </div>

      {dataset.coverage !== "complete_selection" && (
        <div
          role={coverage.needsAck ? "alert" : undefined}
          className="flex flex-col gap-2 rounded-md border border-estimate-rule bg-estimate-soft px-3 py-2 sm:flex-row sm:items-start sm:justify-between"
        >
          <div className="min-w-0">
            <p className="font-semibold text-estimate">{coverage.label}</p>
            {dataset.coverageNote && <p className="mt-0.5 break-words text-ink">{dataset.coverageNote}</p>}
            {dataset.coverageAcknowledgedAt && (
              <p className="mt-0.5 text-[12px] text-ink-muted">You acknowledged this on {new Date(dataset.coverageAcknowledgedAt).toLocaleString()}.</p>
            )}
            {ackError && (
              <p className="mt-1 text-[12px] text-danger" role="alert">
                {ackError}
              </p>
            )}
          </div>
          {coverage.needsAck && (
            <Button size="sm" onClick={() => void acknowledge()} loading={acking} className="shrink-0 self-start">
              I understand it is incomplete
            </Button>
          )}
        </div>
      )}

      <Disclosure
        summary="Import details"
        className="text-[12px] text-ink-muted"
      >
        {method.detail && <p className="text-ink-muted">{method.detail}</p>}
        <p className="tabular text-ink-muted">
          {summary.unreviewed.toLocaleString()} of {summary.cellsTotal.toLocaleString()} values have not been manually reviewed
          {summary.accepted > 0 ? ` · ${summary.accepted.toLocaleString()} accepted` : ""}
          {summary.corrected > 0 ? ` · ${summary.corrected.toLocaleString()} corrected` : ""}
          {summary.unavailable > 0 ? ` · ${summary.unavailable.toLocaleString()} unavailable` : ""}. That is not a detected error.
        </p>
        {issues.length === 0 ? (
          <p className="mt-1">No import notes.</p>
        ) : null}
      </Disclosure>

      {issues.length > 0 && (
        <Disclosure
          summary={
            <span>
              {issues.length} import note{issues.length === 1 ? "" : "s"}
              {reviewCount > 0 ? ` · ${reviewCount} to review` : ""}
            </span>
          }
        >
          <ul className="flex flex-col gap-1.5">
            {issues.map((issue, i) => (
              <li key={i} className="flex gap-2">
                <Badge tone={issue.severity === "info" ? "neutral" : issue.severity === "blocking" ? "danger" : "estimate"} className="shrink-0 self-start">
                  {SEVERITY_LABEL[issue.severity]}
                </Badge>
                <span className="min-w-0 break-words text-ink">
                  {issue.message}
                  {issue.evidence.length > 0 && <span className="block text-[12px] text-ink-muted">{issue.evidence.join(" · ")}</span>}
                </span>
              </li>
            ))}
          </ul>
        </Disclosure>
      )}
    </section>
  );
}
