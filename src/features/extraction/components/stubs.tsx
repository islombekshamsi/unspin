"use client";

import { UnavailableNote } from "@/components/ui";
import type { CandidateStatusProps, ExtractionLauncherProps } from "@/features/workspace/seams";

// Placeholders until the Extraction specialist implements these seams.
export function ExtractionLauncher(props: ExtractionLauncherProps) {
  void props;
  return <UnavailableNote>Processing is not implemented yet.</UnavailableNote>;
}
export function CandidateStatus(props: CandidateStatusProps) {
  void props;
  return null;
}
