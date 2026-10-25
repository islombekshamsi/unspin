import {
  AppError,
  newId,
  type Cell,
  type Column,
  type Coverage,
  type DataType,
  type ExtractionInput,
  type ImportIssue,
  type MissingReason,
  type ParsedDatasetDraft,
  type Provenance,
  type Row,
  type Source,
  type SourceSelection,
} from "@/contracts";
import type { ModelCell, ModelColumn, ModelExtraction, ProviderExtraction } from "@/server/providers/gemini";
import { canonicalizeDecimal, decimalSign } from "./decimal";

export interface DraftContext {
  source: Source;
  selection: SourceSelection;
  input: ExtractionInput;
  result: ProviderExtraction;
  maxRows: number;
  maxColumns: number;
}

const CONTENT_LABEL: Record<ModelExtraction["contentKind"], string> = {
  bar_chart: "Bar chart",
  line_chart: "Line chart",
  scatter_plot: "Scatter plot",
  area_chart: "Area chart",
  pie_chart: "Pie chart",
  table: "Table",
  prose_data: "Data structured from text",
  summary_statistics_plot: "Summary-statistics plot",
  continuous_curve_without_markers: "Continuous curve",
  other_chart: "Figure",
  no_chart_or_table: "Selection",
};

const WARNING_MESSAGE: Record<ModelExtraction["warnings"][number]["kind"], { message: string; severity: ImportIssue["severity"] }> = {
  series_ambiguity: { message: "The model could not tell some series apart; check that values belong to the right series.", severity: "review" },
  unknown_unit: { message: "A unit is not shown or unclear in the source; units were left empty rather than guessed.", severity: "info" },
  clipped_or_cropped: { message: "Part of the figure appears cut off by the selection; some values may be missing.", severity: "review" },
  overlapping_marks: { message: "Some marks overlap; their values may be mixed up or missing.", severity: "review" },
  legend_unclear: { message: "The legend is unclear; check the series labels against the source.", severity: "review" },
  axis_unclear: { message: "An axis scale or label is unclear; estimated values may be off.", severity: "review" },
  too_many_points: { message: "The figure has more marks than can be extracted in one selection.", severity: "review" },
  other: { message: "The model reported something to check.", severity: "info" },
};

const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Rejects status values that mean "nothing extractable", with a specific message. */
function assertExtractable(ex: ModelExtraction, maxRows: number): void {
  if (ex.status === "no_data" || ex.contentKind === "no_chart_or_table") {
    throw new AppError(
      "no_data_found",
      "No chart or table with readable values was found in the selected region. Adjust the selection so it covers one figure or table.",
    );
  }
  if (ex.status === "unreadable") {
    throw new AppError(
      "unreadable_source",
      "The selected region is too unclear to read reliably (for example blurry, very small, or cut off). Select a larger or sharper region.",
    );
  }
  if (ex.status === "unsupported" || (ex.contentKind === "continuous_curve_without_markers" && ex.rows.length === 0)) {
    const message =
      ex.contentKind === "summary_statistics_plot"
        ? "This figure summarizes data (for example a box plot, error bars, or a density). Individual observations cannot be recovered from it, so nothing was extracted."
        : ex.contentKind === "continuous_curve_without_markers"
          ? "This figure shows continuous curves without marked data points. Sampling a curve would invent measurements, so nothing was extracted."
          : "This figure type is not supported for value extraction. Nothing was extracted.";
    throw new AppError("extraction_failed", message);
  }
  if (ex.rows.length === 0) {
    if (ex.warnings.some((w) => w.kind === "too_many_points")) {
      throw new AppError(
        "too_many_rows",
        `The selection contains more marks than the ${maxRows}-row limit for one extraction. Select a smaller part of the figure.`,
      );
    }
    throw new AppError("no_data_found", "The model found no values in the selected region. Adjust the selection or try a clearer source.");
  }
  if (ex.rows.length > maxRows) {
    throw new AppError(
      "too_many_rows",
      `The model returned ${ex.rows.length} rows; the limit for one extraction is ${maxRows}. Select a smaller part of the figure.`,
    );
  }
}

function invalid(message: string): AppError {
  return new AppError("invalid_provider_response", message, { retryable: true });
}

interface ResolvedCell {
  model: ModelCell | null;
  missing: MissingReason | null;
  text: string | null;
  notes: string[];
}

function resolveCell(model: ModelCell | undefined): ResolvedCell {
  if (!model) {
    return { model: null, missing: "unreadable", text: null, notes: ["The model returned no value for this cell."] };
  }
  const notes = model.note?.trim() ? [truncate(model.note.trim(), 1000)] : [];
  const text = model.text;
  if (model.method === "not_read" || text === null) {
    if (model.method !== "not_read") notes.push("The model gave no value here.");
    return { model, missing: model.missingReason ?? "unreadable", text, notes };
  }
  if (text.trim() === "") return { model, missing: "blank", text, notes };
  return { model, missing: null, text, notes };
}

/** Normalized [0,1] box from Gemini's [ymin, xmin, ymax, xmax] in 0..1000, or null if malformed. */
export function normalizeModelBox(box: number[] | null): { x: number; y: number; width: number; height: number } | null {
  if (!box || box.length !== 4 || box.some((v) => !Number.isFinite(v) || v < 0 || v > 1000)) return null;
  const [ymin, xmin, ymax, xmax] = box;
  if (ymin > ymax || xmin > xmax) return null;
  const x = xmin / 1000;
  const y = ymin / 1000;
  const width = Math.min(Math.max(xmax - xmin, 1) / 1000, 1 - x);
  const height = Math.min(Math.max(ymax - ymin, 1) / 1000, 1 - y);
  if (width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}

type ColumnPlan = { column: Column; model: ModelColumn };

function issue(
  kind: ImportIssue["kind"],
  severity: ImportIssue["severity"],
  message: string,
  refs: { rowIds?: string[]; columnIds?: string[]; cellIds?: string[]; evidence?: string[] } = {},
): ImportIssue {
  return {
    kind,
    severity,
    message: truncate(message, 1000),
    rowIds: refs.rowIds ?? [],
    columnIds: refs.columnIds ?? [],
    cellIds: refs.cellIds ?? [],
    evidence: (refs.evidence ?? []).map((e) => truncate(e, 1000)).slice(0, 20),
  };
}

/**
 * Maps a validated model response into a candidate dataset draft, applying the
 * semantic checks. Structural violations reject the whole response; observations
 * a reviewer should see become draft issues. No value is invented or "fixed".
 */
export function buildExtractionDraft(ctx: DraftContext): ParsedDatasetDraft {
  const { source, selection, input, result } = ctx;
  const ex = result.extraction;
  const textMode = !isStructured(selection) && selection.extractionMode === "text";
  if (textMode && (ex.status === "no_data" || ex.rows.length === 0)) {
    throw new AppError("no_data_found", "No explicit numerical observations were found in this text. Select paragraphs containing reported values, dates, or quantities. Numbers will not be invented.");
  }
  if (textMode) validateTextEvidence(ex);
  else if (ex.contentKind === "prose_data") throw invalid("Use Build from text to structure prose. Nothing was saved.");
  assertExtractable(ex, ctx.maxRows);

  if (ex.columns.length === 0) throw invalid("The model returned values without any columns. Nothing was saved.");
  if (ex.columns.length > ctx.maxColumns) {
    throw new AppError("too_many_columns", `The model returned ${ex.columns.length} columns; the limit is ${ctx.maxColumns}.`);
  }
  const keys = new Set<string>();
  for (const c of ex.columns) {
    if (keys.has(c.key)) throw invalid("The model returned two columns with the same key. Nothing was saved.");
    keys.add(c.key);
  }

  const createdAt = new Date().toISOString();
  const issues: ImportIssue[] = [];
  if (textMode) issues.push(issue("extraction_issue", "review", "AI structured explicit statements from prose. Check each value, unit, reporting period, and source quote before reuse. Source quotes are model transcriptions, not independently verified text."));
  const isTable = ex.contentKind === "table" || textMode;

  // Region-level provenance: the user chose this region, so its locator is user-confirmed.
  const regionProv: Provenance = {
    id: newId("prov"),
    sourceId: source.id,
    sourceSelectionId: selection.id,
    locator: input.regionLocator,
    locatorOrigin: "user_confirmed",
    locatorAvailability: "region_only",
    label: selection.kind === "pdf_region" ? `Selected region on page ${selection.pageNumber}` : "Selected image region",
    extractionMethod: "vision_estimate",
    createdAt,
  };
  const provenance: Provenance[] = [regionProv];

  // Resolve every row's cells by column key before typing columns.
  const resolvedRows: Array<{ id: string; cells: Map<string, ResolvedCell> }> = [];
  let filledMissing = 0;
  ex.rows.forEach((row) => {
    const byKey = new Map<string, ModelCell>();
    for (const cell of row.cells) {
      if (!keys.has(cell.column)) throw invalid("The model referred to a column that it did not define. Nothing was saved.");
      if (byKey.has(cell.column)) throw invalid("The model returned two values for the same column in one row. Nothing was saved.");
      byKey.set(cell.column, cell);
    }
    const cells = new Map<string, ResolvedCell>();
    for (const c of ex.columns) {
      const model = byKey.get(c.key);
      if (!model) filledMissing += 1;
      cells.set(c.key, resolveCell(model));
    }
    resolvedRows.push({ id: newId("row"), cells });
  });

  // Column typing: decimal only when every present value is an exact plain decimal.
  const plans: ColumnPlan[] = ex.columns.map((m) => {
    let currency: string | null = null;
    if (m.currency) {
      const code = m.currency.trim().toUpperCase();
      if (/^[A-Z]{3}$/.test(code)) currency = code;
    }
    return {
      model: m,
      column: {
        id: newId("col"),
        label: truncate(m.label.trim() || m.key, 300),
        semanticRole: m.role,
        dataType: "text",
        unit: m.unit?.trim() ? truncate(m.unit.trim(), 64) : null,
        currency,
        percentRepresentation: m.percent,
        datePolicy: null,
        sourceScale: m.axisScale,
        seriesLabel: m.seriesLabel?.trim() ? truncate(m.seriesLabel.trim(), 300) : null,
      },
    };
  });

  const columnTypes = new Map<string, DataType>();
  for (const plan of plans) {
    const present = resolvedRows.map((r) => r.cells.get(plan.model.key)!).filter((c) => c.missing === null);
    let type: DataType = "text";
    if (plan.model.dataType === "number" && plan.model.role !== "identifier" && present.length > 0) {
      type = present.every((c) => canonicalizeDecimal(c.text!) !== null) ? "decimal" : "text";
    } else if (plan.model.dataType === "date" && present.length > 0 && present.every((c) => /^\d{4}-\d{2}-\d{2}$/.test(c.text!.trim()))) {
      type = "date";
      plan.column.datePolicy = { format: "YYYY-MM-DD", timezone: "date_only" };
    }
    plan.column.dataType = type;
    columnTypes.set(plan.model.key, type);
    if (plan.model.currency && !plan.column.currency) {
      issues.push(
        issue("extraction_issue", "info", `Column "${plan.column.label}" shows a currency that is not a standard three-letter code; it was not recorded as a currency.`, {
          columnIds: [plan.column.id],
          evidence: [`Reported currency: ${plan.model.currency}`],
        }),
      );
    }
  }

  // Build rows/cells with provenance.
  const rows: Row[] = [];
  const invalidBoxes: string[] = [];
  const nonNumeric = new Map<string, string[]>();
  const missingCellIds: string[] = [];
  let estimatedCount = 0;
  let transcribedCount = 0;

  resolvedRows.forEach((r, rowIndex) => {
    const cells: Record<string, Cell> = {};
    for (const plan of plans) {
      const rc = r.cells.get(plan.model.key)!;
      const cellId = newId("cell");
      const notes = [...rc.notes];
      if (textMode && rc.model?.sourceQuote) notes.push(`Source quote (model transcription; verify): ${truncate(rc.model.sourceQuote, 900)}`);
      const method = rc.model?.method ?? "not_read";
      const origin: Cell["origin"] =
        method === "transcribed" ? "transcribed" : method === "estimated" ? "estimated" : isTable ? "transcribed" : "estimated";
      if (rc.missing === null) {
        if (origin === "estimated") estimatedCount += 1;
        else transcribedCount += 1;
      }

      const provenanceIds = [regionProv.id];
      if (rc.model?.box) {
        const norm = normalizeModelBox(rc.model.box);
        const locator = norm ? input.mapSentBoxToSource(norm) : null;
        if (!norm) invalidBoxes.push(cellId);
        if (locator) {
          const hint: Provenance = {
            id: newId("prov"),
            sourceId: source.id,
            sourceSelectionId: selection.id,
            locator,
            locatorOrigin: "model_hint",
            locatorAvailability: "region_only",
            label: truncate(`Model-suggested location (unverified) · row ${rowIndex + 1}, ${plan.column.label}`, 500),
            extractionMethod: "vision_estimate",
            createdAt,
          };
          provenance.push(hint);
          provenanceIds.push(hint.id);
        }
      }

      let currentValue: string | null = null;
      let valueType: DataType = plan.column.dataType;
      if (rc.missing !== null) {
        missingCellIds.push(cellId);
      } else if (plan.column.dataType === "decimal") {
        const canonical = canonicalizeDecimal(rc.text!)!;
        currentValue = canonical.value;
        if (canonical.note) notes.push(canonical.note);
      } else {
        currentValue = plan.column.dataType === "date" ? rc.text!.trim() : rc.text!;
        valueType = plan.column.dataType;
        if (plan.model.dataType === "number" && plan.model.role !== "identifier" && canonicalizeDecimal(rc.text!) === null) {
          notes.push(`Kept as text: "${truncate(rc.text!, 80)}" needs an explicit numeric interpretation (separators, %, currency, or symbols).`);
          const list = nonNumeric.get(plan.column.id) ?? [];
          list.push(cellId);
          nonNumeric.set(plan.column.id, list);
        }
      }

      cells[plan.column.id] = {
        id: cellId,
        rawText: rc.text,
        currentValue,
        valueType,
        missingReason: rc.missing,
        origin,
        reviewStatus: "unreviewed",
        provenanceIds,
        parentCellIds: [],
        notes,
      };
    }
    rows.push({ id: r.id, sourceOrder: rowIndex, cells });
  });

  const columns = plans.map((p) => p.column);

  // --- Semantic observations -------------------------------------------------
  if (filledMissing > 0) {
    issues.push(
      issue("extraction_issue", "review", `The model left out ${filledMissing} value(s); those cells are marked missing (unreadable), not filled in.`),
    );
  }
  if (missingCellIds.length > 0) {
    issues.push(issue("missing_values", "info", `${missingCellIds.length} value(s) could not be read and are marked missing.`, { cellIds: missingCellIds }));
  }
  for (const [columnId, cellIds] of nonNumeric) {
    const col = columns.find((c) => c.id === columnId)!;
    issues.push(
      issue(
        "mixed_numeric_format",
        "review",
        `Column "${col.label}" has ${cellIds.length} value(s) that are not plain numbers, so the whole column is kept as text. Parse it with an explicit rule if needed.`,
        { columnIds: [columnId], cellIds },
      ),
    );
  }
  if (invalidBoxes.length > 0) {
    issues.push(
      issue("extraction_issue", "info", `${invalidBoxes.length} model-suggested source location(s) were malformed and were discarded.`, { cellIds: invalidBoxes }),
    );
  }

  const valueColumns = plans.filter((p) => p.column.semanticRole === "y" || p.column.semanticRole === "x" || p.column.semanticRole === "uncertainty");
  for (const p of valueColumns) {
    const c = p.column;
    if (c.dataType === "decimal" && !c.unit && !c.currency && !c.percentRepresentation) {
      issues.push(issue("extraction_issue", "info", `No unit is shown for "${c.label}". Add one if the source states it elsewhere.`, { columnIds: [c.id] }));
    }
    if (c.sourceScale === "log") {
      const bad = rows
        .map((r) => r.cells[c.id])
        .filter((cell) => cell.valueType === "decimal" && cell.currentValue !== null && decimalSign(cell.currentValue as string) <= 0);
      if (bad.length > 0) {
        issues.push(
          issue(
            "extraction_issue",
            "review",
            `"${c.label}" is on a logarithmic axis, but ${bad.length} value(s) are zero or negative, which a log axis cannot show. These readings are likely wrong.`,
            { columnIds: [c.id], cellIds: bad.map((x) => x.id) },
          ),
        );
      }
    }
  }

  const yCols = plans.filter((p) => p.column.semanticRole === "y").map((p) => p.column);
  const units = new Set(yCols.map((c) => c.unit ?? (c.percentRepresentation ? "%" : c.currency ?? "")).filter((u) => u !== ""));
  if (units.size > 1) {
    issues.push(
      issue("mixed_units", "review", `The value columns use different units (${[...units].join(", ")}). Do not compare them directly without checking.`, {
        columnIds: yCols.map((c) => c.id),
      }),
    );
  }
  if (yCols.length > 1) {
    const labels = yCols.map((c) => (c.seriesLabel ?? "").toLowerCase());
    if (labels.some((l) => l === "") || new Set(labels).size !== labels.length) {
      issues.push(
        issue("extraction_issue", "review", "Several value columns are not clearly tied to distinct series in the legend. Check which series each column represents.", {
          columnIds: yCols.map((c) => c.id),
        }),
      );
    }
  }

  // Duplicate x within one series (long format uses a category column as the series key).
  const xCol = plans.find((p) => p.column.semanticRole === "x") ?? plans.find((p) => p.column.semanticRole === "category");
  if (xCol && yCols.length > 0) {
    const seriesCol = plans.find((p) => p.column.semanticRole === "category" && p !== xCol);
    const seen = new Map<string, string>();
    const dupRows = new Set<string>();
    for (const row of rows) {
      const x = row.cells[xCol.column.id];
      if (x.currentValue === null) continue;
      const seriesKey = seriesCol ? String(row.cells[seriesCol.column.id].currentValue ?? "") : "";
      const key = `${seriesKey}\u0000${String(x.currentValue)}`;
      const first = seen.get(key);
      if (first) {
        dupRows.add(first);
        dupRows.add(row.id);
      } else seen.set(key, row.id);
    }
    if (dupRows.size > 0) {
      const scatter = ex.contentKind === "scatter_plot";
      issues.push(
        issue(
          "repeated_rows",
          scatter ? "info" : "review",
          scatter
            ? `${dupRows.size} points share an x value within the same series. That can be genuine in a scatter plot; check against the source.`
            : `${dupRows.size} rows repeat the same ${xCol.column.label} value within one series. Check for double-read marks.`,
          { rowIds: [...dupRows], columnIds: [xCol.column.id] },
        ),
      );
    }
  }

  if (ex.contentKind === "summary_statistics_plot") {
    issues.push(
      issue("extraction_issue", "review", "These are plotted summary values (for example means), not individual observations. Keep that in mind before reuse."),
    );
  }

  for (const w of ex.warnings) {
    const t = WARNING_MESSAGE[w.kind];
    issues.push(issue("extraction_issue", t.severity, t.message, { evidence: [`Model note: ${w.message}`] }));
  }

  // --- Coverage ---------------------------------------------------------------
  let coverage: Coverage = "complete_selection";
  const noteParts: string[] = [];
  if (ex.status === "partial" || ex.coverage === "partial") {
    coverage = "partial_selection";
    const reason = ex.coverageNote?.trim() || ex.statusExplanation?.trim();
    noteParts.push(reason ? truncate(reason, 1200) : "The model reported that it could not read every value in the selection but did not say which were omitted.");
  }
  if (result.truncated) {
    coverage = "partial_selection";
    noteParts.push("The model's output reached its length limit, so later values may be missing.");
  }
  if (coverage === "complete_selection" && ex.warnings.some((w) => w.kind === "clipped_or_cropped" || w.kind === "too_many_points")) {
    coverage = "uncertain";
    noteParts.push("The model reported that part of the figure may be cut off or too dense to read completely.");
  }
  const coverageNote = coverage === "complete_selection" ? null : truncate(noteParts.join(" "), 2000);
  if (coverage !== "complete_selection") {
    issues.push(issue("partial_coverage", "review", coverage === "partial_selection" ? "This extraction is partial." : "This extraction may be incomplete.", {
      evidence: coverageNote ? [coverageNote] : [],
    }));
  }

  // --- Title and description ---------------------------------------------------
  const kind = CONTENT_LABEL[ex.contentKind];
  const visible = ex.visibleTitle?.replace(/\s+/g, " ").trim();
  const title = truncate(visible || `${kind} from ${source.filename}`, 300);
  const sent =
    input.disclosure === "whole_pdf_with_page_hint"
      ? `the whole PDF with a hint to page ${input.pageHint ?? "?"}`
      : input.disclosure === "rendered_pdf_region"
        ? "a rendered image of the selected PDF region"
        : "the selected image region";
  const methodText = textMode
    ? "Explicit values in prose were transcribed into a new table by a vision model. Source quotes are unverified transcriptions; no values were inferred or calculated. The chart displays this reconstructed table, not a chart from the original document."
    : isTable
    ? "Table text was transcribed by a vision model from an image (no text-layer path was used); check it against the source."
    : `Chart values were read from an image by a vision model: ${estimatedCount} estimated from mark positions, ${transcribedCount} transcribed from printed text such as labels or categories. Estimates are approximate.`;
  const description = truncate(
    `${kind} extracted from ${sent} of ${source.filename} with Google Gemini (${result.model}, prompt ${result.promptVersion}). ${methodText}`,
    2000,
  );

  return {
    title,
    description,
    extractionMethod: "vision_estimate",
    coverage,
    coverageNote,
    extraction: {
      provider: "gemini",
      model: result.model,
      promptVersion: result.promptVersion,
      inputDisclosure: input.disclosure,
      requestedAt: result.requestedAt,
    },
    columns,
    rows,
    provenance,
    issues,
  };
}


function isStructured(selection: SourceSelection): selection is Extract<SourceSelection, { kind: "csv_records" | "xlsx_range" }> {
  return selection.kind === "csv_records" || selection.kind === "xlsx_range";
}

/** A prose cell cannot use an inferred value or a quote that lacks its literal text. */
export function validateTextEvidence(ex: ModelExtraction): void {
  if (ex.contentKind !== "prose_data") throw invalid("The model did not return a text-derived table. Nothing was saved.");
  const numericKeys = new Set(ex.columns.filter((c) => c.dataType === "number" && c.role !== "identifier").map((c) => c.key));
  let numericCount = 0;
  const normalize = (s: string) => s.normalize("NFKC").replace(/\s+/g, " ").trim();
  for (const row of ex.rows) {
    for (const cell of row.cells) {
      if (cell.text === null || cell.method === "not_read") continue;
      if (cell.method !== "transcribed" || !cell.sourceQuote?.trim()) {
        throw invalid("A text-derived value was inferred or lacked a supporting source quote. Nothing was saved.");
      }
      const value = normalize(cell.text);
      const quote = normalize(cell.sourceQuote);
      if (!value || !quote.includes(value)) throw invalid("A text-derived value did not match its supporting quote. Nothing was saved.");
      if (numericKeys.has(cell.column)) {
        const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        if (!new RegExp(`(?<![\\d.])${escaped}(?![\\d.])`).test(quote)) {
          throw invalid("A number did not match a complete value in its source quote. Nothing was saved.");
        }
        numericCount += 1;
      }
    }
  }
  if (numericCount === 0) throw new AppError("no_data_found", "The selected text has no explicit numerical observations suitable for a chart. No numbers were invented.");
}
