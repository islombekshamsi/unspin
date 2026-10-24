import { describe, expect, it } from "vitest";
import { QualityFindingSchema } from "@/contracts";
import { computeFindings } from "@/server/quality";
import { seedDataset, utf8 } from "../helpers/fixtures";
import { NOAA_SAMPLE, noaaTable } from "../helpers/noaa";
import { makeOwner } from "../helpers/owners";

/**
 * Invariants that hold for any findings implementation, including the current
 * placeholder that returns none. They do not assert that a specific finding exists;
 * that needs the cleaning specialist's documented rules (phase 2).
 */
describe("quality findings invariants", () => {
  it.each([
    ["real NOAA rows with sentinel values", () => noaaTable(NOAA_SAMPLE)],
    [
      "protocol rows with blanks and an exact repeat",
      () => ({
        sourceBytes: utf8("k,v\n"),
        columns: [{ label: "k", dataType: "text" as const }, { label: "v", dataType: "decimal" as const }],
        rows: [["a", "1"], ["a", "1"], ["b", null], [null, "2"]],
      }),
    ],
  ])("%s: schema-valid, bound to the version, reference real ids, deterministic", async (_n, spec) => {
    const s = await seedDataset(makeOwner(), spec());
    const f1 = computeFindings(s.dataset, s.snapshot);
    const f2 = computeFindings(s.dataset, structuredClone(s.snapshot));
    expect(f1).toEqual(f2);
    const rowIds = new Set(s.snapshot.rows.map((r) => r.id));
    const colIds = new Set(s.columns.map((c) => c.id));
    const cellIds = new Set(s.snapshot.rows.flatMap((r) => Object.values(r.cells).map((c) => c.id)));
    for (const f of f1) {
      QualityFindingSchema.parse(f);
      expect(f.datasetVersionId).toBe(s.snapshot.version.id);
      f.affectedRowIds.forEach((id) => expect(rowIds.has(id)).toBe(true));
      f.affectedColumnIds.forEach((id) => expect(colIds.has(id)).toBe(true));
      f.affectedCellIds.forEach((id) => expect(cellIds.has(id)).toBe(true));
      if (f.suggestedOperation?.type === "remove_selected_rows" || f.suggestedOperation?.type === "remove_exact_duplicates") {
        expect(f.severity).not.toBe("info");
      }
    }
    expect(new Set(f1.map((f) => f.id)).size).toBe(f1.length);
  });
});
