import { describe, expect, it } from "vitest";

import { correlationWeights } from "./correlation";

const MINUTE = 60_000;
const SPAN = 15 * MINUTE;
const EPOCH = Date.parse("2026-10-13T08:00:00Z");

interface Report {
  at: number;
  count: number;
}

/** Slow, independent definition used only as a small-set reference oracle. */
function referenceWeights(reports: readonly Report[], spanMs: number) {
  return reports.map((report) => report.count / reports.reduce(
    (density, other) => density + other.count * Math.max(0, 1 - Math.abs(other.at - report.at) / spanMs),
    0,
  ));
}

function recentProxy(reports: readonly (Report & { value: number })[]) {
  const weights = correlationWeights(reports, SPAN);
  const latest = reports.at(-1)!.at;
  let mass = 0;
  let value = 0;

  for (let index = 0; index < reports.length; index += 1) {
    const weight = weights[index] * Math.pow(0.5, (latest - reports[index].at) / (20 * MINUTE));
    mass += weight;
    value += weight * reports[index].value;
  }

  return value / mass;
}

describe("continuous report correlation", () => {
  it("returns no mass for no reports and one vote for an isolated compressed burst", () => {
    expect(correlationWeights([], SPAN)).toEqual(new Float64Array());
    expect([...correlationWeights([{ at: EPOCH, count: 2000 }], SPAN)]).toEqual([1]);
  });

  it("matches the pairwise definition across seeded timestamps and multiplicities", () => {
    let state = 2026;
    const random = () => {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
      return state / 2 ** 32;
    };

    for (let sample = 0; sample < 50; sample += 1) {
      let at = EPOCH;
      const reports = Array.from({ length: 64 }, () => {
        // Include exact ties, overlapping windows, and independent groups.
        at += Math.floor(random() * 6) * 4 * MINUTE;
        return { at, count: 1 + Math.floor(random() * 2000) };
      });
      const actual = correlationWeights(reports, SPAN);
      const expected = referenceWeights(reports, SPAN);

      for (let index = 0; index < reports.length; index += 1) {
        expect(actual[index]).toBeCloseTo(expected[index], 11);
      }
    }
  });

  it("does not let an old burst suppress a clear report an hour later", () => {
    const reports = (count: number) => [
      { at: EPOCH, count, value: 0 },
      { at: EPOCH + 60 * MINUTE, count: 1, value: 1 },
    ];

    expect([...correlationWeights(reports(2000), SPAN)]).toEqual([1, 1]);
    expect(recentProxy(reports(2000))).toBe(recentProxy(reports(1)));
    expect(recentProxy(reports(2000))).toBeCloseTo(8 / 9, 12);
  });

  it("preserves mixed-label multiplicity as exact ties separate by a millisecond", () => {
    const tied = [{ at: EPOCH, count: 3, value: 1 / 3 }];
    const separated = [
      { at: EPOCH, count: 2, value: 0 },
      { at: EPOCH + 1, count: 1, value: 1 },
    ];
    const uncompressed = [
      { at: EPOCH, count: 1, value: 0 },
      { at: EPOCH, count: 1, value: 0 },
      { at: EPOCH, count: 1, value: 1 },
    ];

    expect(recentProxy(tied)).toBe(1 / 3);
    expect(recentProxy(uncompressed)).toBeCloseTo(recentProxy(tied), 12);
    expect(Math.abs(recentProxy(separated) - recentProxy(tied))).toBeLessThan(0.000001);
  });

  it("has no weight jump when reports cross the correlation span", () => {
    const massAt = (distance: number) => correlationWeights([
      { at: EPOCH, count: 1 },
      { at: EPOCH + distance, count: 1 },
    ], SPAN)[0];

    expect(massAt(SPAN)).toBe(1);
    expect(massAt(SPAN + 1)).toBe(1);
    expect(Math.abs(massAt(SPAN - 1) - massAt(SPAN))).toBeLessThan(0.000002);
  });

  it("keeps precise nearby weights after large calendar gaps and compressed counts", () => {
    const later = EPOCH + 20 * 365 * 24 * 60 * MINUTE;
    const reports = [
      { at: EPOCH, count: 1_000_000 },
      { at: EPOCH + 1, count: 1 },
      { at: later, count: 3 },
      { at: later + SPAN - 1, count: 1 },
      { at: later + SPAN + 1, count: 2000 },
    ];
    const actual = correlationWeights(reports, SPAN);
    const expected = referenceWeights(reports, SPAN);

    for (let index = 0; index < reports.length; index += 1) {
      expect(actual[index]).toBeCloseTo(expected[index], 11);
    }
  });

  it("handles a large dense history without pairwise report comparisons", () => {
    const reports = Array.from({ length: 100_000 }, (_, index) => ({ at: EPOCH + index, count: 1 }));
    const weights = correlationWeights(reports, SPAN);

    expect(weights).toHaveLength(reports.length);
    expect(weights.every((weight) => Number.isFinite(weight) && weight > 0 && weight <= 1)).toBe(true);
    expect(weights[0]).toBeCloseTo(weights.at(-1)!, 10);
    const mass = weights.reduce((sum, weight) => sum + weight, 0);
    expect(mass).toBeGreaterThanOrEqual(1);
    expect(mass).toBeLessThan(1.2);
  }, 3000);
});
