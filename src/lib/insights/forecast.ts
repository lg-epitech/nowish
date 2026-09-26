import { circularMinuteDistance, MS_PER_DAY, MS_PER_HOUR, MS_PER_MINUTE, zonedParts } from "@/lib/time";
import type { Feel } from "@/lib/types";

import { gaussian, normalCdf, weightedQuantile } from "./math";
import { isWeekend, type PreparedObservation, type PreparedSession, type RoutinePrior } from "./prepare";
import type { Gap } from "./rhythm";
import { curveAt, nearestPeak, type Timing } from "./timing";

/** Gaps that ended near the same time of day describe "now" best. */
const GAP_CONDITION_SIGMA = 90;
const GAP_CONDITION_FLOOR = 0.2;
/** The routine's stated cadence counts as this many pseudo-gaps. */
const PRIOR_GAP_WEIGHT = 1.5;
const RECENT_GAPS = 365;

/** Readiness below this means "you just did it". */
const TOO_SOON = 0.35;
const NOW_RATIO = 0.85;
const NOWISH_MINUTES = 90;
const BEST_RATIO = 0.92;
const WINDOW_RATIO = 0.8;
const WINDOW_MIN_HABIT = 0.35;
/** Readiness at or above this means "you're due". */
const DUE = 0.9;
/** "Is there a better moment soon?" looks this share of a usual gap ahead. */
const NEAR_GAP_SHARE = 0.5;
const NEAR_MIN_MINUTES = 180;
/** Once due, every `share × gap` of waiting costs about 63% of a moment's value. */
const WAIT_COST_GAP_SHARE = 0.35;

/**
 * A check you just made describes the next few minutes far better than any
 * pattern: it pulls how good the moment looks toward what you saw, then fades.
 */
const LIVE_TARGET: Record<Feel, number> = { good: 1, okay: 0.65, bad: 0 };
const LIVE_MAX_STRENGTH = 0.9;
const LIVE_MIN_STRENGTH = 0.05;
/** "Now" only ticks every minute, so a check tapped since still counts as current. */
const LIVE_CLOCK_SLACK_MS = 2 * MS_PER_MINUTE;
/** A fresh bad check holds off "now", even when overdue, until it fades below this. */
const BLOCKED_STRENGTH = 0.3;
/** A moment you just saw is good beats a slightly better one that is only a guess. */
const CHECKED_NOW_RATIO = 0.7;
/** Checks near a moment's time of day, over this many days, are quoted as a reason. */
const CHECKS_NEAR_MINUTES = 30;
const CHECKS_RECENT_DAYS = 21;

export interface ForecastPoint {
  at: number;
  localMinute: number;
  localWeekday: number;
  elapsedHours: number | null;
  /** 0–1: how far you are through a typical gap for this time of day. */
  readiness: number;
  /** 0–1: how good this time of day looks: when you usually do it, adjusted by checks. */
  habit: number;
  /** The latest check, while it still colours this moment. */
  live: LiveCheck | null;
  score: number;
  overdue: boolean;
  typicalGapHours: number;
  p90GapHours: number;
}

export interface LiveCheck {
  at: number;
  feel: Feel;
  /** 0–1: how much the check still weighs at this moment. */
  strength: number;
}

export interface Forecast {
  from: number;
  /** Median gap across all times of day, or the stated cadence. */
  typicalGapHours: number;
  stepMinutes: number;
  /** Points in one look-ahead window; `points` holds two windows. */
  horizonSteps: number;
  points: ForecastPoint[];
}

export type Reason =
  | { code: "first-time" }
  | { code: "too-soon"; elapsedHours: number; typicalGapHours: number }
  | { code: "due"; elapsedHours: number; typicalGapHours: number }
  | { code: "almost-due"; elapsedHours: number; typicalGapHours: number }
  | { code: "overdue"; elapsedHours: number; p90GapHours: number }
  | { code: "usual-time"; peakMinute: number }
  | { code: "off-hours"; peakMinute: number }
  | { code: "usual-day"; weekday: number }
  | { code: "unusual-day"; weekday: number }
  | { code: "just-checked"; feel: Feel; at: number }
  | { code: "checks-near"; feel: Feel; count: number; total: number }
  | { code: "takes"; minutes: number; doneBy: number | null };

export type VerdictKind = "now" | "nowish" | "later";

export interface Verdict {
  kind: VerdictKind;
  at: number;
  /** Best moment within the look-ahead window. */
  bestAt: number;
  /** Continuous stretch of good-enough moments around the best one. */
  window: { from: number; to: number } | null;
  expectedMinutes: number;
  reasons: Reason[];
  point: ForecastPoint;
}

export interface ReadinessModel {
  gaps: readonly Gap[];
  prior: RoutinePrior;
}

export interface GapModel {
  hours: number[];
  weights: number[];
  typicalGapHours: number;
  p90GapHours: number;
  /** Smoothed CDF at the typical gap, used to scale readiness to 1 there. */
  cdfAtTypical: number;
}

function smoothedCdf(hours: readonly number[], weights: readonly number[], elapsedHours: number) {
  let total = 0;
  let below = 0;

  for (let index = 0; index < hours.length; index += 1) {
    const bandwidth = Math.max(0.25, hours[index] * 0.1);
    below += weights[index] * normalCdf((elapsedHours - hours[index]) / bandwidth);
    total += weights[index];
  }

  return total > 0 ? below / total : 1;
}

/** Past gaps weighted by how close they ended to `localMinute`, plus the stated cadence. */
export function gapModelAt(model: ReadinessModel, localMinute: number): GapModel {
  const recent = model.gaps.slice(-RECENT_GAPS);
  const hours = recent.map((gap) => gap.hours);
  const weights = recent.map(
    (gap) =>
      gap.weight *
      (GAP_CONDITION_FLOOR +
        (1 - GAP_CONDITION_FLOOR) *
          gaussian(circularMinuteDistance(gap.endMinute, localMinute), GAP_CONDITION_SIGMA)),
  );

  hours.push(model.prior.cadenceHours);
  weights.push(PRIOR_GAP_WEIGHT);

  const typicalGapHours = weightedQuantile(hours, weights, 0.5) ?? model.prior.cadenceHours;

  return {
    hours,
    weights,
    typicalGapHours,
    cdfAtTypical: smoothedCdf(hours, weights, typicalGapHours),
    p90GapHours:
      model.gaps.length >= 3
        ? (weightedQuantile(hours, weights, 0.9) ?? model.prior.cadenceHours * 1.5)
        : model.prior.cadenceHours * 1.5,
  };
}

/**
 * Readiness is a smoothed, time-of-day conditioned ECDF of past gaps, scaled
 * so that reaching your typical gap for this time of day counts as fully
 * ready: `min(1, F(elapsed) / F(typical))`.
 */
export function readinessFrom(gapModel: GapModel, elapsedHours: number) {
  const cdf = smoothedCdf(gapModel.hours, gapModel.weights, elapsedHours);

  return {
    readiness: Math.min(1, cdf / Math.max(gapModel.cdfAtTypical, 0.05)),
    typicalGapHours: gapModel.typicalGapHours,
    p90GapHours: gapModel.p90GapHours,
    overdue: elapsedHours > gapModel.p90GapHours,
  };
}

export function readinessAt(model: ReadinessModel, elapsedHours: number, localMinute: number) {
  return readinessFrom(gapModelAt(model, localMinute), elapsedHours);
}

export function habitAt(timing: Timing, localMinute: number, localWeekday: number, typicalGapHours: number, effectiveCount: number) {
  const curve = isWeekend(localWeekday) ? timing.habit.weekend : timing.habit.weekday;
  const timeOfDay = curveAt(curve, localMinute);
  const dayStrength = Math.min(1, effectiveCount / 10) * (typicalGapHours >= 48 ? 1 : 0.35);
  const day = 1 - dayStrength * (1 - timing.weekdayFactor[localWeekday - 1]);
  return timeOfDay * day;
}

export function horizonFor(typicalGapHours: number) {
  return typicalGapHours <= 36
    ? { stepMinutes: 5, horizonSteps: 288 }
    : { stepMinutes: 30, horizonSteps: 336 };
}

function cachedGapModel(cache: Map<number, GapModel>, model: ReadinessModel, localMinute: number) {
  let gapModel = cache.get(localMinute);
  if (!gapModel) {
    gapModel = gapModelAt(model, localMinute);
    cache.set(localMinute, gapModel);
  }
  return gapModel;
}

/** The latest check up to `now`, unless you have done it since. */
export function latestCheck(
  observations: readonly PreparedObservation[],
  sessions: readonly PreparedSession[],
  now: number,
) {
  let latest: PreparedObservation | null = null;
  for (const observation of observations) {
    if (observation.at <= now + LIVE_CLOCK_SLACK_MS) latest = observation;
  }

  const lastStart = sessions.at(-1)?.start ?? -Infinity;
  return latest && latest.at > lastStart ? latest : null;
}

export function liveCheckAt(
  check: PreparedObservation | null,
  at: number,
  halfLifeMinutes: number,
): LiveCheck | null {
  if (!check) return null;

  const minutes = Math.max(0, (at - check.at) / MS_PER_MINUTE);
  const strength = LIVE_MAX_STRENGTH * Math.pow(0.5, minutes / halfLifeMinutes);
  return strength >= LIVE_MIN_STRENGTH ? { at: check.at, feel: check.feel, strength } : null;
}

export function buildForecast(input: {
  sessions: readonly PreparedSession[];
  observations?: readonly PreparedObservation[];
  gaps: readonly Gap[];
  timing: Timing;
  prior: RoutinePrior;
  now: number;
  timeZone: string;
  typicalGapHours: number;
  /** How fast a fresh check fades; about as long as whatever keeps you out. */
  liveHalfLifeMinutes?: number;
}): Forecast {
  const { stepMinutes, horizonSteps } = horizonFor(input.typicalGapHours);
  const last = input.sessions.at(-1) ?? null;
  const check = latestCheck(input.observations ?? [], input.sessions, input.now);
  const halfLife = input.liveHalfLifeMinutes ?? 20;
  const model: ReadinessModel = { gaps: input.gaps, prior: input.prior };
  const effectiveCount = input.sessions.reduce((total, session) => total + session.weight, 0);
  const gapModels = new Map<number, GapModel>();
  const points: ForecastPoint[] = [];

  // The first point is exactly now; the rest sit on round clock times.
  const stepMs = stepMinutes * MS_PER_MINUTE;
  const firstRound = Math.floor(input.now / stepMs) * stepMs + stepMs;

  for (let step = 0; step < horizonSteps * 2; step += 1) {
    const at = step === 0 ? input.now : firstRound + (step - 1) * stepMs;
    const local = zonedParts(at, input.timeZone);
    const elapsedHours = last ? (at - last.start) / MS_PER_HOUR : null;
    const ready =
      elapsedHours === null
        ? { readiness: 1, typicalGapHours: input.prior.cadenceHours, p90GapHours: input.prior.cadenceHours * 1.5, overdue: false }
        : readinessFrom(cachedGapModel(gapModels, model, local.localMinute), elapsedHours);
    const usual = last
      ? habitAt(input.timing, local.localMinute, local.localWeekday, ready.typicalGapHours, effectiveCount)
      : 0.5;
    const live = liveCheckAt(check, at, halfLife);
    const habit = live ? usual + (LIVE_TARGET[live.feel] - usual) * live.strength : usual;

    points.push({
      at,
      localMinute: local.localMinute,
      localWeekday: local.localWeekday,
      elapsedHours,
      readiness: ready.readiness,
      habit,
      live,
      score: ready.readiness * (0.25 + 0.75 * habit),
      overdue: ready.overdue,
      typicalGapHours: ready.typicalGapHours,
      p90GapHours: ready.p90GapHours,
    });
  }

  return { from: input.now, typicalGapHours: input.typicalGapHours, stepMinutes, horizonSteps, points };
}

/** The forecast point closest to `ms`, within the first look-ahead window. */
export function indexAt(forecast: Forecast, ms: number) {
  const { points, horizonSteps, stepMinutes } = forecast;
  if (ms <= points[0].at || points.length < 2) return 0;
  if (ms <= points[1].at) return ms - points[0].at < points[1].at - ms ? 0 : 1;
  const index = 1 + Math.round((ms - points[1].at) / (stepMinutes * MS_PER_MINUTE));
  return Math.min(horizonSteps, index);
}

/** Median minutes spent near this time of day, blended with the stated typical time. */
export function expectedMinutesAt(
  sessions: readonly PreparedSession[],
  prior: RoutinePrior,
  localMinute: number,
) {
  const values = sessions.map((session) => session.minutes);
  const weights = sessions.map(
    (session) =>
      session.weight *
      (0.35 + 0.65 * gaussian(circularMinuteDistance(session.localMinute, localMinute), 120)),
  );

  values.push(prior.typicalMinutes);
  weights.push(sessions.length >= 5 ? 0.25 : 1);

  return weightedQuantile(values, weights, 0.5) ?? prior.typicalMinutes;
}

function inWindow(point: ForecastPoint, threshold: number) {
  return point.score >= threshold && point.habit >= WINDOW_MIN_HABIT;
}

/** The stretch around `anchor`, within `[lower, upper)`, that is good enough and habitual. */
function windowAround(
  points: readonly ForecastPoint[],
  anchor: number,
  lower: number,
  upper: number,
  threshold: number,
) {
  if (!inWindow(points[anchor], threshold)) return null;

  let from = anchor;
  let to = anchor;
  while (from - 1 >= lower && inWindow(points[from - 1], threshold)) from -= 1;
  while (to + 1 < upper && inWindow(points[to + 1], threshold)) to += 1;
  return { from: points[from].at, to: points[to].at };
}

/** Earliest point within `[from, to)` that is nearly as good as the best one. */
function bestIn(
  points: readonly ForecastPoint[],
  from: number,
  to: number,
  value: (point: ForecastPoint) => number,
) {
  let max = 0;
  for (let cursor = from; cursor < to; cursor += 1) max = Math.max(max, value(points[cursor]));

  for (let cursor = from; cursor < to; cursor += 1) {
    if (value(points[cursor]) >= max * BEST_RATIO) return { index: cursor, max };
  }

  return { index: from, max };
}

function isBlocked(point: ForecastPoint) {
  return point.live?.feel === "bad" && point.live.strength >= BLOCKED_STRENGTH;
}

function justChecked(point: ForecastPoint): Extract<Reason, { code: "just-checked" }> | null {
  return point.live && point.live.strength >= BLOCKED_STRENGTH
    ? { code: "just-checked", feel: point.live.feel, at: point.live.at }
    : null;
}

/** What most recent checks near this time of day found, when they mostly agree. */
function checksNear(
  observations: readonly PreparedObservation[],
  point: ForecastPoint,
): Extract<Reason, { code: "checks-near" }> | null {
  const counts: Record<Feel, number> = { good: 0, okay: 0, bad: 0 };
  let total = 0;

  for (const check of observations) {
    if (check.at > point.at || check.at < point.at - CHECKS_RECENT_DAYS * MS_PER_DAY) continue;
    if (circularMinuteDistance(check.localMinute, point.localMinute) > CHECKS_NEAR_MINUTES) continue;
    counts[check.feel] += 1;
    total += 1;
  }

  if (total < 2) return null;
  const feel = (["bad", "good", "okay"] as const).find((candidate) => counts[candidate] * 2 >= total);
  return feel ? { code: "checks-near", feel, count: counts[feel], total } : null;
}

export function verdictAt(input: {
  forecast: Forecast;
  index: number;
  sessions: readonly PreparedSession[];
  observations?: readonly PreparedObservation[];
  timing: Timing;
  prior: RoutinePrior;
}): Verdict {
  const { forecast, sessions, timing, prior } = input;
  const observations = input.observations ?? [];
  const index = Math.max(0, Math.min(input.index, forecast.points.length - 1));
  const point = forecast.points[index];
  const expectedMinutes = expectedMinutesAt(sessions, prior, point.localMinute);
  const doneBy = point.at + expectedMinutes * MS_PER_MINUTE;
  const checked = justChecked(point);

  if (sessions.length === 0 || point.elapsedHours === null) {
    // Nothing to learn a rhythm from yet, but a fresh bad check still means "not this minute".
    let clear = index;
    while (clear < forecast.points.length - 1 && isBlocked(forecast.points[clear])) clear += 1;
    const bestAt = forecast.points[clear].at;
    const waitMinutes = (bestAt - point.at) / MS_PER_MINUTE;
    const kind: VerdictKind = clear === index ? "now" : waitMinutes <= NOWISH_MINUTES ? "nowish" : "later";

    return {
      kind,
      at: point.at,
      bestAt,
      window: null,
      expectedMinutes,
      reasons: [
        ...(clear === index ? [{ code: "first-time" } as const] : []),
        ...(checked ? [checked] : []),
        { code: "takes", minutes: expectedMinutes, doneBy: kind === "now" ? doneBy : null },
      ],
      point,
    };
  }

  // Too soon: search the whole horizon for the next window. Otherwise look
  // about half a usual gap ahead; waiting longer would mean skipping one.
  // Once due, waiting has a cost, so later moments must be clearly better.
  const tooSoon = point.readiness < TOO_SOON && !point.overdue;
  const due = point.readiness >= DUE;
  const habitual = point.habit >= WINDOW_MIN_HABIT;
  const gapHours = forecast.typicalGapHours;
  const nearSteps = Math.round((gapHours * 60 * NEAR_GAP_SHARE) / forecast.stepMinutes);
  const minSteps = Math.round(NEAR_MIN_MINUTES / forecast.stepMinutes);
  const lookahead = tooSoon
    ? forecast.horizonSteps
    : Math.min(forecast.horizonSteps, Math.max(minSteps, nearSteps));
  // A fresh bad check rules out every moment until it fades.
  const blocked = isBlocked(point);
  let from = index;
  while (blocked && from < forecast.points.length - 1 && isBlocked(forecast.points[from])) from += 1;
  const end = Math.min(forecast.points.length, Math.max(index + lookahead, from + 1));
  const waitCostHours = gapHours * WAIT_COST_GAP_SHARE;
  const value = due
    ? (candidate: ForecastPoint) =>
        candidate.score * Math.exp(-(candidate.at - point.at) / MS_PER_HOUR / waitCostHours)
    : (candidate: ForecastPoint) => candidate.score;
  const search = bestIn(forecast.points, from, end, value);
  // Overdue means "as soon as you can", which a fresh bad check only delays.
  const best = point.overdue ? from : search.index;
  const bestPoint = forecast.points[best];
  const ratio = search.max > 0 ? point.score / search.max : 1;
  const minutesToBest = (bestPoint.at - point.at) / MS_PER_MINUTE;
  const nowRatio = point.live?.feel === "good" && !tooSoon && checked ? CHECKED_NOW_RATIO : NOW_RATIO;

  let kind: VerdictKind;
  if (point.overdue && !blocked) kind = "now";
  else if (tooSoon) kind = "later";
  else if (!blocked && ratio >= nowRatio && (due || habitual)) kind = "now";
  else if (minutesToBest <= NOWISH_MINUTES) kind = "nowish";
  else kind = "later";

  const reasons: Reason[] = checked ? [checked] : [];
  const elapsedHours = point.elapsedHours;

  if (point.overdue) {
    reasons.push({ code: "overdue", elapsedHours, p90GapHours: point.p90GapHours });
  } else if (point.readiness < TOO_SOON) {
    reasons.push({ code: "too-soon", elapsedHours, typicalGapHours: point.typicalGapHours });
  } else if (!due) {
    reasons.push({ code: "almost-due", elapsedHours, typicalGapHours: point.typicalGapHours });
  } else {
    reasons.push({ code: "due", elapsedHours, typicalGapHours: point.typicalGapHours });
  }

  if (sessions.length >= 3) {
    const near = nearestPeak(timing.peaks, point.localMinute);
    const timeOfDay = curveAt(timing.curve, point.localMinute);

    if (near && (timeOfDay >= 0.55 || near.distance <= 30)) {
      reasons.push({ code: "usual-time", peakMinute: near.peak.minute });
    } else if (near && timeOfDay < 0.25) {
      reasons.push({ code: "off-hours", peakMinute: near.peak.minute });
    }
  }

  // Quoted only when it backs the verdict, so the list reads as its reasons.
  const nearby = checksNear(observations, point);
  if (nearby && (nearby.feel === "bad" ? kind !== "now" : nearby.feel === "good" && kind === "now")) {
    reasons.push(nearby);
  }

  if (point.typicalGapHours >= 48 && sessions.length >= 6) {
    const factor = timing.weekdayFactor[point.localWeekday - 1];
    if (factor >= 0.75) reasons.push({ code: "usual-day", weekday: point.localWeekday });
    else if (factor <= 0.35) reasons.push({ code: "unusual-day", weekday: point.localWeekday });
  }

  reasons.push({ code: "takes", minutes: expectedMinutes, doneBy: kind === "later" || blocked ? null : doneBy });

  const anchor = kind === "now" ? index : best;
  const threshold = Math.max(forecast.points[anchor].score, bestPoint.score) * WINDOW_RATIO;
  const window = windowAround(forecast.points, anchor, from, end, threshold);

  return {
    kind,
    at: point.at,
    bestAt: kind === "now" ? point.at : bestPoint.at,
    window,
    expectedMinutes,
    reasons,
    point,
  };
}
