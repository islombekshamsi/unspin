import type {
  DemoMode,
  PreparedDemoReport,
  ApiErrorBody,
  ApplyTransformRequest,
  ChartQueryRequest,
  ChartQueryResult,
  AnalysisRecord,
  AnalysisConsent,
  CreateAnalysisConsentRequest,
  CreateAnalysisRequest,
  CreateExportRequest,
  CreateSavedViewRequest,
  CsvDelimiter,
  Dataset,
  DatasetDetail,
  DatasetOverview,
  ErrorCode,
  ExportResult,
  Health,
  HistoryResponse,
  Job,
  PreviewTransformRequest,
  QualityFinding,
  RestoreVersionRequest,
  RowsPage,
  RowsQuery,
  SavedView,
  UpdateSavedViewRequest,
  ViewSpec,
  SelectionInput,
  Source,
  SourceSelection,
  StructuredInspection,
  TransformPreview,
} from "@/contracts";

/** Client-side error carrying the server's envelope. Network failures use code "network". */
export class ApiClientError extends Error {
  constructor(
    readonly code: ErrorCode | "network",
    message: string,
    readonly status: number,
    readonly retryable: boolean,
    readonly requestId: string | null,
    readonly details: Record<string, unknown> | undefined,
  ) {
    super(message);
    this.name = "ApiClientError";
  }

  /** For 409 version_conflict responses. */
  get currentVersionId(): string | null {
    const v = this.details?.currentVersionId;
    return typeof v === "string" ? v : null;
  }
}

const BASE = "/api/v1";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { credentials: "same-origin", cache: "no-store", ...init });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new ApiClientError("network", "Could not reach the server. Check your connection and try again.", 0, true, null, undefined);
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON body */
  }
  if (!res.ok) {
    const env = body as ApiErrorBody | null;
    if (env && typeof env === "object" && "error" in env) {
      throw new ApiClientError(env.error.code, env.error.message, res.status, env.error.retryable, env.requestId, env.error.details);
    }
    throw new ApiClientError("internal", `Unexpected server response (${res.status}).`, res.status, res.status >= 500, null, undefined);
  }
  return body as T;
}

function json(method: string, payload: unknown, signal?: AbortSignal): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal };
}

function qs(params: Record<string, string | number | null | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== "") sp.set(k, String(v));
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export const api = {
  prepareDemo: (sourceId: string, mode: DemoMode) => request<{ report: PreparedDemoReport }>(`/sources/${sourceId}/prepared-demo`, json("POST", { mode })).then((r) => r.report),
  getPreparedDemo: (sourceId: string) => request<{ report: PreparedDemoReport | null }>(`/sources/${sourceId}/prepared-demo`).then((r) => r.report),
  health: () => request<{ health: Health }>("/health").then((r) => r.health),

  uploadSource: (file: File, signal?: AbortSignal) => {
    const fd = new FormData();
    fd.set("file", file);
    return request<{ source: Source }>("/sources", { method: "POST", body: fd, signal }).then((r) => r.source);
  },
  listSources: () => request<{ sources: Source[] }>("/sources").then((r) => r.sources),
  getSource: (id: string) => request<{ source: Source }>(`/sources/${id}`).then((r) => r.source),
  deleteSource: (id: string) => request<{ deletedDatasets: number }>(`/sources/${id}`, { method: "DELETE" }),
  /** URL for authorized inline preview (img/pdf.js). */
  sourceContentUrl: (id: string) => `${BASE}/sources/${id}/content`,
  inspectSource: (id: string, opts: { delimiter?: CsvDelimiter; sheetName?: string } = {}) =>
    request<{ inspection: StructuredInspection }>(`/sources/${id}/structure${qs(opts)}`).then((r) => r.inspection),
  listDatasetsForSource: (id: string) => request<{ datasets: Dataset[] }>(`/sources/${id}/datasets`).then((r) => r.datasets),

  createSelection: (sourceId: string, selection: SelectionInput, signal?: AbortSignal) =>
    request<{ selection: SourceSelection }>("/selections", json("POST", { sourceId, selection }, signal)).then((r) => r.selection),
  getSelection: (id: string) => request<{ selection: SourceSelection }>(`/selections/${id}`).then((r) => r.selection),

  createExtraction: (selectionId: string, consentToExternalProcessing: boolean, signal?: AbortSignal, extractionMode?: "chart_table" | "text") =>
    request<{ job: Job }>("/extractions", json("POST", { selectionId, consentToExternalProcessing, extractionMode }, signal)).then((r) => r.job),
  getJob: (id: string) => request<{ job: Job; pollAfterMs: number | null }>(`/jobs/${id}`),
  cancelJob: (id: string) => request<{ job: Job }>(`/jobs/${id}/cancel`, { method: "POST" }).then((r) => r.job),

  getDataset: (id: string, versionId?: string) => request<DatasetDetail>(`/datasets/${id}${qs({ versionId })}`),
  getRows: (id: string, q: RowsQuery, signal?: AbortSignal) =>
    request<RowsPage>(
      `/datasets/${id}/rows${qs({
        versionId: q.versionId,
        cursor: q.cursor ?? undefined,
        limit: q.limit,
        sortColumnId: q.sortColumnId ?? undefined,
        sortDirection: q.sortDirection,
        filterColumnId: q.filterColumnId ?? undefined,
        filterText: q.filterText ?? undefined,
        search: q.search ?? undefined,
        preset: q.preset,
        rowIds: q.rowIds?.join(","),
      })}`,
      { signal },
    ),
  getFindings: (id: string, versionId: string) =>
    request<{ versionId: string; findings: QualityFinding[] }>(`/datasets/${id}/findings${qs({ versionId })}`).then((r) => r.findings),
  previewTransform: (id: string, body: PreviewTransformRequest) =>
    request<{ preview: TransformPreview }>(`/datasets/${id}/transforms/preview`, json("POST", body)).then((r) => r.preview),
  applyTransform: (id: string, body: ApplyTransformRequest) => request<DatasetDetail>(`/datasets/${id}/transforms/apply`, json("POST", body)),
  restoreVersion: (id: string, body: RestoreVersionRequest) => request<DatasetDetail>(`/datasets/${id}/restore`, json("POST", body)),
  getHistory: (id: string) => request<HistoryResponse>(`/datasets/${id}/history`),
  acknowledgeCoverage: (id: string, expectedVersionId: string) =>
    request<{ dataset: Dataset }>(`/datasets/${id}/coverage-ack`, json("POST", { expectedVersionId, acknowledged: true })).then((r) => r.dataset),
  chartQuery: (id: string, body: ChartQueryRequest, signal?: AbortSignal) =>
    request<{ result: ChartQueryResult }>(`/datasets/${id}/chart-query`, json("POST", body, signal)).then((r) => r.result),
  createExport: (id: string, body: CreateExportRequest) =>
    request<{ export: ExportResult }>(`/datasets/${id}/exports`, json("POST", body)).then((r) => r.export),

  getOverview: (id: string, versionId: string, spec: Partial<ViewSpec> = {}, signal?: AbortSignal) =>
    request<{ overview: DatasetOverview }>(
      `/datasets/${id}/overview${qs({
        versionId,
        preset: spec.preset,
        search: spec.search ?? undefined,
        filterColumnId: spec.filterColumnId ?? undefined,
        filterText: spec.filterText ?? undefined,
      })}`,
      { signal },
    ).then((r) => r.overview),
  listViews: (id: string) => request<{ views: SavedView[] }>(`/datasets/${id}/views`).then((r) => r.views),
  createView: (id: string, body: CreateSavedViewRequest) =>
    request<{ view: SavedView }>(`/datasets/${id}/views`, json("POST", body)).then((r) => r.view),
  updateView: (id: string, viewId: string, body: UpdateSavedViewRequest) =>
    request<{ view: SavedView }>(`/datasets/${id}/views/${viewId}`, json("PATCH", body)).then((r) => r.view),
  deleteView: (id: string, viewId: string) => request<{ deleted: boolean }>(`/datasets/${id}/views/${viewId}`, { method: "DELETE" }),
  createAnalysisConsent: (id: string, body: CreateAnalysisConsentRequest) =>
    request<{ consent: AnalysisConsent }>(`/datasets/${id}/analysis/consent`, json("POST", body)).then((r) => r.consent),
  createAnalysis: (id: string, body: CreateAnalysisRequest) =>
    request<{ job: Job }>(`/datasets/${id}/analysis`, json("POST", body)).then((r) => r.job),
  listAnalysis: (id: string) => request<{ records: AnalysisRecord[] }>(`/datasets/${id}/analysis`).then((r) => r.records),
  getAnalysisRecord: (id: string, analysisId: string) =>
    request<{ record: AnalysisRecord }>(`/datasets/${id}/analysis/${analysisId}`).then((r) => r.record),
};

export type Api = typeof api;
