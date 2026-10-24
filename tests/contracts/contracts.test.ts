import { describe, expect, it } from "vitest";
import {
  CellSchema,
  DatasetSchema,
  DecimalStringSchema,
  NormalizedRectSchema,
  TransformOperationSchema,
  newId,
} from "@/contracts";
import { operationHash } from "@/server/transforms";

const baseCell = {
  id: "cell_1",
  rawText: "12.50",
  valueType: "decimal" as const,
  origin: "parsed" as const,
  reviewStatus: "unreviewed" as const,
  provenanceIds: ["prov_1"],
  parentCellIds: [],
  notes: [],
};

describe("cell missingness invariant", () => {
  it("accepts a present value without a missing reason", () => {
    expect(CellSchema.safeParse({ ...baseCell, currentValue: "12.50", missingReason: null }).success).toBe(true);
  });
  it("rejects a null value without a missing reason (missing never becomes silent)", () => {
    expect(CellSchema.safeParse({ ...baseCell, currentValue: null, missingReason: null }).success).toBe(false);
  });
  it("rejects a present value that also claims to be missing", () => {
    expect(CellSchema.safeParse({ ...baseCell, currentValue: "0", missingReason: "blank" }).success).toBe(false);
  });
});

describe("decimal strings", () => {
  it.each(["0", "-12.5", "12345678901234567890", "1.0e-3"])("accepts %s", (v) => {
    expect(DecimalStringSchema.safeParse(v).success).toBe(true);
  });
  it.each(["", "1,000", "007", "NaN", "Infinity", "12.", ".5"])("rejects %s", (v) => {
    expect(DecimalStringSchema.safeParse(v).success).toBe(false);
  });
});

describe("normalized region", () => {
  it("rejects a region that extends past the source", () => {
    expect(NormalizedRectSchema.safeParse({ x: 0.8, y: 0, width: 0.3, height: 0.5 }).success).toBe(false);
  });
});

describe("dataset coverage note", () => {
  const ds = {
    id: "ds_1",
    sourceId: "src_1",
    sourceSelectionId: "sel_1",
    title: "t",
    description: "",
    createdAt: new Date().toISOString(),
    currentVersionId: "ver_1",
    initialVersionId: "ver_1",
    extractionMethod: "vision_estimate",
    coverageAcknowledgedAt: null,
    extraction: null,
    importIssues: [],
  };
  it("requires a note for partial coverage", () => {
    expect(DatasetSchema.safeParse({ ...ds, coverage: "partial_selection", coverageNote: null }).success).toBe(false);
    expect(DatasetSchema.safeParse({ ...ds, coverage: "partial_selection", coverageNote: "Legend series B unreadable" }).success).toBe(true);
  });
});

describe("transform allowlist", () => {
  it("rejects unknown operation types", () => {
    expect(TransformOperationSchema.safeParse({ type: "eval", code: "1+1" }).success).toBe(false);
  });
  it("binds the operation hash to the base version and is key-order independent", () => {
    const a = { type: "rename_column", columnId: "col_1", newLabel: "Year" } as const;
    const b = { newLabel: "Year", columnId: "col_1", type: "rename_column" } as const;
    expect(operationHash("ver_1", a)).toBe(operationHash("ver_1", b));
    expect(operationHash("ver_1", a)).not.toBe(operationHash("ver_2", a));
  });
});

describe("ids", () => {
  it("are prefixed, unique, and URL-safe", () => {
    const a = newId("row");
    expect(a).toMatch(/^row_[a-f0-9]{32}$/);
    expect(newId("row")).not.toBe(a);
  });
});
