"use client";

import { UnavailableNote } from "@/components/ui";
import type { SourceSelectorProps, SourceViewerProps, UploadPanelProps } from "@/features/workspace/seams";

// Placeholders until the Ingestion specialist implements these seams.
export function UploadPanel(props: UploadPanelProps) {
  void props;
  return <UnavailableNote>Upload is not implemented yet.</UnavailableNote>;
}
export function SourceSelector(props: SourceSelectorProps) {
  void props;
  return <UnavailableNote>Source selection is not implemented yet.</UnavailableNote>;
}
export function SourceViewer(props: SourceViewerProps) {
  void props;
  return <UnavailableNote>Source preview is not implemented yet.</UnavailableNote>;
}
