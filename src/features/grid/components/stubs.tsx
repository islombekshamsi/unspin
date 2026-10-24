"use client";

import { UnavailableNote } from "@/components/ui";
import type { DataGridProps } from "@/features/workspace/seams";

// Placeholder until the Cleaning/Grid specialist implements this seam.
export function DataGrid(props: DataGridProps) {
  void props;
  return <UnavailableNote className="m-4">The data grid is not implemented yet.</UnavailableNote>;
}
