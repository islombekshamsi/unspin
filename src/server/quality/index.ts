import { createHash } from "node:crypto";
import type {
  Cell,
  Column,
  Dataset,
  DatasetVersionSnapshot,
  FindingKind,
  FindingSeverity,
  QualityFinding,
  Row,
  TransformOperation,
} from "@/contracts";
import { dayMonthReadings } from "@/server/transforms/dates";
import { detectCurrencyMarker, numericShape, SHAPE_LABELS, type NumericShape } from "@/server/transforms/numeric";
import { duplicateKey } from "@/server/transforms";

/**
 * Quality service seam (owner: Cleaning specialist).
 * Findings are questions for review, never automatic fixes. Ids are deterministic for
 * (versionId, kind, discriminator, affected ids) so they are stable across requests.
 * A suggested operation is attached only when one precise allowlisted operation exists;
 * the user still previews it before anything changes.
 */

const SEVERITY_ORDER: Record<FindingSeverity, number> = { blocking: 0, review: 1, info: 2 };
const MAX_EXAMPLES = 3;

/** Text that commonly stands for "no value". Matched exactly (case-sensitive) so suggestions stay precise. */
const PLACEHOLDER_TOKENS = new Set(["NA", "N/A", "n/a", "na", "NaN", "nan", "null", "NULL", "None", "none", "-", "--", "—", "–", "..", "...", "?", "nd", "n.d.", "ND", "#N/A", "missing"]);

interface Draft {
  kind: FindingKind;
  /** Distinguishes several findings of the same kind on the same ids. */
  discriminator: string;
  severity: FindingSeverity;
  message: string;
  rowIds: string[];
  columnIds: string[];
  cellIds: string[];
  evidence: string[];
  suggestedOperation: TransformOperation | null;
}

export function findingId(versionId: string, d: Pick<Draft, "kind" | "discriminator" | "rowIds" | "columnIds" | "cellIds">): string {
  const h = createHash("sha256")
    .update([versionId, d.kind, d.discriminator, [...d.rowIds].sort().join(","), [...d.columnIds].sort().join(","), [...d.cellIds].sort().join(",")].join("\n"))
    .digest("hex");
  return `fnd_${h.slice(0, 40)}`;
}

const quote = (s: string) => `“${s.length > 60 ? `${s.slice(0, 57)}…` : s}”`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const textOf = (cell: Cell) => (typeof cell.currentValue === "string" ? cell.currentValue : null);
const isTextLike = (cell: Cell) => cell.valueType === "text" || cell.valueType === "unknown";

export function computeFindings(dataset: Dataset, snapshot: DatasetVersionSnapshot): QualityFinding[] {
  const { version, rows } = snapshot;
  const drafts: Draft[] = [];
  const columns = version.columns;

  for (const column of columns) {
    const cells = rows.map((row) => ({ row, cell: row.cells[column.id] as Cell | undefined }));
    drafts.push(...missingFindings(column, cells, rows.length));
    drafts.push(...numericFormatFindings(column, cells));
    drafts.push(...dateFindings(column, cells));
    drafts.push(...unitFindings(column, cells));
    drafts.push(...typeMismatchFindings(column, cells));
  }
  drafts.push(...repeatedRowFindings(columns, rows));
  drafts.push(...estimateFindings(columns, rows));
  drafts.push(...importIssueFindings(dataset, snapshot));
  drafts.push(...coverageFindings(dataset));

  const colOrder = new Map(columns.map((c, i) => [c.id, i]));
  const firstCol = (d: Draft) => Math.min(...d.columnIds.map((id) => colOrder.get(id) ?? columns.length), columns.length);
  return drafts
    .map((d, i) => ({ d, i }))
    .sort((a, b) => SEVERITY_ORDER[a.d.severity] - SEVERITY_ORDER[b.d.severity] || firstCol(a.d) - firstCol(b.d) || a.i - b.i)
    .map(({ d }) => ({
      id: findingId(version.id, d),
      datasetVersionId: version.id,
      kind: d.kind,
      severity: d.severity,
      message: d.message.slice(0, 1000),
      affectedRowIds: d.rowIds,
      affectedColumnIds: d.columnIds,
      affectedCellIds: d.cellIds,
      evidence: d.evidence.map((e) => e.slice(0, 1000)),
      suggestedOperation: d.suggestedOperation,
      dismissedAt: null,
    }));
}

type ColumnCells = Array<{ row: Row; cell: Cell | undefined }>;

// ---------------------------------------------------------------------------
// Missing values and placeholder text
// ---------------------------------------------------------------------------

function missingFindings(column: Column, cells: ColumnCells, rowCount: number): Draft[] {
  const out: Draft[] = [];
  const missing = cells.filter(({ cell }) => !cell || cell.currentValue === null);
  if (missing.length > 0) {
    const reasons = new Map<string, number>();
    for (const { cell } of missing) {
      const r = cell ? (cell.missingReason ?? "blank") : "no cell";
      reasons.set(r, (reasons.get(r) ?? 0) + 1);
    }
    out.push({
      kind: "missing_values",
      discriminator: "null",
      severity: "info",
      message: `${missing.length} of ${rowCount} values in ${quote(column.label)} are missing. They stay missing (never zero) in charts and exports.`,
      rowIds: missing.map(({ row }) => row.id),
      columnIds: [column.id],
      cellIds: missing.flatMap(({ cell }) => (cell ? [cell.id] : [])),
      evidence: [...reasons].map(([r, n]) => `${n} marked ${r.replace("_", " ")}`),
      suggestedOperation: null,
    });
  }

  const placeholders = new Map<string, Array<{ row: Row; cell: Cell }>>();
  const blanks = new Map<string, Array<{ row: Row; cell: Cell }>>();
  for (const { row, cell } of cells) {
    if (!cell || !isTextLike(cell)) continue;
    const t = textOf(cell);
    if (t === null) continue;
    const bucket = t.trim() === "" ? blanks : PLACEHOLDER_TOKENS.has(t.trim()) ? placeholders : null;
    if (!bucket) continue;
    bucket.set(t, [...(bucket.get(t) ?? []), { row, cell }]);
  }
  for (const [bucket, reason, discriminator] of [
    [placeholders, "not_reported", "placeholder"],
    [blanks, "blank", "empty_text"],
  ] as const) {
    if (bucket.size === 0) continue;
    const all = [...bucket.values()].flat();
    const tokens = [...bucket.keys()].filter((t) => t.length <= 64).slice(0, 32);
    out.push({
      kind: "missing_values",
      discriminator,
      severity: "review",
      message:
        discriminator === "placeholder"
          ? `${plural(all.length, "value")} in ${quote(column.label)} ${all.length === 1 ? "is" : "are"} text that often means “no value” but ${all.length === 1 ? "is" : "are"} not marked missing.`
          : `${plural(all.length, "value")} in ${quote(column.label)} ${all.length === 1 ? "is" : "are"} empty or whitespace-only text, not marked missing.`,
      rowIds: all.map(({ row }) => row.id),
      columnIds: [column.id],
      cellIds: all.map(({ cell }) => cell.id),
      evidence: [...bucket].map(([t, list]) => `${JSON.stringify(t)} appears ${plural(list.length, "time")}`),
      suggestedOperation:
        tokens.length > 0
          ? { type: "mark_missing", columnId: column.id, explicitTokens: tokens, rowIds: null, missingReason: reason }
          : null,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Numeric text formats
// ---------------------------------------------------------------------------

// Ambiguous shapes fit both: "1,234" is 1234 (en grouping) or 1.234 (de decimal), and vice versa for "1.234".
const EN_COMPATIBLE: NumericShape[] = ["plain_integer", "plain_decimal_point", "grouped_comma", "comma_ambiguous", "point_ambiguous", "exponent"];
const DE_COMPATIBLE: NumericShape[] = ["plain_integer", "decimal_comma", "grouped_point", "comma_ambiguous", "point_ambiguous"];

function numericFormatFindings(column: Column, cells: ColumnCells): Draft[] {
  if (column.semanticRole === "identifier") return [];
  const shapes = new Map<NumericShape, Array<{ row: Row; cell: Cell; text: string }>>();
  let textCount = 0;
  for (const { row, cell } of cells) {
    if (!cell || !isTextLike(cell)) continue;
    const t = textOf(cell);
    if (t === null || t.trim() === "" || PLACEHOLDER_TOKENS.has(t.trim())) continue;
    textCount += 1;
    const s = numericShape(t);
    if (s) shapes.set(s, [...(shapes.get(s) ?? []), { row, cell, text: t }]);
  }
  const numericCount = [...shapes.values()].reduce((n, l) => n + l.length, 0);
  // Only columns that mostly look numeric; a label column with one "2020" is not a numeric column.
  if (numericCount === 0 || numericCount * 2 < textCount) return [];

  const all = [...shapes.values()].flat();
  const kinds = [...shapes.keys()];
  const evidence = kinds.map((k) => {
    const list = shapes.get(k)!;
    return `${SHAPE_LABELS[k]}: ${list.length} (e.g. ${list.slice(0, MAX_EXAMPLES).map((x) => quote(x.text)).join(", ")})`;
  });
  if (numericCount < textCount) evidence.push(`${textCount - numericCount} other text values do not look numeric`);

  // A locale is suggested only when the unambiguous values rule the other one out.
  const formatKinds = kinds.filter((k) => !["percent", "currency", "parentheses"].includes(k));
  const enOk = formatKinds.every((k) => EN_COMPATIBLE.includes(k));
  const deOk = formatKinds.every((k) => DE_COMPATIBLE.includes(k));
  const hasAmbiguous = kinds.includes("comma_ambiguous") || kinds.includes("point_ambiguous");
  const locale: { decimalSeparator: "." | ","; groupingSeparator: "," | "." } | null =
    enOk && (!deOk || !hasAmbiguous)
      ? { decimalSeparator: ".", groupingSeparator: "," }
      : deOk && !enOk
        ? { decimalSeparator: ",", groupingSeparator: "." }
        : null;
  if (hasAmbiguous && enOk && deOk) {
    evidence.push("Values such as “1,234” or “1.234” could be read with either separator as the decimal; the values alone do not settle it.");
  }

  // Currency and percent need an explicit user choice (ISO code, representation), so no suggestion then.
  const needsChoice = kinds.includes("currency") || kinds.includes("percent");
  const suggestion: TransformOperation | null =
    locale && !needsChoice
      ? {
          type: "parse_numeric",
          columnId: column.id,
          locale,
          groupingPolicy: "allow",
          percentPolicy: "reject",
          currencyPolicy: { mode: "reject" },
          parenthesesNegative: false,
          onFailure: "keep_and_flag",
        }
      : null;

  const mixed = kinds.length > 1 && !(kinds.length === 2 && kinds.includes("plain_integer") && kinds.includes("plain_decimal_point"));
  return [
    {
      kind: mixed ? "mixed_numeric_format" : "type_mismatch",
      discriminator: "numeric_text",
      severity: mixed ? "review" : "info",
      message: mixed
        ? `${quote(column.label)} writes numbers in ${kinds.length} different ways. Choose how to read them before charting.`
        : `${plural(all.length, "value")} in ${quote(column.label)} look${all.length === 1 ? "s" : ""} numeric but ${all.length === 1 ? "is" : "are"} stored as text.`,
      rowIds: all.map((x) => x.row.id),
      columnIds: [column.id],
      cellIds: all.map((x) => x.cell.id),
      evidence,
      suggestedOperation: suggestion,
    },
  ];
}

// ---------------------------------------------------------------------------
// Ambiguous dates
// ---------------------------------------------------------------------------

function dateFindings(column: Column, cells: ColumnCells): Draft[] {
  const ambiguous: Array<{ row: Row; cell: Cell; text: string }> = [];
  let dmOnly = 0;
  let mdOnly = 0;
  const separators = new Set<string>();
  for (const { row, cell } of cells) {
    if (!cell || !isTextLike(cell)) continue;
    const t = textOf(cell);
    const r = t === null ? null : dayMonthReadings(t);
    if (!r || !t) continue;
    separators.add(r.separator);
    const m = /^(\d{1,2})[/.-](\d{1,2})/.exec(t.trim())!;
    if (r.dm && r.md && Number(m[1]) !== Number(m[2])) ambiguous.push({ row, cell, text: t });
    else if (r.dm && !r.md) dmOnly += 1;
    else if (r.md && !r.dm) mdOnly += 1;
  }
  if (ambiguous.length === 0) return [];
  const evidence = [
    `${plural(ambiguous.length, "value")} could be day/month or month/day (e.g. ${ambiguous.slice(0, MAX_EXAMPLES).map((x) => quote(x.text)).join(", ")})`,
  ];
  if (dmOnly) evidence.push(`${plural(dmOnly, "value")} only fit${dmOnly === 1 ? "s" : ""} day/month order`);
  if (mdOnly) evidence.push(`${plural(mdOnly, "value")} only fit${mdOnly === 1 ? "s" : ""} month/day order`);
  if (!dmOnly && !mdOnly) evidence.push("No value in this column settles the order.");

  const sep = separators.size === 1 ? [...separators][0] : null;
  let format: "DD/MM/YYYY" | "MM/DD/YYYY" | "DD.MM.YYYY" | null = null;
  if (sep === "/" && dmOnly > 0 && mdOnly === 0) format = "DD/MM/YYYY";
  else if (sep === "/" && mdOnly > 0 && dmOnly === 0) format = "MM/DD/YYYY";
  else if (sep === "." && mdOnly === 0) format = dmOnly > 0 ? "DD.MM.YYYY" : null;
  return [
    {
      kind: "ambiguous_date",
      discriminator: "day_month_order",
      severity: "review",
      message: format
        ? `${plural(ambiguous.length, "date")} in ${quote(column.label)} could be read two ways; other values in the column suggest ${format}.`
        : `${plural(ambiguous.length, "date")} in ${quote(column.label)} could be read as day/month or month/day. Choose the format explicitly.`,
      rowIds: ambiguous.map((x) => x.row.id),
      columnIds: [column.id],
      cellIds: ambiguous.map((x) => x.cell.id),
      evidence,
      suggestedOperation: format ? { type: "parse_date", columnId: column.id, format, timezonePolicy: "date_only", onFailure: "keep_and_flag" } : null,
    },
  ];
}

// ---------------------------------------------------------------------------
// Mixed units / currencies
// ---------------------------------------------------------------------------

const UNIT_SUFFIX = /^[-+\u2212]?\d[\d.,\s\u00a0]*\s?([A-Za-zµμ°][A-Za-zµμ°/²³]{0,7})$/;

function unitFindings(column: Column, cells: ColumnCells): Draft[] {
  const markers = new Map<string, Array<{ row: Row; cell: Cell; text: string }>>();
  const units = new Map<string, Array<{ row: Row; cell: Cell; text: string }>>();
  for (const { row, cell } of cells) {
    if (!cell || !isTextLike(cell)) continue;
    const t = textOf(cell);
    if (t === null || !/\d/.test(t)) continue;
    const m = detectCurrencyMarker(t);
    if (m) {
      markers.set(m, [...(markers.get(m) ?? []), { row, cell, text: t }]);
      continue;
    }
    const u = UNIT_SUFFIX.exec(t.trim());
    if (u && !/^[eE]\d*$/.test(u[1])) units.set(u[1], [...(units.get(u[1]) ?? []), { row, cell, text: t }]);
  }
  const out: Draft[] = [];
  if (markers.size > 1) {
    const all = [...markers.values()].flat();
    out.push({
      kind: "mixed_units",
      discriminator: "currency",
      severity: "review",
      message: `${quote(column.label)} mixes currency markers (${[...markers.keys()].join(", ")}). Values in different currencies cannot be compared without dated exchange rates.`,
      rowIds: all.map((x) => x.row.id),
      columnIds: [column.id],
      cellIds: all.map((x) => x.cell.id),
      evidence: [...markers].map(([k, l]) => `“${k}”: ${l.length} (e.g. ${l.slice(0, MAX_EXAMPLES).map((x) => quote(x.text)).join(", ")})`),
      suggestedOperation: null,
    });
  }
  if (units.size > 1) {
    const all = [...units.values()].flat();
    out.push({
      kind: "mixed_units",
      discriminator: "unit_suffix",
      severity: "review",
      message: `${quote(column.label)} mixes unit suffixes (${[...units.keys()].join(", ")}). Check they measure the same quantity before parsing.`,
      rowIds: all.map((x) => x.row.id),
      columnIds: [column.id],
      cellIds: all.map((x) => x.cell.id),
      evidence: [...units].map(([k, l]) => `“${k}”: ${l.length} (e.g. ${l.slice(0, MAX_EXAMPLES).map((x) => quote(x.text)).join(", ")})`),
      suggestedOperation: null,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Type mismatches in typed columns
// ---------------------------------------------------------------------------

function typeMismatchFindings(column: Column, cells: ColumnCells): Draft[] {
  if (column.dataType === "text" || column.dataType === "unknown") return [];
  const off = cells.filter(({ cell }) => cell && cell.currentValue !== null && cell.valueType !== column.dataType) as Array<{ row: Row; cell: Cell }>;
  if (off.length === 0) return [];
  const byType = new Map<string, number>();
  for (const { cell } of off) byType.set(cell.valueType, (byType.get(cell.valueType) ?? 0) + 1);
  return [
    {
      kind: "type_mismatch",
      discriminator: "typed_column",
      severity: "review",
      message: `${plural(off.length, "value")} in ${quote(column.label)} ${off.length === 1 ? "is" : "are"} not typed ${column.dataType} like the rest of the column.`,
      rowIds: off.map((x) => x.row.id),
      columnIds: [column.id],
      cellIds: off.map((x) => x.cell.id),
      evidence: [
        ...[...byType].map(([t, n]) => `${n} typed ${t}`),
        `e.g. ${off.slice(0, MAX_EXAMPLES).map((x) => quote(String(x.cell.currentValue))).join(", ")}`,
      ],
      suggestedOperation: null,
    },
  ];
}

// ---------------------------------------------------------------------------
// Repeated rows
// ---------------------------------------------------------------------------

function repeatedRowFindings(columns: Column[], rows: Row[]): Draft[] {
  if (columns.length === 0) return [];
  const columnIds = columns.map((c) => c.id);
  const groups = new Map<string, Row[]>();
  for (const row of [...rows].sort((a, b) => a.sourceOrder - b.sourceOrder)) {
    const k = duplicateKey(row, columnIds);
    groups.set(k, [...(groups.get(k) ?? []), row]);
  }
  const repeated = [...groups.values()].filter((g) => g.length > 1);
  if (repeated.length === 0) return [];
  const involved = repeated.flat();
  const extra = involved.length - repeated.length;
  return [
    {
      kind: "repeated_rows",
      discriminator: "all_columns",
      severity: "review",
      message: `${plural(extra, "row")} exactly repeat${extra === 1 ? "s" : ""} an earlier row in every column. A repeat may be a real repeated measurement, so nothing is removed unless you choose to.`,
      rowIds: involved.map((r) => r.id),
      columnIds,
      cellIds: [],
      evidence: [
        `${plural(repeated.length, "group")} of identical rows (largest has ${Math.max(...repeated.map((g) => g.length))} rows)`,
        ...repeated.slice(0, MAX_EXAMPLES).map((g) => `Rows at source positions ${g.map((r) => r.sourceOrder + 1).join(", ")} are identical`),
      ],
      suggestedOperation: { type: "remove_exact_duplicates", columnIds, retainPolicy: "first_in_source_order" },
    },
  ];
}

// ---------------------------------------------------------------------------
// Estimates, import issues, coverage
// ---------------------------------------------------------------------------

function estimateFindings(columns: Column[], rows: Row[]): Draft[] {
  const cells: Array<{ row: Row; cell: Cell; columnId: string }> = [];
  for (const row of rows) {
    for (const column of columns) {
      const cell = row.cells[column.id];
      if (cell && cell.origin === "estimated" && cell.reviewStatus === "unreviewed") cells.push({ row, cell, columnId: column.id });
    }
  }
  if (cells.length === 0) return [];
  return [
    {
      kind: "extraction_issue",
      discriminator: "unreviewed_estimates",
      severity: "info",
      message: `${plural(cells.length, "value")} ${cells.length === 1 ? "was" : "were"} estimated from the source image and ${cells.length === 1 ? "has" : "have"} not been reviewed. Compare ${cells.length === 1 ? "it" : "them"} with the source.`,
      rowIds: [...new Set(cells.map((c) => c.row.id))],
      columnIds: [...new Set(cells.map((c) => c.columnId))],
      cellIds: cells.map((c) => c.cell.id),
      evidence: ["Origin is “estimated” and review status is “unreviewed”."],
      suggestedOperation: null,
    },
  ];
}

function importIssueFindings(dataset: Dataset, snapshot: DatasetVersionSnapshot): Draft[] {
  const rowIds = new Set(snapshot.rows.map((r) => r.id));
  const columnIds = new Set(snapshot.version.columns.map((c) => c.id));
  const cellIds = new Set(snapshot.rows.flatMap((r) => Object.values(r.cells).map((c) => c.id)));
  const out: Draft[] = [];
  dataset.importIssues.forEach((issue, i) => {
    const rows = issue.rowIds.filter((id) => rowIds.has(id));
    const cols = issue.columnIds.filter((id) => columnIds.has(id));
    const cells = issue.cellIds.filter((id) => cellIds.has(id));
    const referenced = issue.rowIds.length + issue.cellIds.length > 0;
    // An issue about rows/cells that no longer exist in this version is no longer observable here.
    if (referenced && rows.length + cells.length === 0) return;
    out.push({
      kind: issue.kind,
      discriminator: `import_${i}`,
      severity: issue.severity,
      message: issue.message,
      rowIds: rows,
      columnIds: cols,
      cellIds: cells,
      evidence: issue.evidence.length > 0 ? issue.evidence : ["Reported while reading the source."],
      suggestedOperation: null,
    });
  });
  return out;
}

function coverageFindings(dataset: Dataset): Draft[] {
  if (dataset.coverage === "complete_selection") return [];
  if (dataset.importIssues.some((i) => i.kind === "partial_coverage")) return [];
  return [
    {
      kind: "partial_coverage",
      discriminator: dataset.coverage,
      severity: dataset.coverageAcknowledgedAt ? "info" : "review",
      message:
        dataset.coverage === "partial_selection"
          ? "This dataset covers only part of the selected source region."
          : "It is uncertain whether this dataset covers everything in the selected source region.",
      rowIds: [],
      columnIds: [],
      cellIds: [],
      evidence: [dataset.coverageNote ?? "No coverage note recorded.", dataset.coverageAcknowledgedAt ? `Acknowledged at ${dataset.coverageAcknowledgedAt}` : "Not acknowledged yet."],
      suggestedOperation: null,
    },
  ];
}
