import { describe, expect, it } from "vitest";
import type { Provenance, Source, SourceSelection } from "@/contracts";
import { buildAnchors } from "./anchors";

const source = {
  id: "src_1",
  kind: "image",
  image: { format: "png", width: 200, height: 100, orientedWidth: 200, orientedHeight: 100, orientation: 1 },
} as unknown as Source;

const selection = {
  id: "sel_1",
  kind: "image_region",
  transform: { orientedPixelBox: { left: 100, top: 0, width: 100, height: 50 } },
} as unknown as SourceSelection;

function prov(id: string, over: Partial<Provenance>): Provenance {
  return {
    id,
    sourceId: "src_1",
    sourceSelectionId: "sel_1",
    locator: { type: "image_box", coordinateSystem: "oriented_source_pixels", box: { left: 0, top: 0, width: 20, height: 10 } },
    locatorOrigin: "parser",
    locatorAvailability: "precise",
    label: "",
    extractionMethod: "vision_estimate",
    createdAt: new Date(0).toISOString(),
    ...over,
  } as Provenance;
}

describe("buildAnchors", () => {
  it("distinguishes precise boxes from unverified model hints", () => {
    const anchors = buildAnchors(
      source,
      selection,
      [prov("p1", {}), prov("p2", { locatorOrigin: "model_hint" })],
      new Set(["p1", "p2"]),
      () => null,
      false,
    );
    expect(anchors.map((a) => [a.style, a.text])).toEqual([
      ["precise", "source location"],
      ["hint", "model hint (unverified)"],
    ]);
    expect(anchors[0].rect).toEqual({ x: 0, y: 0, width: 0.1, height: 0.1 });
  });

  it("outlines only the selected region for region_only and never invents a box for page_only", () => {
    const anchors = buildAnchors(
      source,
      selection,
      [
        prov("r1", { locatorAvailability: "region_only", locator: { type: "figure_label", label: "Fig. 2", pageNumber: null } }),
        prov("g1", { locatorAvailability: "page_only", locator: { type: "pdf_page", pageNumber: 2 } }),
      ],
      new Set(["r1", "g1"]),
      () => null,
      false,
    );
    const region = anchors.find((a) => a.style === "region")!;
    expect(region.rect).toEqual({ x: 0.5, y: 0, width: 0.5, height: 0.5 });
    expect(region.text).toContain("exact mark not located");
    const page = anchors.find((a) => a.style === "page")!;
    expect(page.rect).toBeNull();
    expect(page.pageNumber).toBe(2);
  });

  it("groups shared locations and omits inactive anchors unless asked", () => {
    const ps = [prov("a", {}), prov("b", {}), prov("c", { locator: { type: "image_box", coordinateSystem: "oriented_source_pixels", box: { left: 50, top: 50, width: 10, height: 10 } } })];
    const onlyActive = buildAnchors(source, selection, ps, new Set(["a"]), () => null, false);
    expect(onlyActive).toHaveLength(1);
    expect(onlyActive[0].provenanceIds).toEqual(["a"]);
    const all = buildAnchors(source, selection, ps, new Set(["a"]), () => null, true);
    expect(all).toHaveLength(2);
    expect(all[0].provenanceIds).toEqual(["a", "b"]);
    expect(all[0].active).toBe(true);
    expect(all[1].active).toBe(false);
  });

  it("does not draw PDF boxes until the page geometry is known", () => {
    const pdf = { ...source, kind: "pdf", image: null } as unknown as Source;
    const p = prov("x", { locator: { type: "pdf_box", pageNumber: 1, coordinateSystem: "pdf_user_space_points", box: { x0: 0, y0: 0, x1: 100, y1: 100 } } });
    expect(buildAnchors(pdf, null, [p], new Set(["x"]), () => null, false)[0].rect).toBeNull();
    const withFrame = buildAnchors(pdf, null, [p], new Set(["x"]), () => ({ view: [0, 0, 200, 200], rotation: 0 }), false);
    expect(withFrame[0].rect).toEqual({ x: 0, y: 0.5, width: 0.5, height: 0.5 });
  });
});
