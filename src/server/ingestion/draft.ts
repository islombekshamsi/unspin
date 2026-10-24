import {
  DecimalStringSchema,
  newId,
  type Cell,
  type Column,
  type ImportIssue,
  type Locator,
  type LocatorAvailability,
  type MissingReason,
  type Provenance,
  type Row,
} from "@/contracts";

/** One parsed source cell before ids and types are assigned. */
export interface DraftCellInput {
  rawText: string | null;
  /** Text value as read; null when missing. Never coerced. */
  text: string | null;
  missingReason: MissingReason | null;
  notes: string[];
  locator: Locator;
  availability: LocatorAvailability;
  provenanceLabel: string;
}

export interface DraftRowInput {
  sourceOrder: number;
  cells: DraftCellInput[];
}

export interface BuiltDraft {
  columns: Column[];
  rows: Row[];
  provenance: Provenance[];
  /** cellIds[rowIndex][columnIndex] */
  cellIds: string[][];
}

export function isCanonicalDecimal(s: string): boolean {
  return DecimalStringSchema.safeParse(s).success;
}

/**
 * Assigns stable ids, provenance, and conservative types. A column is typed
 * "decimal" only when every present value is already a canonical decimal string
 * (so "007", "1,234", "12%", " 5" keep the whole column as text); values are
 * never routed through Number.
 */
export function buildDraft(input: {
  sourceId: string;
  selectionId: string;
  labels: string[];
  rows: DraftRowInput[];
}): BuiltDraft {
  const createdAt = new Date().toISOString();
  const columnCount = input.labels.length;
  const decimalColumn: boolean[] = [];
  for (let c = 0; c < columnCount; c++) {
    let present = 0;
    let allDecimal = true;
    for (const row of input.rows) {
      const t = row.cells[c]?.text;
      if (t === null || t === undefined) continue;
      present++;
      if (!isCanonicalDecimal(t)) {
        allDecimal = false;
        break;
      }
    }
    decimalColumn.push(present > 0 && allDecimal);
  }

  const columns: Column[] = input.labels.map((label, c) => ({
    id: newId("col"),
    label: label.slice(0, 300),
    semanticRole: "other",
    dataType: decimalColumn[c] ? "decimal" : "text",
    unit: null,
    currency: null,
    percentRepresentation: null,
    datePolicy: null,
    sourceScale: "unknown",
    seriesLabel: null,
  }));

  const provenance: Provenance[] = [];
  const cellIds: string[][] = [];
  const rows: Row[] = input.rows.map((r) => {
    const cells: Record<string, Cell> = {};
    const ids: string[] = [];
    for (let c = 0; c < columnCount; c++) {
      const src = r.cells[c];
      const prov: Provenance = {
        id: newId("prov"),
        sourceId: input.sourceId,
        sourceSelectionId: input.selectionId,
        locator: src.locator,
        locatorOrigin: "parser",
        locatorAvailability: src.availability,
        label: src.provenanceLabel.slice(0, 500),
        extractionMethod: "deterministic_parser",
        createdAt,
      };
      provenance.push(prov);
      const cell: Cell = {
        id: newId("cell"),
        rawText: src.rawText,
        currentValue: src.text,
        valueType: decimalColumn[c] ? "decimal" : "text",
        missingReason: src.text === null ? (src.missingReason ?? "blank") : null,
        origin: "parsed",
        reviewStatus: "unreviewed",
        provenanceIds: [prov.id],
        parentCellIds: [],
        notes: src.notes.map((n) => n.slice(0, 1000)),
      };
      cells[columns[c].id] = cell;
      ids.push(cell.id);
    }
    cellIds.push(ids);
    return { id: newId("row"), sourceOrder: r.sourceOrder, cells };
  });

  return { columns, rows, provenance, cellIds };
}

/** Bounded issue constructor; evidence is capped so a large file cannot produce an unbounded message. */
export function issue(
  kind: ImportIssue["kind"],
  severity: ImportIssue["severity"],
  message: string,
  refs: { rowIds?: string[]; columnIds?: string[]; cellIds?: string[]; evidence?: string[] } = {},
): ImportIssue {
  const evidence = refs.evidence ?? [];
  const shown = evidence.slice(0, 25).map((e) => e.slice(0, 1000));
  if (evidence.length > shown.length) shown.push(`…and ${evidence.length - shown.length} more`);
  return {
    kind,
    severity,
    message: message.slice(0, 1000),
    rowIds: refs.rowIds ?? [],
    columnIds: refs.columnIds ?? [],
    cellIds: refs.cellIds ?? [],
    evidence: shown,
  };
}

export function baseName(filename: string): string {
  const name = filename.replace(/^.*[\\/]/, "");
  const dot = name.lastIndexOf(".");
  return (dot > 0 ? name.slice(0, dot) : name).trim() || "Untitled";
}
