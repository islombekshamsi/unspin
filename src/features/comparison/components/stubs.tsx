"use client";

import { UnavailableNote } from "@/components/ui";
import type { ComparisonPanelProps } from "@/features/workspace/seams";

// Placeholder until the Visualization specialist implements this seam.
export function ComparisonPanel(props: ComparisonPanelProps) {
  void props;
  return <UnavailableNote className="m-4">Comparison is not implemented yet.</UnavailableNote>;
}
