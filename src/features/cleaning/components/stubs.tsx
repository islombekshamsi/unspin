"use client";

import { UnavailableNote } from "@/components/ui";
import type { HistoryPanelProps, QualityPanelProps } from "@/features/workspace/seams";

// Placeholders until the Cleaning/Grid specialist implements these seams.
export function QualityPanel(props: QualityPanelProps) {
  void props;
  return <UnavailableNote className="m-4">Data-quality review is not implemented yet.</UnavailableNote>;
}
export function HistoryPanel(props: HistoryPanelProps) {
  void props;
  return <UnavailableNote className="m-4">History is not implemented yet.</UnavailableNote>;
}
