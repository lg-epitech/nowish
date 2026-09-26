import type { Observation, Session } from "@/lib/types";

import { buildForecast, verdictAt, type Forecast, type Verdict } from "./forecast";
import { clamp } from "./math";
import {
  prepareObservations,
  prepareSessions,
  type PreparedObservation,
  type PreparedSession,
  type RoutinePrior,
} from "./prepare";
import { computeGaps, computeRhythm, type Rhythm } from "./rhythm";
import { computeTimeSpent, type TimeSpent } from "./time-spent";
import { computeTiming, type Timing } from "./timing";

export type Confidence = "none" | "learning" | "building" | "solid";

export interface Insights {
  now: number;
  timeZone: string;
  sessionCount: number;
  checkCount: number;
  confidence: Confidence;
  prior: RoutinePrior;
  timeSpent: TimeSpent;
  rhythm: Rhythm;
  timing: Timing;
  forecast: Forecast;
  sessions: PreparedSession[];
  observations: PreparedObservation[];
}

export function confidenceFor(sessionCount: number): Confidence {
  if (sessionCount === 0) return "none";
  if (sessionCount < 5) return "learning";
  if (sessionCount < 15) return "building";
  return "solid";
}

/**
 * Checks only ever teach timing. Gaps, readiness, time spent and streaks come
 * from sessions alone, so a check can never pass for having done it.
 */
export function buildInsights(input: {
  sessions: readonly Session[];
  observations?: readonly Observation[];
  prior: RoutinePrior;
  now: number;
  timeZone: string;
}): Insights {
  const sessions = prepareSessions(input.sessions, input.now);
  const observations = prepareObservations(input.observations ?? [], input.now);
  const gaps = computeGaps(sessions);
  const timeSpent = computeTimeSpent(sessions, input.now);
  const rhythm = computeRhythm(sessions, gaps, input.now, input.timeZone);
  const timing = computeTiming(sessions, observations);
  const forecast = buildForecast({
    sessions,
    observations,
    gaps,
    timing,
    prior: input.prior,
    now: input.now,
    timeZone: input.timeZone,
    typicalGapHours: rhythm.medianGapHours ?? input.prior.cadenceHours,
    // Whatever keeps you out (someone else's shower, a laundry cycle) tends
    // to last about as long as the thing itself.
    liveHalfLifeMinutes: clamp((timeSpent.typicalMinutes ?? input.prior.typicalMinutes) * 1.5, 15, 60),
  });

  return {
    now: input.now,
    timeZone: input.timeZone,
    sessionCount: sessions.length,
    checkCount: observations.length,
    confidence: confidenceFor(sessions.length),
    prior: input.prior,
    timeSpent,
    rhythm,
    timing,
    forecast,
    sessions,
    observations,
  };
}

/** The verdict for the forecast point at `index` (0 = now). */
export function verdictFor(insights: Insights, index = 0): Verdict {
  return verdictAt({
    forecast: insights.forecast,
    index,
    sessions: insights.sessions,
    observations: insights.observations,
    timing: insights.timing,
    prior: insights.prior,
  });
}

export { indexAt } from "./forecast";
export type { Forecast, ForecastPoint, LiveCheck, Reason, Verdict, VerdictKind } from "./forecast";
export type { Peak, Timing } from "./timing";
export type { Rhythm } from "./rhythm";
export type { TimeSpent } from "./time-spent";
