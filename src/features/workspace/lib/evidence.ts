import type { SelectionEvent } from "@/contracts";
import { fetchRowsByIds } from "@/features/grid/lib/rows";

/** Rows looked up to locate evidence in the source; the source view lists a handful of records. */
export const MAX_SOURCE_EVIDENCE_ROWS = 25;

/**
 * Completes a selection with the provenance of its cells so the source view can locate it.
 * Facts carry row/cell ids only; provenance comes from the stored rows, never from inference.
 * Selected cells are preferred; whole rows are used when no cell of the selection is found.
 */
export async function withSourceProvenance(datasetId: string, event: SelectionEvent, signal?: AbortSignal): Promise<SelectionEvent> {
  if (event.provenanceIds.length > 0 || event.rowIds.length === 0) return event;
  const rowIds = event.rowIds.slice(0, MAX_SOURCE_EVIDENCE_ROWS);
  const rows = await fetchRowsByIds(datasetId, event.datasetVersionId, rowIds, signal);
  const cellIds = new Set(event.cellIds);
  const fromCells = new Set<string>();
  const fromRows = new Set<string>();
  for (const id of rowIds) {
    const row = rows.get(id);
    if (!row) continue;
    for (const cell of Object.values(row.cells)) {
      for (const p of cell.provenanceIds) {
        fromRows.add(p);
        if (cellIds.has(cell.id)) fromCells.add(p);
      }
    }
  }
  return { ...event, provenanceIds: [...(fromCells.size > 0 ? fromCells : fromRows)] };
}
