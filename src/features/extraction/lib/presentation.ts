import type { Dataset, ExtractionMethod, Job, Source, SourceSelection } from "@/contracts";

/** Plain-language statement of exactly what leaves the server for this selection. */
export interface SentInputDescription {
  external: boolean;
  /** One sentence naming what is sent. */
  what: string;
  /** What is explicitly not sent. */
  notSent: string | null;
  /** True when more than the selected region is sent. */
  wholeFile: boolean;
}

const px = (w: number, h: number) => `${w.toLocaleString("en-US")} × ${h.toLocaleString("en-US")} px`;

export function describeSentInput(source: Source, selection: SourceSelection): SentInputDescription {
  switch (selection.kind) {
    case "csv_records":
    case "xlsx_range":
      return { external: false, what: "Nothing is sent outside this server.", notSent: null, wholeFile: false };
    case "image_region": {
      const t = selection.transform;
      const b = t.orientedPixelBox;
      const whole = b.left === 0 && b.top === 0 && b.width === t.orientedWidth && b.height === t.orientedHeight;
      return {
        external: true,
        what: whole
          ? `The whole image (${px(b.width, b.height)}), because the selection covers all of it.`
          : `Only the selected region: a ${px(b.width, b.height)} crop of the ${px(t.orientedWidth, t.orientedHeight)} image.`,
        notSent: whole ? null : "The rest of the image is not sent.",
        wholeFile: false,
      };
    }
    case "pdf_region": {
      if (source.processingDisclosure === "gemini_whole_file") {
        return {
          external: true,
          what: `The whole PDF file${source.pageCount ? ` (${source.pageCount} pages)` : ""}, with an instruction to read only page ${selection.pageNumber}.`,
          notSent: null,
          wholeFile: true,
        };
      }
      const size = selection.transform.renderedPixelSize;
      const sizeText = size ? ` (${px(size.width, size.height)})` : "";
      return {
        external: true,
        what:
          selection.region === null
            ? `An image of page ${selection.pageNumber}${sizeText}, rendered from the PDF.`
            : `An image of the selected region on page ${selection.pageNumber}${sizeText}, rendered from the PDF.`,
        notSent: "The PDF file itself and its other pages are not sent.",
        wholeFile: false,
      };
    }
  }
}

export function describeStructuredSelection(selection: SourceSelection): string {
  if (selection.kind === "csv_records") {
    const delim = { ",": "comma", ";": "semicolon", "\t": "tab", "|": "pipe" }[selection.delimiter];
    const cols = selection.selectedColumnIndexes ? `${selection.selectedColumnIndexes.length} selected columns` : "all columns";
    const recs = selection.recordInterval
      ? `records ${selection.recordInterval.start + 1}–${selection.recordInterval.endExclusive}`
      : "all records";
    return `CSV, ${delim}-separated, ${selection.headerRecordCount ? "first record as header" : "no header record"}, ${cols}, ${recs}.`;
  }
  if (selection.kind === "xlsx_range") {
    return `Sheet “${selection.sheetName}”, ${selection.range ?? "used range"}, ${selection.headerRowCount ? "first row as header" : "no header row"}.`;
  }
  return "";
}

const STAGE_LABEL: Record<Job["stage"], string> = {
  queued: "Queued — waiting to start",
  preparing_input: "Preparing the selected region",
  awaiting_provider: "Waiting for the model",
  validating: "Checking the extracted values",
  committing: "Saving the dataset",
  finished: "Finishing",
};

export function stageLabel(job: Job): string {
  return STAGE_LABEL[job.stage];
}

export interface ErrorView {
  title: string;
  /** Extra guidance shown under the server's message. */
  hint: string | null;
  canRetry: boolean;
  suggestAdjust: boolean;
}

/** Specific presentation per error code. The server's message is always shown as-is. */
export function errorView(code: string, retryable: boolean): ErrorView {
  switch (code) {
    case "not_configured":
      return {
        title: "Extraction is not available on this server",
        hint: "This is a server setting; it cannot be fixed from this page. CSV and XLSX import still work.",
        canRetry: false,
        suggestAdjust: false,
      };
    case "provider_quota":
      return { title: "Model quota exhausted", hint: "Nothing was saved. Try again later.", canRetry: true, suggestAdjust: false };
    case "rate_limited":
      return { title: "Too many requests right now", hint: "Wait a minute, then retry.", canRetry: true, suggestAdjust: false };
    case "timeout":
      return { title: "The model took too long", hint: "Retry, or select a smaller region.", canRetry: true, suggestAdjust: true };
    case "no_data_found":
      return { title: "No data found in this region", hint: "Select a region that contains one chart or table.", canRetry: false, suggestAdjust: true };
    case "unreadable_source":
      return { title: "The region could not be read", hint: "Select a larger or sharper region.", canRetry: false, suggestAdjust: true };
    case "extraction_failed":
      return { title: "This figure can't be extracted", hint: null, canRetry: false, suggestAdjust: true };
    case "too_many_rows":
      return { title: "Too many values for one extraction", hint: "Select a smaller part of the figure.", canRetry: false, suggestAdjust: true };
    case "too_many_columns":
      return { title: "Too many columns", hint: "Select a smaller part of the table.", canRetry: false, suggestAdjust: true };
    case "invalid_provider_response":
      return { title: "The model returned an unusable response", hint: "Nothing was saved. Retrying may work.", canRetry: true, suggestAdjust: true };
    case "semantic_validation_failed":
      return { title: "The extracted data failed checks", hint: "Nothing was saved.", canRetry: true, suggestAdjust: true };
    case "provider_failure":
      return { title: "The model service had a problem", hint: null, canRetry: retryable, suggestAdjust: false };
    case "not_found":
      return {
        title: "The selection is no longer available",
        hint: "The server may have restarted. Make the selection again.",
        canRetry: false,
        suggestAdjust: true,
      };
    case "consent_required":
      return { title: "Confirmation needed", hint: "Tick the confirmation box before starting.", canRetry: false, suggestAdjust: false };
    case "network":
      return {
        title: "Lost contact with the server",
        hint: "If processing had started, retrying picks up the same request instead of starting a new one.",
        canRetry: true,
        suggestAdjust: false,
      };
    default:
      return { title: "Processing failed", hint: null, canRetry: retryable, suggestAdjust: true };
  }
}

export function methodStatus(method: ExtractionMethod): { label: string; tone: "estimate" | "neutral"; detail: string } {
  switch (method) {
    case "vision_estimate":
      return { label: "Extracted estimates", tone: "estimate", detail: "Review against the source before use." };
    case "pdf_text":
      return { label: "Transcribed from PDF text", tone: "estimate", detail: "Check against the source before use." };
    case "pdf_vector":
      return { label: "Read from PDF graphics", tone: "estimate", detail: "Check against the source before use." };
    case "deterministic_parser":
      return { label: "Imported with the local parser", tone: "neutral", detail: "Values are the file's own text; types were not guessed." };
    case "manual":
      return { label: "Entered manually", tone: "neutral", detail: "" };
  }
}

export function coverageStatus(dataset: Dataset): { label: string; needsAck: boolean } {
  if (dataset.coverage === "complete_selection") return { label: "Covers the whole selection", needsAck: false };
  const label = dataset.coverage === "partial_selection" ? "Partial extraction" : "Coverage uncertain";
  return { label, needsAck: dataset.coverageAcknowledgedAt === null };
}

export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
