import { describe, expect, it } from "vitest";
import { ANALYSIS_CONTRACT_VERSION, CONTRACT_SCHEMA_VERSION, newId, type AnalysisFact, type InsightCard, type Row } from "@/contracts";
import { buildOverview } from "@/server/analysis/profile";
import { parseModelInsights, validateInsights } from "@/server/analysis/validate";
import { applyView, presetCounts, rowMatchesPreset } from "@/server/analysis/view-match";
import { getOverview } from "@/server/orchestration/views";
import { getRows } from "@/server/orchestration/datasets";
import { commitManualEdit, seedDataset } from "../helpers/fixtures";
import { NOAA_SAMPLE, noaaTable } from "../helpers/noaa";
import { makeOwner } from "../helpers/owners";

function cell(origin: Row["cells"][string]["origin"], value: string | null, review: Row["cells"][string]["reviewStatus"] = "unreviewed"): Row["cells"][string] {
  return {
    id: newId("cell"),
    rawText: value,
    currentValue: value,
    valueType: "decimal",
    missingReason: value === null ? "blank" : null,
    origin,
    reviewStatus: review,
    provenanceIds: [],
    parentCellIds: [],
    notes: [],
  };
}

describe("view presets", () => {
  it("treats estimated, edited, and needs_review as overlapping, not parts of a total", () => {
    const estimatedUnreviewed: Row = { id: newId("row"), sourceOrder: 0, cells: { a: cell("estimated", "1.0", "unreviewed") } };
    const estimatedReviewed: Row = { id: newId("row"), sourceOrder: 1, cells: { a: cell("estimated", "2.0", "accepted") } };
    const edited: Row = { id: newId("row"), sourceOrder: 2, cells: { a: cell("user_edit", "3.0") } };
    const parsed: Row = { id: newId("row"), sourceOrder: 3, cells: { a: cell("parsed", "4.0") } };
    const rows = [estimatedUnreviewed, estimatedReviewed, edited, parsed];
    const counts = Object.fromEntries(presetCounts(rows).map((c) => [c.preset, c.rowCount]));
    expect(counts.all).toBe(4);
    expect(counts.estimated).toBe(2);
    expect(counts.edited).toBe(1);
    expect(counts.needs_review).toBe(1);
    expect(rowMatchesPreset(estimatedUnreviewed, "estimated")).toBe(true);
    expect(rowMatchesPreset(estimatedUnreviewed, "needs_review")).toBe(true);
    expect(rowMatchesPreset(estimatedReviewed, "needs_review")).toBe(false);
    expect(applyView(rows, { preset: "edited", search: null, filterColumnId: null, filterText: null }).map((r) => r.id)).toEqual([
      edited.id,
    ]);
  });

  it("search and column filter run over the full set, not a page", () => {
    const rows: Row[] = Array.from({ length: 5 }, (_, i) => ({
      id: newId("row"),
      sourceOrder: i,
      cells: { a: cell("parsed", i === 4 ? "needle-value" : `${i}.0`) },
    }));
    const found = applyView(rows, { preset: "all", search: "needle", filterColumnId: null, filterText: null });
    expect(found).toHaveLength(1);
    expect(found[0].cells.a.currentValue).toBe("needle-value");
  });
});

describe("tabular overview for headerless-looking measurements", () => {
  function col(label: string, dataType: "decimal" | "text") {
    return {
      id: newId("col"),
      label,
      semanticRole: "other" as const,
      dataType,
      unit: null,
      currency: null,
      percentRepresentation: null,
      datePolicy: null,
      sourceScale: "unknown" as const,
      seriesLabel: null,
    };
  }

  function makeCell(columnId: string, raw: string | null, valueType: "decimal" | "text"): Row["cells"][string] {
    return {
      id: newId("cell"),
      rawText: raw,
      currentValue: raw,
      valueType,
      missingReason: raw === null ? "blank" : null,
      origin: "parsed",
      reviewStatus: "unreviewed",
      provenanceIds: [],
      parentCellIds: [],
      notes: [],
    };
  }

  it("does not call a numeric-looking text column a category, and keeps NOAA-style questions off it", () => {
    const c1 = col("Column 1", "decimal");
    const c3 = col("Column 3", "text");
    const rows: Row[] = [
      {
        id: newId("row"),
        sourceOrder: 0,
        cells: { [c1.id]: makeCell(c1.id, "178", "decimal"), [c3.id]: makeCell(c3.id, "class_0", "text") },
      },
      {
        id: newId("row"),
        sourceOrder: 1,
        cells: { [c1.id]: makeCell(c1.id, "14.23", "decimal"), [c3.id]: makeCell(c3.id, "2.43", "text") },
      },
      {
        id: newId("row"),
        sourceOrder: 2,
        cells: { [c1.id]: makeCell(c1.id, "13.20", "decimal"), [c3.id]: makeCell(c3.id, "2.14", "text") },
      },
      {
        id: newId("row"),
        sourceOrder: 3,
        cells: { [c1.id]: makeCell(c1.id, "13.16", "decimal"), [c3.id]: makeCell(c3.id, "2.67", "text") },
      },
      {
        id: newId("row"),
        sourceOrder: 4,
        cells: { [c1.id]: makeCell(c1.id, "14.37", "decimal"), [c3.id]: makeCell(c3.id, "2.50", "text") },
      },
    ];
    const overview = buildOverview(
      {
        version: {
          id: newId("ver"),
          datasetId: newId("ds"),
          parentVersionId: null,
          createdAt: new Date().toISOString(),
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          columns: [c1, c3],
          rowCount: rows.length,
          operationId: null,
          unresolvedFindingCount: 0,
          reviewSummary: { cellsTotal: 10, unreviewed: 10, accepted: 0, corrected: 0, unavailable: 0 },
        },
        rows,
      },
      rows,
    );
    expect(overview.kind).toBe("tabular");
    expect(overview.suggestedQuestions.join(" ")).not.toMatch(/Column 3 appears most often/i);
    expect(overview.suggestedQuestions.join(" ")).not.toMatch(/range of Column 1/i);
    expect(overview.suggestedQuestions.some((q) => /confirm field names/i.test(q))).toBe(true);
    expect(overview.suggestedQuestions.some((q) => /parsed as numbers/i.test(q))).toBe(true);
    expect(overview.highlights.some((h) => /stored as text/i.test(h.title + h.body))).toBe(true);
    expect(overview.highlights.some((h) => /range/i.test(h.body) && /Column 1/.test(h.title))).toBe(true);
    expect(overview.notes.some((n) => /file’s own labels|file's own labels/i.test(n))).toBe(true);
  });
});

describe("deterministic NOAA overview", () => {
  it("profiles average against decimal date without inventing a cause", async () => {
    const owner = makeOwner("overview");
    const seeded = await seedDataset(owner, noaaTable(NOAA_SAMPLE));
    const overview = await getOverview(owner, seeded.dataset.id, seeded.snapshot.version.id);
    expect(overview.kind).toBe("time_series");
    expect(overview.highlights.length).toBeGreaterThan(0);
    expect(overview.highlights.some((h) => /average/i.test(h.body) || /average/i.test(h.title))).toBe(true);
    expect(overview.facts.some((f) => f.operation === "first")).toBe(true);
    expect(overview.facts.some((f) => f.operation === "last")).toBe(true);
    expect(overview.facts.some((f) => f.id === "fact_first_average")).toBe(true);
    expect(overview.facts.some((f) => f.id === "fact_first_decimal_date")).toBe(true);
    expect(overview.suggestedQuestions.length).toBeGreaterThan(0);
    expect(overview.notes.join(" ")).not.toMatch(/policy|campaign|disease/i);
  });
});

describe("getRows presets", () => {
  it("edited preset returns only rows with a user_edit cell", async () => {
    const owner = makeOwner("rows-preset");
    const seeded = await seedDataset(owner, noaaTable(NOAA_SAMPLE));
    const avg = seeded.columns[3].id;
    const v2 = await commitManualEdit(owner, seeded, seeded.snapshot, 0, avg, "330.00");
    const edited = await getRows(owner, seeded.dataset.id, { versionId: v2.version.id, preset: "edited" });
    const all = await getRows(owner, seeded.dataset.id, { versionId: v2.version.id, preset: "all" });
    expect(edited.totalRows).toBe(1);
    expect(all.totalRows).toBe(NOAA_SAMPLE.length);
    expect(Object.values(edited.rows[0].cells).some((c) => c.origin === "user_edit")).toBe(true);
  });
});

describe("insight validation", () => {
  function fact(id: string, delta = "1.5"): AnalysisFact {
    return {
      id,
      versionId: newId("ver"),
      operation: "adjacent_change",
      columnId: newId("col"),
      columnLabel: "average",
      unit: "ppm",
      value: { kind: "pair", from: "330.0", to: "331.5", delta },
      evidence: { kind: "rows", rowIds: [newId("row")], cellIds: [newId("cell")], count: 2 },
      limitations: [],
    };
  }

  it("accepts templates that only quantify through fact slots", () => {
    const f = fact(newId("fact"));
    const cards: InsightCard[] = [
      {
        type: "trend",
        title: "Change",
        template: "average moved {{fact:" + f.id + "}} over the observed interval.",
        factIds: [f.id],
        limitations: ["Not a cause."],
        followUps: [],
      },
    ];
    expect(validateInsights(cards, [f])).toHaveLength(1);
  });

  it("accepts catalog numbers when the model omits placeholders", () => {
    const f = fact("fact_adjacent_change_average");
    const cards: InsightCard[] = [
      {
        type: "trend",
        title: "Change",
        template: "average moved from 330.0 to 331.5 over the observed interval.",
        factIds: [f.id],
        limitations: ["Not a cause."],
        followUps: [],
      },
    ];
    expect(validateInsights(cards, [f])).toHaveLength(1);
  });

  it("keeps a grounded card when extra factIds are unknown", () => {
    const f = fact("fact_adjacent_change_average");
    const cards: InsightCard[] = [
      {
        type: "trend",
        title: "Change",
        template: "average moved {{fact:" + f.id + "}} over the observed interval.",
        factIds: [f.id, "fact_not_in_catalog"],
        limitations: ["Not a cause."],
        followUps: [],
      },
    ];
    expect(validateInsights(cards, [f])[0]?.factIds).toEqual([f.id]);
  });

  it("rejects invented numbers and unsupported rise language", () => {
    const f = fact(newId("fact"), "-2.0");
    const cards: InsightCard[] = [
      {
        type: "trend",
        title: "Bad",
        template: "It rose 12.4 ppm because of a marketing campaign.",
        factIds: [f.id],
        limitations: [],
        followUps: [],
      },
    ];
    expect(() => validateInsights(cards, [f])).toThrow(/ground/i);
  });

  it("parses the analysis contract version", () => {
    const raw = JSON.stringify({
      contractVersion: ANALYSIS_CONTRACT_VERSION,
      insights: [
        {
          type: "contains",
          title: "Rows",
          template: "There are {{fact:fact_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa}} rows.",
          factIds: ["fact_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
          limitations: [],
          followUps: [],
        },
      ],
    });
    expect(parseModelInsights(raw).insights).toHaveLength(1);
  });
});

describe("buildOverview missingness", () => {
  it("does not treat a missing y as zero", () => {
    const snapshot = {
      version: {
        id: newId("ver"),
        datasetId: newId("ds"),
        parentVersionId: null,
        createdAt: new Date().toISOString(),
        schemaVersion: CONTRACT_SCHEMA_VERSION,
        columns: [
          {
            id: "col_x",
            label: "decimal date",
            semanticRole: "x" as const,
            dataType: "decimal" as const,
            unit: null,
            currency: null,
            percentRepresentation: null,
            datePolicy: null,
            sourceScale: "linear" as const,
            seriesLabel: null,
          },
          {
            id: "col_y",
            label: "average",
            semanticRole: "y" as const,
            dataType: "decimal" as const,
            unit: "ppm",
            currency: null,
            percentRepresentation: null,
            datePolicy: null,
            sourceScale: "linear" as const,
            seriesLabel: null,
          },
        ],
        rowCount: 2,
        operationId: null,
        unresolvedFindingCount: 0,
        reviewSummary: { cellsTotal: 4, unreviewed: 4, accepted: 0, corrected: 0, unavailable: 0 },
      },
      rows: [
        {
          id: newId("row"),
          sourceOrder: 0,
          cells: {
            col_x: cell("parsed", "1975.7"),
            col_y: cell("parsed", "330.00"),
          },
        },
        {
          id: newId("row"),
          sourceOrder: 1,
          cells: {
            col_x: { ...cell("parsed", "1975.8"), currentValue: "1975.8", rawText: "1975.8", missingReason: null },
            col_y: { ...cell("parsed", null), currentValue: null, rawText: null, missingReason: "not_reported" as const },
          },
        },
      ],
    };
    const overview = buildOverview(snapshot, snapshot.rows);
    const cover = overview.facts.find((f) => f.operation === "missing_coverage");
    expect(cover?.value).toMatchObject({ kind: "coverage", valid: 1, missing: 1, total: 2 });
  });
});
