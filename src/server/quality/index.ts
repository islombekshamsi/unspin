import type { Dataset, DatasetVersionSnapshot, QualityFinding } from "@/contracts";

/**
 * Quality service seam (owner: Cleaning specialist).
 * Findings are questions for review, never automatic fixes. Ids must be
 * deterministic for (versionId, kind, affected ids) so they are stable across requests.
 */
export function computeFindings(dataset: Dataset, snapshot: DatasetVersionSnapshot): QualityFinding[] {
  void dataset;
  void snapshot;
  return [];
}
