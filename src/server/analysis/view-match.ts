import type { Row, ViewPreset, ViewSpec } from "@/contracts";

function displayText(cell: Row["cells"][string] | undefined): string {
  if (!cell || cell.currentValue === null) return "";
  return typeof cell.currentValue === "boolean" ? String(cell.currentValue) : cell.currentValue;
}

export function rowMatchesPreset(row: Row, preset: ViewPreset): boolean {
  if (preset === "all") return true;
  const cells = Object.values(row.cells);
  if (preset === "estimated") return cells.some((c) => c.origin === "estimated");
  if (preset === "edited") return cells.some((c) => c.origin === "user_edit");
  return cells.some((c) => c.origin === "estimated" && c.reviewStatus === "unreviewed");
}

export function rowMatchesSearch(row: Row, search: string | null): boolean {
  const needle = search?.trim().toLocaleLowerCase() ?? "";
  if (!needle) return true;
  for (const cell of Object.values(row.cells)) {
    if (displayText(cell).toLocaleLowerCase().includes(needle)) return true;
    if ((cell.rawText ?? "").toLocaleLowerCase().includes(needle)) return true;
  }
  return false;
}

export function rowMatchesColumnFilter(row: Row, columnId: string | null, text: string | null): boolean {
  if (!columnId || !text) return true;
  return displayText(row.cells[columnId]).toLocaleLowerCase().includes(text.toLocaleLowerCase());
}

export function applyView(rows: readonly Row[], spec: Pick<ViewSpec, "preset" | "search" | "filterColumnId" | "filterText">): Row[] {
  return rows.filter(
    (r) =>
      rowMatchesPreset(r, spec.preset ?? "all") &&
      rowMatchesSearch(r, spec.search) &&
      rowMatchesColumnFilter(r, spec.filterColumnId, spec.filterText),
  );
}

export function presetCounts(rows: readonly Row[]): { preset: ViewPreset; rowCount: number }[] {
  const all = rows.length;
  let needs = 0;
  let estimated = 0;
  let edited = 0;
  for (const row of rows) {
    if (rowMatchesPreset(row, "needs_review")) needs += 1;
    if (rowMatchesPreset(row, "estimated")) estimated += 1;
    if (rowMatchesPreset(row, "edited")) edited += 1;
  }
  return [
    { preset: "all", rowCount: all },
    { preset: "needs_review", rowCount: needs },
    { preset: "estimated", rowCount: estimated },
    { preset: "edited", rowCount: edited },
  ];
}

export function defaultViewSpec(): ViewSpec {
  return {
    preset: "all",
    search: null,
    filterColumnId: null,
    filterText: null,
    sort: { columnId: null, direction: "asc" },
    columnIds: null,
  };
}

export function viewHash(spec: Pick<ViewSpec, "preset" | "search" | "filterColumnId" | "filterText" | "sort">): string {
  return JSON.stringify([
    spec.preset ?? "all",
    spec.search ?? "",
    spec.filterColumnId ?? "",
    spec.filterText ?? "",
    spec.sort.columnId ?? "",
    spec.sort.direction,
  ]);
}
