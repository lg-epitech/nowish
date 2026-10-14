import { circularMinuteDistance, MS_PER_MINUTE, zonedParts } from "@/lib/time";
import type { Feel } from "@/lib/types";

import { congestionAt, type CongestionEstimate, type CongestionModel, type LiveReport } from "./congestion";
import { gaussian, weightedQuantile } from "./math";
import type { PreparedSession, RoutinePrior } from "./prepare";

const USABLE_THRESHOLD = 0.65;
const BUSY_THRESHOLD = 0.35;
const MATERIAL_IMPROVEMENT = 0.1;
const LOOKAHEAD_MS = 24 * 60 * MS_PER_MINUTE;

export interface ForecastPoint {
  at: number;
  localMinute: number;
  localWeekday: number;
  /** The same 0–1 usability estimate displayed as the congestion score. */
  score: number;
  congestion: CongestionEstimate;
  live: LiveReport | null;
}

export interface Forecast {
  from: number;
  stepMinutes: number;
  /** Points in a 24-hour window; points includes a second window for lookahead. */
  horizonSteps: number;
  points: ForecastPoint[];
}

export type Reason =
  | { code: "no-reports" }
  | { code: "reported-congestion"; ratedCount: number; supportingDays: number }
  | { code: "recent-report"; feel: Feel; at: number; conflicted?: boolean; reportCount?: number }
  | { code: "takes"; minutes: number; doneBy: number | null };

export type VerdictKind = "now" | "nowish" | "later";

export interface Verdict {
  kind: VerdictKind;
  at: number;
  /** Earliest materially better moment, or this moment if none is supported. */
  bestAt: number;
  window: { from: number; to: number } | null;
  expectedMinutes: number;
  reasons: Reason[];
  point: ForecastPoint;
}

export function buildForecast(input: {
  congestion: CongestionModel;
  now: number;
  timeZone: string;
}): Forecast {
  const stepMinutes = 5;
  const horizonSteps = 288;
  const stepMs = stepMinutes * MS_PER_MINUTE;
  const firstRound = Math.floor(input.now / stepMs) * stepMs + stepMs;
  const points: ForecastPoint[] = [];

  // Include the final endpoint so the last selectable moment also has a full
  // 24-hour lookahead. Only the first window is displayed by the ribbon.
  for (let step = 0; step <= horizonSteps * 2; step += 1) {
    const at = step === 0 ? input.now : firstRound + (step - 1) * stepMs;
    const local = zonedParts(at, input.timeZone);
    const congestion = congestionAt(input.congestion, at, local.localMinute, local.localWeekday);
    points.push({ at, localMinute: local.localMinute, localWeekday: local.localWeekday, score: congestion.probability, congestion, live: congestion.live });
  }

  return { from: input.now, stepMinutes, horizonSteps, points };
}

/** The forecast point closest to ms, within the displayed 24-hour window. */
export function indexAt(forecast: Forecast, ms: number) {
  const { points, horizonSteps, stepMinutes } = forecast;
  if (points.length === 0 || Number.isNaN(ms)) return 0;
  const last = Math.min(horizonSteps, points.length - 1);
  if (ms <= points[0].at || points.length < 2) return 0;
  if (ms <= points[1].at) return ms - points[0].at < points[1].at - ms ? 0 : 1;
  return Math.min(last, 1 + Math.round((ms - points[1].at) / (stepMinutes * MS_PER_MINUTE)));
}

/** Enough comparable historical evidence to make a recommendation for an hour. */
export function hasComparableEvidence(estimate: CongestionEstimate) {
  return (estimate.confidence === "moderate" || estimate.confidence === "high")
    && estimate.effectiveReports >= 4 && estimate.supportingDays >= 4;
}

/** Duration statistics remain separate from the chance that the area is usable. */
export function expectedMinutesAt(sessions: readonly PreparedSession[], prior: RoutinePrior, localMinute: number) {
  const values = sessions.map((session) => session.minutes);
  const weights = sessions.map((session) => session.weight * (0.35 + 0.65 * gaussian(circularMinuteDistance(session.localMinute, localMinute), 120)));
  values.push(prior.typicalMinutes);
  weights.push(sessions.length >= 5 ? 0.25 : 1);
  return weightedQuantile(values, weights, 0.5) ?? prior.typicalMinutes;
}

export function verdictAt(input: {
  forecast: Forecast;
  index: number;
  sessions: readonly PreparedSession[];
  congestion: CongestionModel;
  prior: RoutinePrior;
}): Verdict {
  const { forecast, sessions, prior } = input;
  if (forecast.points.length === 0) throw new RangeError("A forecast needs at least one point");
  const lastSelectable = Math.min(forecast.horizonSteps, forecast.points.length - 1);
  const requested = input.index === Infinity ? lastSelectable : Number.isFinite(input.index) ? Math.trunc(input.index) : 0;
  const index = Math.max(0, Math.min(requested, lastSelectable));
  const point = forecast.points[index];
  const historicalSupport = hasComparableEvidence(point.congestion);
  const live = point.live && point.live.strength >= 0.2 && !point.live.conflicted ? point.live : null;
  const kind: VerdictKind = point.score >= USABLE_THRESHOLD && (historicalSupport || live?.feel === "good")
    ? "now" : point.score <= BUSY_THRESHOLD && (historicalSupport || live?.feel === "bad") ? "later" : "nowish";
  const expectedMinutes = expectedMinutesAt(sessions, prior, point.localMinute);
  let end = index + 1;
  while (end < forecast.points.length && forecast.points[end].at <= point.at + LOOKAHEAD_MS) end += 1;
  // The earliest supported, sufficiently usable moment is useful even when a
  // much later peak would score higher. A fading live report alone cannot
  // establish that congestion will have cleared by a particular time.
  let best = index;
  if (kind !== "now") {
    for (let cursor = index + 1; cursor < end; cursor += 1) {
      const candidate = forecast.points[cursor];
      if (hasComparableEvidence(candidate.congestion) && candidate.score >= USABLE_THRESHOLD
        && candidate.score - point.score + Number.EPSILON >= MATERIAL_IMPROVEMENT) {
        best = cursor;
        break;
      }
    }
  }
  const anchor = kind === "now" ? index : best;
  const windowThreshold = best > index ? Math.max(USABLE_THRESHOLD, point.score + MATERIAL_IMPROVEMENT) : USABLE_THRESHOLD;
  let window: Verdict["window"] = null;
  if (hasComparableEvidence(forecast.points[anchor].congestion) && forecast.points[anchor].score + Number.EPSILON >= windowThreshold) {
    let to = anchor;
    while (to + 1 < end && hasComparableEvidence(forecast.points[to + 1].congestion)
      && forecast.points[to + 1].score + Number.EPSILON >= windowThreshold) to += 1;
    window = { from: forecast.points[anchor].at, to: forecast.points[to].at };
  }
  const reasons: Reason[] = [];
  if (point.live && point.live.strength >= 0.2) reasons.push({
    code: "recent-report", feel: point.live.feel, at: point.live.at,
    conflicted: point.live.conflicted, reportCount: point.live.reportCount,
  });
  if (input.congestion.ratedCount === 0) reasons.push({ code: "no-reports" });
  else reasons.push({ code: "reported-congestion", ratedCount: input.congestion.ratedCount, supportingDays: point.congestion.supportingDays });
  reasons.push({ code: "takes", minutes: expectedMinutes, doneBy: kind === "now" ? point.at + expectedMinutes * MS_PER_MINUTE : null });

  return { kind, at: point.at, bestAt: forecast.points[best].at, window, expectedMinutes, reasons, point };
}
