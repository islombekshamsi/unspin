import { describe, expect, it } from "vitest";
import { zoomAt, zoomDomain } from "./zoom";

describe("display-only chart zoom", () => {
  it("anchors the visible data coordinate under the mouse and returns to the full range", () => {
    const next = zoomAt(1, 0, 2, 0.1);
    const before = zoomDomain([0, 100], 1);
    const after = zoomDomain([0, 100], next.factor, next.offset);
    expect(before[0] + 0.1 * (before[1] - before[0])).toBeCloseTo(after[0] + 0.1 * (after[1] - after[0]));
    expect(zoomAt(next.factor, next.offset, 0.5, 0.9)).toEqual({ factor: 1, offset: 0 });
    expect(zoomAt(64, 0, 2, 0.5).factor).toBe(64);
  });
  it("tightens the visible interval and pans in data units without mutating the domain", () => {
    const domain: [number, number] = [10, 30];
    expect(zoomDomain(domain, 2)).toEqual([15, 25]);
    expect(zoomDomain(domain, 2, 0.25)).toEqual([20, 30]);
    expect(domain).toEqual([10, 30]);
    expect(zoomDomain(domain, 1)).toEqual(domain);
  });
  it("zooms a logarithmic axis geometrically and refuses invalid domains", () => {
    const [low, high] = zoomDomain([1, 10000], 2, 0, true);
    expect(low).toBeCloseTo(10);
    expect(high).toBeCloseTo(1000);
    expect(zoomDomain([0, 100], 2, 0, true)).toEqual([0, 100]);
    expect(zoomDomain([5, 5], 2)).toEqual([5, 5]);
  });
});
