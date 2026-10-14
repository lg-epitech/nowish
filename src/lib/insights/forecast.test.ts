import { describe, expect, it } from "vitest";

import { MS_PER_DAY, MS_PER_MINUTE, zonedParts } from "@/lib/time";
import type { Feel, Observation } from "@/lib/types";

import { buildCongestionModel, type LiveReport } from "./congestion";
import { buildForecast, indexAt, verdictAt, type Forecast, type ForecastPoint } from "./forecast";
import { buildInsights, verdictFor } from "./index";

const NOW = Date.parse("2026-10-13T08:00:00Z");
const PRIOR = { cadenceHours: 24, typicalMinutes: 10 };

function report(at: number, feel: Feel): Observation {
  const iso = new Date(at).toISOString();
  return {
    id: `${iso}-${feel}`, routineId: "area", observedAt: iso, timezone: "UTC",
    ...zonedParts(at, "UTC"), feel, createdAt: iso, updatedAt: iso,
  };
}

function history(count: number, feel: Feel = "good") {
  return Array.from({ length: count }, (_, index) => report(NOW - (index + 1) * MS_PER_DAY, feel));
}

function insights(observations: Observation[], now = NOW) {
  return buildInsights({ sessions: [], observations, prior: PRIOR, now, timeZone: "UTC" });
}

function point(minutes: number, score: number, supported = true, live: LiveReport | null = null): ForecastPoint {
  const at = NOW + minutes * MS_PER_MINUTE;
  const local = zonedParts(at, "UTC");
  return {
    at, localMinute: local.localMinute, localWeekday: local.localWeekday, score, live,
    congestion: {
      probability: score, confidence: supported ? "moderate" : "low",
      effectiveReports: supported ? 6 : 1, supportingDays: supported ? 8 : 1, live,
    },
  };
}

function judge(points: ForecastPoint[], index = 0, horizonSteps = points.length - 1) {
  const forecast: Forecast = { from: NOW, stepMinutes: 5, horizonSteps, points };
  const congestion = { ...buildCongestionModel({ sessions: [], observations: [], now: NOW }), ratedCount: 10 };
  return verdictAt({ forecast, index, sessions: [], congestion, prior: PRIOR });
}

describe("supported congestion opportunities", () => {
  it("offers a nearby usable opportunity instead of waiting nearly a day for the maximum", () => {
    const clearMornings = history(30).flatMap((entry) => [
      entry, report(Date.parse(entry.observedAt) + 60 * MS_PER_MINUTE, "good"),
    ]);
    const result = insights([...clearMornings, report(NOW, "bad")]);
    const verdict = verdictFor(result);
    const waitMinutes = (verdict.bestAt - NOW) / MS_PER_MINUTE;
    expect(waitMinutes).toBeGreaterThanOrEqual(20);
    expect(waitMinutes).toBeLessThanOrEqual(120);
    expect(verdict.window?.from).toBe(verdict.bestAt);
  });

  it("does not promote unsupported nearby recovery from an 08:00-only history", () => {
    const result = insights([...history(30), report(NOW, "bad")]);
    const verdict = verdictFor(result);
    const nearby = result.forecast.points.filter((entry) => entry.at > NOW && entry.at <= NOW + 120 * MS_PER_MINUTE);
    expect(nearby.some((entry) => entry.score >= 0.65
      && entry.congestion.effectiveReports >= 4 && entry.congestion.supportingDays >= 4)).toBe(false);
    expect(verdict.bestAt === NOW || verdict.bestAt > NOW + 120 * MS_PER_MINUTE).toBe(true);
  });

  it("uses the first materially better supported candidate even when a later maximum is higher", () => {
    const verdict = judge([point(0, 0.4), point(60, 0.7), point(22 * 60, 0.98)]);
    expect(verdict.bestAt).toBe(NOW + 60 * MS_PER_MINUTE);
  });

  it("does not suggest a time from only two supporting dates", () => {
    const result = insights([...history(2), report(NOW, "bad")]);
    const verdict = verdictFor(result);
    expect(verdict.bestAt).toBe(NOW);
    expect(verdict.window).toBeNull();
  });

  it("does not promise recovery as a busy report fades without comparable historical support", () => {
    const live: LiveReport = { at: NOW, feel: "bad", strength: 0.85, value: 0, conflicted: false, reportCount: 1 };
    const verdict = judge([point(0, 0.1, false, live), point(60, 0.8, false), point(120, 0.9, false)]);
    expect(verdict.kind).toBe("later");
    expect(verdict.bestAt).toBe(NOW);
    expect(verdict.window).toBeNull();
  });

  it("avoids likely-usable or likely-busy labels based on unrelated baseline evidence alone", () => {
    expect(judge([point(0, 0.8, false)]).kind).toBe("nowish");
    expect(judge([point(0, 0.2, false)]).kind).toBe("nowish");
  });

  it("allows an unconflicted fresh clear report to support now without inventing a future window", () => {
    const live: LiveReport = { at: NOW, feel: "good", strength: 0.85, value: 1, conflicted: false, reportCount: 1 };
    expect(judge([point(0, 0.9, false, live), point(60, 0.8, false)])).toMatchObject({ kind: "now", bestAt: NOW, window: null });
    expect(judge([point(0, 0.9, false, { ...live, conflicted: true })]).kind).toBe("nowish");
  });

  it("does not postpone an already supported usable moment to chase a higher score", () => {
    const verdict = judge([point(0, 0.75), point(60, 0.95)]);
    expect(verdict.kind).toBe("now");
    expect(verdict.bestAt).toBe(NOW);
  });

  it("ends a favorable window when comparable support disappears", () => {
    const verdict = judge([point(0, 0.4), point(60, 0.7), point(65, 0.8, false), point(70, 0.9)]);
    expect(verdict.window).toEqual({ from: NOW + 60 * MS_PER_MINUTE, to: NOW + 60 * MS_PER_MINUTE });
  });

  it("ends a favorable window when usability falls below the qualifying threshold", () => {
    const verdict = judge([point(0, 0.4), point(60, 0.7), point(65, 0.64), point(70, 0.9)]);
    expect(verdict.window?.to).toBe(NOW + 60 * MS_PER_MINUTE);
    const slightImprovement = judge([point(0, 0.6), point(60, 0.72), point(65, 0.67)]);
    expect(slightImprovement.window?.to).toBe(NOW + 60 * MS_PER_MINUTE);
  });

  it("requires both meaningful improvement and sufficient usability", () => {
    const verdict = judge([point(0, 0.6), point(30, 0.69), point(60, 0.72)]);
    expect(verdict.bestAt).toBe(NOW + 60 * MS_PER_MINUTE);
    expect(judge([point(0, 0.6), point(60, 0.7)]).bestAt).toBe(NOW + 60 * MS_PER_MINUTE);
    expect(judge([point(0, 0.2), point(60, 0.64)]).bestAt).toBe(NOW);
  });
});

describe("forecast bounds", () => {
  it("clamps invalid indices to actual selectable points", () => {
    const points = [point(0, 0.5), point(5, 0.5), point(10, 0.5)];
    expect(judge(points, NaN).at).toBe(NOW);
    expect(judge(points, -Infinity).at).toBe(NOW);
    expect(judge(points, -1).at).toBe(NOW);
    expect(judge(points, Infinity).at).toBe(points[2].at);
    expect(judge(points, 100).at).toBe(points[2].at);
    expect(judge(points, 1.8).at).toBe(points[1].at);
    expect(judge(points, 100, 288).at).toBe(points[2].at);
  });

  it("includes the full lookahead for the final selectable moment", () => {
    const model = buildCongestionModel({ sessions: [], observations: [], now: NOW });
    const forecast = buildForecast({ congestion: model, now: NOW, timeZone: "UTC" });
    const selected = forecast.horizonSteps;
    const last = forecast.points.length - 1;
    expect(forecast.points[selected].at - NOW).toBe(MS_PER_DAY);
    expect(forecast.points[last].at - forecast.points[selected].at).toBe(MS_PER_DAY);
    forecast.points[last] = point(2 * 24 * 60, 0.8);
    const verdict = verdictAt({ forecast, index: selected, sessions: [], congestion: model, prior: PRIOR });
    expect(verdict.bestAt).toBe(NOW + 2 * MS_PER_DAY);
  });

  it("never searches beyond 24 hours from the selected moment", () => {
    const verdict = judge([point(0, 0.5), point(24 * 60 + 5, 0.9)]);
    expect(verdict.bestAt).toBe(NOW);
  });

  it("handles non-finite time lookups without producing invalid indices", () => {
    const model = buildCongestionModel({ sessions: [], observations: [], now: NOW });
    const forecast = buildForecast({ congestion: model, now: NOW, timeZone: "UTC" });
    expect(indexAt(forecast, NaN)).toBe(0);
    expect(indexAt(forecast, -Infinity)).toBe(0);
    expect(indexAt(forecast, Infinity)).toBe(forecast.horizonSteps);
    expect(indexAt(forecast, forecast.points.at(-1)!.at)).toBe(forecast.horizonSteps);
  });
});
