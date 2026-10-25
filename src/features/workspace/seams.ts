import type {
  Dataset,
  DatasetDetail,
  Health,
  Limits,
  Provenance,
  SelectionEvent,
  Source,
  SourceSelection,
} from "@/contracts";

/**
 * Frozen component seams between the coordinator's workspace shell and specialist UIs.
 * Specialists export components with exactly these props from their feature index files.
 * Shared state also flows through useWorkspace() (src/features/workspace/context.tsx).
 */

// --- Ingestion (src/features/ingestion/index.ts) ---------------------------

export interface UploadPanelProps {
  onDemoReady?: (datasetId: string) => void;
  limits: Limits | null;
  /** Called with the server-validated Source after a successful upload. */
  onSourceCreated: (source: Source) => void;
}

export interface SourceSelectorProps {
  source: Source;
  /** Called with the persisted selection returned by POST /selections. */
  onSelectionCreated: (selection: SourceSelection) => void;
  /** User wants to upload a different file. */
  onReplaceSource: () => void;
}

export interface SourceViewerProps {
  source: Source;
  selection: SourceSelection | null;
  provenance: Provenance[];
  /** Provenance ids to highlight/navigate to (from linked selection). */
  activeProvenanceIds: string[];
  /** Emits a linked selection when the user picks a source anchor. */
  onSourceSelect?: (provenanceIds: string[]) => void;
}

// --- Extraction (src/features/extraction/index.ts) -------------------------

export interface ExtractionLauncherProps {
  source: Source;
  selection: SourceSelection;
  gemini: Health["capabilities"]["gemini"] | null;
  onDatasetReady: (datasetId: string) => void;
  onBackToSelection: () => void;
}

export interface CandidateStatusProps {
  detail: DatasetDetail;
  onAcknowledged: (dataset: Dataset) => void;
}

// --- Grid (src/features/grid/index.ts) -------------------------------------

export interface GridView {
  sortColumnId: string | null;
  sortDirection: "asc" | "desc";
  filterColumnId: string | null;
  filterText: string | null;
  search: string | null;
  preset: "all" | "needs_review" | "estimated" | "edited";
  /** Visible columns in display order. */
  columnIds: string[];
}

export interface DataGridProps {
  detail: DatasetDetail;
  /** Edits are only possible when the displayed version is the dataset's current version. */
  isCurrentVersion: boolean;
  linked: SelectionEvent | null;
  onLinkedSelect: (event: SelectionEvent) => void;
  /** Called with the new detail after a committed edit/transform. */
  onDetailChange: (detail: DatasetDetail) => void;
  /** Reports the current view (sort/filter/columns) for "export current view". */
  onViewChange?: (view: GridView) => void;
  /** Opens the source at the given rows/cells. Without it, Show source only links the selection. */
  onShowSource?: (event: SelectionEvent) => void;
  /** Opens cleaning and review for this dataset. */
  onOpenCleaning?: () => void;
  /** False while the grid's tab is hidden; its scroll position is restored when it is shown again. */
  visible?: boolean;
}

// --- Cleaning (src/features/cleaning/index.ts) -----------------------------

export interface QualityPanelProps {
  detail: DatasetDetail;
  isCurrentVersion: boolean;
  linked: SelectionEvent | null;
  onLinkedSelect: (event: SelectionEvent) => void;
  onDetailChange: (detail: DatasetDetail) => void;
}

export interface HistoryPanelProps {
  detail: DatasetDetail;
  onDetailChange: (detail: DatasetDetail) => void;
  /** Display a stored version read-only without making it current. */
  onViewVersion: (versionId: string) => void;
}

// --- Visualization (src/features/visualization/index.ts) -------------------

export interface ChartPanelProps {
  detail: DatasetDetail;
  linked: SelectionEvent | null;
  onLinkedSelect: (event: SelectionEvent) => void;
  /** Opens analysis for the current linked point. Hover never sends a request. */
  onAskSelection?: (event: SelectionEvent) => void;
  /** Shows the selected points' rows in the data table. */
  onShowInData?: (event: SelectionEvent) => void;
  /** Shows the selected points in the original source. */
  onShowSource?: (event: SelectionEvent) => void;
  /** False while the chart's tab is hidden: the plot is not drawn into a zero-size box. */
  visible?: boolean;
}

// --- Comparison (src/features/comparison/index.ts) -------------------------

export interface ComparisonPanelProps {
  /** The dataset currently open; other owned datasets are listed through the API client. */
  detail: DatasetDetail;
}
