import type { Observation, Session } from "@/lib/types";

import { buildCongestionModel, type CongestionModel } from "./congestion";
import { buildForecast, verdictAt, type Forecast, type Verdict } from "./forecast";
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

export interface Insights {
  now: number;
  timeZone: string;
  sessionCount: number;
  checkCount: number;
  congestion: CongestionModel;
  prior: RoutinePrior;
  timeSpent: TimeSpent;
  rhythm: Rhythm;
  timing: Timing;
  forecast: Forecast;
  sessions: PreparedSession[];
  observations: PreparedObservation[];
}

/**
 * Rated sessions and checks teach congestion together. Duration, gaps and
 * streaks still come from sessions alone; cadence never changes usability.
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
  const congestion = buildCongestionModel({ sessions, observations, now: input.now });
  const forecast = buildForecast({ congestion, now: input.now, timeZone: input.timeZone });

  return {
    now: input.now,
    timeZone: input.timeZone,
    sessionCount: sessions.length,
    checkCount: observations.length,
    congestion,
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
    congestion: insights.congestion,
    prior: insights.prior,
  });
}

export { indexAt } from "./forecast";
export type { CongestionConfidence, CongestionEstimate, CongestionModel, LiveReport } from "./congestion";
export type { Forecast, ForecastPoint, Reason, Verdict, VerdictKind } from "./forecast";
export type { Peak, Timing } from "./timing";
export type { Rhythm } from "./rhythm";
export type { TimeSpent } from "./time-spent";
