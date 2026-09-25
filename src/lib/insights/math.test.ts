import { describe, expect, it } from "vitest";

import { decayWeight, erf, median, niceBinWidth, normalCdf, quantile, weightedQuantile } from "./math";

describe("distribution helpers", () => {
  it("computes Hazen quantiles for equal weights", () => {
    expect(median([1, 2, 3])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(quantile([10, 20, 30, 40], 0.25)).toBe(15);
    expect(median([])).toBeNull();
  });

  it("lets heavier observations pull the weighted median", () => {
    expect(weightedQuantile([10, 20], [3, 1], 0.5)).toBe(12.5);
    expect(weightedQuantile([10, 20, 30], [0, 1, 0], 0.5)).toBe(20);
  });

  it("approximates the normal CDF", () => {
    expect(erf(0)).toBeCloseTo(0, 6);
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1.959964)).toBeCloseTo(0.975, 4);
    expect(normalCdf(-1)).toBeCloseTo(0.158655, 4);
  });

  it("halves weights every half-life", () => {
    expect(decayWeight(0, 45)).toBe(1);
    expect(decayWeight(45 * 86_400_000, 45)).toBeCloseTo(0.5, 6);
    expect(decayWeight(-1000, 45)).toBe(1);
  });

  it("picks round histogram bin widths", () => {
    expect(niceBinWidth(8, 10)).toBe(1);
    expect(niceBinWidth(14, 10)).toBe(2);
    expect(niceBinWidth(45, 10)).toBe(5);
    expect(niceBinWidth(160, 10)).toBe(20);
  });
});
