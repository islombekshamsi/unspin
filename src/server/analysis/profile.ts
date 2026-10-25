import Decimal from "decimal.js";
import type { AnalysisFact, Column, DatasetOverview, DatasetVersionSnapshot, ProfileHighlight, Row } from "@/contracts";
import { presetCounts } from "./view-match";

const DecimalMath = Decimal.clone({ precision: 34, rounding: Decimal.ROUND_HALF_EVEN });

function cellNumber(row: Row, columnId: string): Decimal | null {
  const cell = row.cells[columnId];
  if (!cell || cell.currentValue === null || typeof cell.currentValue === "boolean") return null;
  try {
    const d = new DecimalMath(cell.currentValue);
    return d.isFinite() ? d : null;
  } catch {
    return null;
  }
}

function cellText(row: Row, columnId: string): string | null {
  const cell = row.cells[columnId];
  if (!cell || cell.currentValue === null) return null;
  return typeof cell.currentValue === "boolean" ? String(cell.currentValue) : cell.currentValue;
}

function looksLikeTime(c: Column): boolean {
  if (c.dataType === "date" || c.dataType === "datetime") return true;
  if (c.semanticRole === "x" && c.dataType === "decimal") return true;
  const label = `${c.label} ${c.seriesLabel ?? ""}`.toLowerCase();
  return /decimal\s*date|decimal_date|year|date|time/.test(label);
}

function numericMeasure(c: Column): boolean {
  if (c.dataType !== "decimal") return false;
  if (c.semanticRole === "identifier" || c.semanticRole === "uncertainty" || c.semanticRole === "x") return false;
  const label = c.label.toLowerCase();
  if (/^(year|month|day|index)$/.test(label)) return false;
  if (/decimal\s*date|decimal_date/.test(label)) return false;
  return true;
}

function looksNumericText(s: string): boolean {
  try {
    return new DecimalMath(s).isFinite();
  } catch {
    return /^[\s(+-]*[$€£¥]?\s*\d[\d,.\s]*%?\)?\s*$/.test(s);
  }
}

function columnNumericLookCount(rows: Row[], columnId: string): { present: number; numericish: number; missing: number } {
  let present = 0;
  let numericish = 0;
  let missing = 0;
  for (const row of rows) {
    const t = cellText(row, columnId);
    if (t === null) {
      missing += 1;
      continue;
    }
    present += 1;
    if (looksNumericText(t)) numericish += 1;
  }
  return { present, numericish, missing };
}

/** Text/boolean columns that are actually labels — not measurements stored as text. */
function isGenuineCategory(col: Column, rows: Row[]): boolean {
  if (col.semanticRole === "category") return true;
  if (col.dataType === "boolean") return true;
  if (col.dataType !== "text") return false;
  const { present, numericish } = columnNumericLookCount(rows, col.id);
  if (present === 0) return false;
  if (numericish / present >= 0.5) return false;
  const groups = new Set<string>();
  for (const row of rows) {
    const t = cellText(row, col.id);
    if (t !== null) groups.add(t);
  }
  return groups.size <= 24 && groups.size < present * 0.5;
}

function genericColumnLabel(label: string): boolean {
  return /^column\s+\d+$/i.test(label.trim());
}

function firstRecordLooksUnrelated(rows: Row[], columns: Column[]): boolean {
  if (rows.length < 3) return false;
  const first = rows[0];
  let emptyThenFilled = 0;
  let classLike = 0;
  for (const col of columns) {
    const t = cellText(first, col.id);
    if (t === null) {
      const later = rows.slice(1, 12).some((r) => cellText(r, col.id) !== null);
      if (later) emptyThenFilled += 1;
    } else if (/^class([_\s-]?\d+)?$/i.test(t.trim())) {
      classLike += 1;
    }
  }
  return emptyThenFilled >= 3 || classLike >= 2;
}

function slugId(operation: string, columnLabel: string | null, used: Set<string>): string {
  const slug = (columnLabel ?? "table").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "table";
  let id = `fact_${operation}_${slug}`;
  let n = 2;
  while (used.has(id)) {
    id = `fact_${operation}_${slug}_${n}`;
    n += 1;
  }
  used.add(id);
  return id;
}

function evidenceFor(rows: Row[], columnId: string | null, limit = 8): AnalysisFact["evidence"] {
  const rowIds = rows.slice(0, limit).map((r) => r.id);
  const cellIds: string[] = [];
  if (columnId) {
    for (const r of rows.slice(0, limit)) {
      const c = r.cells[columnId];
      if (c) cellIds.push(c.id);
    }
  }
  return { kind: rows.length > limit ? "query" : "rows", rowIds, cellIds, count: rows.length };
}

export function buildOverview(snapshot: DatasetVersionSnapshot, scopedRows: Row[]): DatasetOverview {
  const versionId = snapshot.version.id;
  const columns = snapshot.version.columns;
  const rows = scopedRows;
  const facts: AnalysisFact[] = [];
  const highlights: ProfileHighlight[] = [];
  const notes: string[] = [];
  const suggestedQuestions: string[] = [];
  const usedFactIds = new Set<string>();
  const factId = (operation: string, columnLabel: string | null) => slugId(operation, columnLabel, usedFactIds);

  const countFact: AnalysisFact = {
    id: factId("count", "rows"),
    versionId,
    operation: "count",
    columnId: null,
    columnLabel: null,
    unit: "rows",
    value: { kind: "integer", n: rows.length },
    evidence: evidenceFor(rows, null, 8),
    limitations: rows.length === snapshot.rows.length ? [] : ["This count is the current view, not the full dataset."],
  };
  facts.push(countFact);

  const columnCountFact: AnalysisFact = {
    id: factId("count", "columns"),
    versionId,
    operation: "count",
    columnId: null,
    columnLabel: "columns",
    unit: "columns",
    value: { kind: "integer", n: columns.length },
    evidence: { kind: "query", rowIds: [], cellIds: [], count: columns.length },
    limitations: [],
  };
  facts.push(columnCountFact);

  highlights.push({
    title: "This table",
    body: `${rows.length.toLocaleString()} rows × ${columns.length} columns.`,
    factIds: [countFact.id, columnCountFact.id],
  });

  if (columns.length > 0 && columns.every((c) => genericColumnLabel(c.label))) {
    notes.push(
      "Field names are the file’s own labels. No units or measurement roles are recorded. Rename a column in Review when you know what it measures.",
    );
  }
  if (firstRecordLooksUnrelated(rows, columns)) {
    const first = rows[0];
    const shown = columns
      .map((c) => cellText(first, c.id))
      .filter((t): t is string => t !== null)
      .slice(0, 6)
      .join(", ");
    notes.push(
      `The first data record (${shown || "mostly empty"}) does not match later numeric rows. Confirm in the table whether it belongs, or remove it through Review.`,
    );
    suggestedQuestions.push("Does the first data record belong in this table?");
  }

  const xCol =
    columns.find((c) => /decimal\s*date|decimal_date/.test(c.label.toLowerCase())) ??
    columns.find((c) => c.dataType === "date" || c.dataType === "datetime") ??
    columns.find((c) => c.semanticRole === "x" && looksLikeTime(c) && c.dataType === "decimal") ??
    columns.find((c) => c.semanticRole === "x" && looksLikeTime(c)) ??
    columns.find((c) => looksLikeTime(c));
  const yCols = columns.filter((c) => numericMeasure(c) && c.id !== xCol?.id);

  if (xCol && yCols.length > 0) {
    const y = yCols[0];
    const pairs: { row: Row; x: Decimal | string; y: Decimal }[] = [];
    let missingY = 0;
    for (const row of rows) {
      const yv = cellNumber(row, y.id);
      const xvNum = xCol.dataType === "decimal" ? cellNumber(row, xCol.id) : null;
      const xvText = cellText(row, xCol.id);
      if (yv === null) {
        if (row.cells[y.id]?.currentValue === null) missingY += 1;
        continue;
      }
      if (xvNum) pairs.push({ row, x: xvNum, y: yv });
      else if (xvText) pairs.push({ row, x: xvText, y: yv });
    }
    pairs.sort((a, b) => {
      if (a.x instanceof DecimalMath && b.x instanceof DecimalMath) return a.x.cmp(b.x);
      return String(a.x).localeCompare(String(b.x), "en");
    });

    const cover: AnalysisFact = {
      id: factId("missing_coverage", y.label),
      versionId,
      operation: "missing_coverage",
      columnId: y.id,
      columnLabel: y.label,
      unit: y.unit,
      value: { kind: "coverage", valid: pairs.length, missing: missingY, total: rows.length },
      evidence: { kind: "query", rowIds: [], cellIds: [], count: missingY },
      limitations: missingY > 0 ? [`${missingY} ${y.label} values are missing and were not treated as zero.`] : [],
    };
    facts.push(cover);

    if (pairs.length >= 1) {
      const first = pairs[0];
      const last = pairs[pairs.length - 1];
      const firstFact: AnalysisFact = {
        id: factId("first", y.label),
        versionId,
        operation: "first",
        columnId: y.id,
        columnLabel: y.label,
        unit: y.unit,
        value: { kind: "decimal", value: first.y.toFixed() },
        evidence: evidenceFor([first.row], y.id, 1),
        limitations: [`First observation at ${String(first.x)} (${xCol.label}).`],
      };
      const lastFact: AnalysisFact = {
        id: factId("last", y.label),
        versionId,
        operation: "last",
        columnId: y.id,
        columnLabel: y.label,
        unit: y.unit,
        value: { kind: "decimal", value: last.y.toFixed() },
        evidence: evidenceFor([last.row], y.id, 1),
        limitations: [`Latest observation at ${String(last.x)} (${xCol.label}).`],
      };
      facts.push(firstFact, lastFact);
      if (first.x instanceof DecimalMath && last.x instanceof DecimalMath) {
        facts.push(
          {
            id: factId("first", xCol.label),
            versionId,
            operation: "first",
            columnId: xCol.id,
            columnLabel: xCol.label,
            unit: xCol.unit,
            value: { kind: "decimal", value: first.x.toFixed() },
            evidence: evidenceFor([first.row], xCol.id, 1),
            limitations: [`Time of the first ${y.label} observation.`],
          },
          {
            id: factId("last", xCol.label),
            versionId,
            operation: "last",
            columnId: xCol.id,
            columnLabel: xCol.label,
            unit: xCol.unit,
            value: { kind: "decimal", value: last.x.toFixed() },
            evidence: evidenceFor([last.row], xCol.id, 1),
            limitations: [`Time of the latest ${y.label} observation.`],
          },
        );
      }

      let min = pairs[0];
      let max = pairs[0];
      for (const p of pairs) {
        if (p.y.lt(min.y)) min = p;
        if (p.y.gt(max.y)) max = p;
      }
      const minFact: AnalysisFact = {
        id: factId("min", y.label),
        versionId,
        operation: "min",
        columnId: y.id,
        columnLabel: y.label,
        unit: y.unit,
        value: { kind: "decimal", value: min.y.toFixed() },
        evidence: evidenceFor([min.row], y.id, 1),
        limitations: [`At ${String(min.x)}.`],
      };
      const maxFact: AnalysisFact = {
        id: factId("max", y.label),
        versionId,
        operation: "max",
        columnId: y.id,
        columnLabel: y.label,
        unit: y.unit,
        value: { kind: "decimal", value: max.y.toFixed() },
        evidence: evidenceFor([max.row], y.id, 1),
        limitations: [`At ${String(max.x)}.`],
      };
      facts.push(minFact, maxFact);

      if (pairs.length >= 2 && first.y.eq(0) === false) {
        const delta = last.y.minus(first.y);
        const changeFact: AnalysisFact = {
          id: factId("adjacent_change", y.label),
          versionId,
          operation: "adjacent_change",
          columnId: y.id,
          columnLabel: y.label,
          unit: y.unit,
          value: { kind: "pair", from: first.y.toFixed(), to: last.y.toFixed(), delta: delta.toFixed() },
          evidence: evidenceFor([first.row, last.row], y.id, 2),
          limitations: [
            `Change from first (${String(first.x)}) to latest (${String(last.x)}), not a fitted trend.`,
            "This does not establish a cause.",
          ],
        };
        facts.push(changeFact);
        highlights.push({
          title: `${y.label} over ${xCol.label}`,
          body: `${String(first.x)} → ${String(last.x)}. ${y.label} ${first.y.toFixed()} to ${last.y.toFixed()} (${delta.isNeg() ? "" : "+"}${delta.toFixed()}${y.unit ? ` ${y.unit}` : ""}).`,
          factIds: [firstFact.id, lastFact.id, changeFact.id],
        });
        suggestedQuestions.push(`How did ${y.label} change from the first to the latest observation?`);
        suggestedQuestions.push(`When was ${y.label} highest, and what was the value?`);
      } else {
        highlights.push({
          title: `${y.label}`,
          body: `Range ${min.y.toFixed()} to ${max.y.toFixed()}${y.unit ? ` ${y.unit}` : ""}.`,
          factIds: [minFact.id, maxFact.id],
        });
      }

      if (missingY > 0) {
        highlights.push({
          title: "Missing values",
          body: `${missingY} of ${rows.length} ${y.label} observations are missing. They stay missing.`,
          factIds: [cover.id],
        });
        suggestedQuestions.push(`How many ${y.label} values are missing?`);
      }

      const kind = "time_series" as const;
      suggestedQuestions.push(`What are the earliest and latest ${xCol.label} values in this view?`);
      return finish(versionId, kind, highlights, facts, rows, snapshot.rows, notes, suggestedQuestions);
    }
  }

  const textStoredNumeric = columns.filter((c) => c.dataType === "text" && c.semanticRole !== "category");
  const numericTextCols: { col: Column; present: number; numericish: number; rows: Row[] }[] = [];
  for (const col of textStoredNumeric) {
    const { present, numericish } = columnNumericLookCount(rows, col.id);
    if (present === 0 || numericish / present < 0.5) continue;
    const exampleRows = rows.filter((r) => {
      const t = cellText(r, col.id);
      return t !== null && looksNumericText(t);
    });
    numericTextCols.push({ col, present, numericish, rows: exampleRows });
  }
  if (numericTextCols.length > 0) {
    const first = numericTextCols[0];
    const cover: AnalysisFact = {
      id: factId("missing_coverage", first.col.label),
      versionId,
      operation: "missing_coverage",
      columnId: first.col.id,
      columnLabel: first.col.label,
      unit: null,
      value: { kind: "coverage", valid: first.numericish, missing: first.present - first.numericish, total: first.present },
      evidence: evidenceFor(first.rows, first.col.id, 8),
      limitations: numericTextCols.map(
        (c) => `${c.numericish} of ${c.present} present values in ${c.col.label} look numeric but the column is stored as text.`,
      ),
    };
    facts.push(cover);
    const labels = numericTextCols.map((c) => c.col.label);
    const labelList =
      labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
    highlights.push({
      title: "Stored as text",
      body: `${labelList}: most present values look numeric. They stay text until you parse numbers in Review.`,
      factIds: [cover.id],
    });
  }

  const category = columns.find((c) => isGenuineCategory(c, rows));
  if (category) {
    const groups = new Map<string, number>();
    let missing = 0;
    for (const row of rows) {
      const t = cellText(row, category.id);
      if (t === null) {
        missing += 1;
        continue;
      }
      groups.set(t, (groups.get(t) ?? 0) + 1);
    }
    const items = [...groups.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 12)
      .map(([label, n]) => ({ label, n }));
    const gFact: AnalysisFact = {
      id: factId("group_counts", category.label),
      versionId,
      operation: "group_counts",
      columnId: category.id,
      columnLabel: category.label,
      unit: "rows",
      value: { kind: "groups", items },
      evidence: { kind: "query", rowIds: [], cellIds: [], count: rows.length - missing },
      limitations: missing > 0 ? [`${missing} rows have no ${category.label}.`] : [],
    };
    facts.push(gFact);
    const top = items[0];
    highlights.push({
      title: category.label,
      body: top
        ? `${items.length} distinct values of ${rows.length} rows. Most common: ${top.label} (${top.n}).`
        : `No ${category.label} values in this view.`,
      factIds: [gFact.id],
    });
    suggestedQuestions.push(`Which ${category.label} appears most often?`);
    return finish(versionId, items.length ? "categorical" : "insufficient", highlights, facts, rows, snapshot.rows, notes, suggestedQuestions);
  }

  for (const y of yCols.slice(0, 2)) {
    const present: { row: Row; y: Decimal }[] = [];
    let missing = 0;
    for (const row of rows) {
      const n = cellNumber(row, y.id);
      if (!n) {
        if (row.cells[y.id]?.currentValue === null) missing += 1;
        continue;
      }
      present.push({ row, y: n });
    }
    if (present.length === 0) continue;
    const sorted = [...present].sort((a, b) => a.y.cmp(b.y));
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const minFact: AnalysisFact = {
      id: factId("min", y.label),
      versionId,
      operation: "min",
      columnId: y.id,
      columnLabel: y.label,
      unit: y.unit,
      value: { kind: "decimal", value: min.y.toFixed() },
      evidence: evidenceFor([min.row], y.id, 1),
      limitations: [],
    };
    const maxFact: AnalysisFact = {
      id: factId("max", y.label),
      versionId,
      operation: "max",
      columnId: y.id,
      columnLabel: y.label,
      unit: y.unit,
      value: { kind: "decimal", value: max.y.toFixed() },
      evidence: evidenceFor([max.row], y.id, 1),
      limitations: [],
    };
    facts.push(minFact, maxFact);
    highlights.push({
      title: y.label,
      body: `Range ${min.y.toFixed()} to ${max.y.toFixed()}${y.unit ? ` ${y.unit}` : ""} (${present.length} of ${rows.length} present).`,
      factIds: [minFact.id, maxFact.id],
    });
    const generic = genericColumnLabel(y.label);
    if (!generic) {
      suggestedQuestions.push(`What is the range of ${y.label}?`);
      if (missing > 0) suggestedQuestions.push(`How many ${y.label} values are missing?`);
    }
  }

  const genericSchema = columns.length > 0 && columns.every((c) => genericColumnLabel(c.label));
  if (genericSchema) {
    if (numericTextCols.length > 0) {
      suggestedQuestions.push("Which columns that look numeric should be parsed as numbers?");
    }
    suggestedQuestions.push("Confirm field names in Review before treating these as named measurements.");
  }

  if (highlights.length <= 1) {
    notes.push("No time axis or category column is established. Confirm column meaning before treating numbers as a trend.");
  }
  return finish(versionId, yCols.length || textStoredNumeric.length ? "tabular" : "insufficient", highlights, facts, rows, snapshot.rows, notes, suggestedQuestions);
}

function finish(
  versionId: string,
  kind: DatasetOverview["kind"],
  highlights: ProfileHighlight[],
  facts: AnalysisFact[],
  scoped: Row[],
  all: Row[],
  notes: string[],
  suggestedQuestions: string[],
): DatasetOverview {
  if (scoped.length === 0) {
    notes.push("This view has no rows. Clear the filter, or choose All data.");
  }
  return {
    versionId,
    kind,
    highlights: highlights.slice(0, 6),
    facts,
    presetCounts: presetCounts(all),
    suggestedQuestions: [...new Set(suggestedQuestions)].slice(0, 6),
    notes,
  };
}
