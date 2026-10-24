"use client";

import { UnavailableNote } from "@/components/ui";
import type { ChartPanelProps } from "@/features/workspace/seams";

// Placeholder until the Visualization specialist implements this seam.
export function ChartPanel(props: ChartPanelProps) {
  void props;
  return <UnavailableNote className="m-4">Charts are not implemented yet.</UnavailableNote>;
}
