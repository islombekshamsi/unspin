import { describe, expect, it } from "vitest";
import { axisDistribution, safeSeriesDomain } from "./auto-fit";

describe("automatic display ranges", () => {
  it("focuses a dense numeric cluster without deleting its extreme observation", () => {
    const input = [...Array.from({ length: 99 }, (_, i) => 11 + i / 25), 178];
    const stats = axisDistribution(input)!;
    expect(stats.domain).not.toBeNull();
    expect(stats.domain![0]).toBeLessThan(11);
    expect(stats.domain![1]).toBeLessThan(20);
    expect(stats.outside).toBe(1);
    expect(stats.count).toBe(100);
    expect(stats.max).toBe(178);
    expect(input).toHaveLength(100);
  });
  it("uses sample variance and handles null-like nonfinite, sparse and constant inputs", () => {
    expect(axisDistribution([1, 2, 3])!.variance).toBe(1);
    expect(axisDistribution([1, 2, 3])!.sd).toBe(1);
    expect(axisDistribution([1, 2, 3])!.median).toBe(2);
    expect(axisDistribution([NaN, Infinity])).toBeNull();
    expect(axisDistribution([5])!.domain).toBeNull();
    expect(axisDistribution(Array(20).fill(5))!.domain).toBeNull();
  });
  it("does not trim a broad distribution or disproportionately exclude a series", () => {
    expect(axisDistribution(Array.from({ length: 100 }, (_, i) => i))!.domain).toBeNull();
    expect(safeSeriesDomain([0, 10], [[1, 2, 3], [100, 101]])).toBeNull();
    expect(safeSeriesDomain([0, 10], [[1, 2, 3], [4, 5]])).toEqual([0, 10]);
  });
  it("keeps a positive fitted domain on a logarithmic axis", () => {
    const stats = axisDistribution([...Array(99).fill(2), 1000], true)!;
    expect(stats.domain![0]).toBeGreaterThan(0);
    expect(stats.domain![1]).toBeLessThan(3);
    expect(stats.outside).toBe(1);
  });
});
