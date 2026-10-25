import { describe, expect, it } from "vitest";
import { DEFAULT_LAYOUT, normalizeLayout, serializeLayout } from "@/features/workspace/lib/layout-state";

describe("workspace layout state", () => {
  it("opens on Overview when nothing is stored", () => {
    expect(normalizeLayout(null)).toEqual(DEFAULT_LAYOUT);
  });

  it("round-trips a saved tab", () => {
    expect(normalizeLayout(serializeLayout({ version: 2, tab: "source" }))).toEqual({ version: 2, tab: "source" });
    expect(normalizeLayout(serializeLayout({ version: 2, tab: "data" }))).toEqual({ version: 2, tab: "data" });
  });

  it("never restores the earlier fixed-height layout state", () => {
    expect(normalizeLayout(JSON.stringify({ overviewOpen: true, focus: "chart", tab: "chart" }))).toEqual(DEFAULT_LAYOUT);
    expect(normalizeLayout(JSON.stringify({ overviewOpen: false, focus: null, tab: "data" }))).toEqual(DEFAULT_LAYOUT);
  });

  it("rejects malformed or unknown values", () => {
    expect(normalizeLayout("{not json")).toEqual(DEFAULT_LAYOUT);
    expect(normalizeLayout(JSON.stringify({ version: 2, tab: "chart" }))).toEqual(DEFAULT_LAYOUT);
    expect(normalizeLayout(JSON.stringify([1, 2]))).toEqual(DEFAULT_LAYOUT);
  });
});
