import { circularMinuteDistance, MINUTES_PER_DAY } from "@/lib/time";
import type { Feel } from "@/lib/types";

import { gaussian, sum, weightedQuantile } from "./math";
import { isWeekend, type PreparedObservation, type PreparedSession } from "./prepare";

export const GRID_MINUTES = 5;
export const GRID_SIZE = MINUTES_PER_DAY / GRID_MINUTES;

/** How much a rated timing counts toward "this is a good time". */
const FEEL_WEIGHT: Record<Feel, number> = { good: 1.3, okay: 1, bad: 0.35 };

/**
 * A check counts toward "this time works" as a fraction of a session: you
 * were there and it looked fine, but you did not actually go.
 */
const CHECK_HABIT_WEIGHT: Record<Feel, number> = { good: 0.6, okay: 0.3, bad: 0 };

/** How much each check says "this time is bad"; the rest says "this time is fine". */
const CHECK_BADNESS: Record<Feel, number> = { good: 0, okay: 0.3, bad: 1 };

/**
 * A session you did not rate as bad is a small vote that its time is fine.
 * Checks are the direct evidence, so a fresh run of them outweighs old habits.
 */
const SESSION_FINE_WEIGHT = 0.25;

/** Busy times are local: a check says little about an hour later. */
const CONDITION_SIGMA = 30;

/** Pseudo-votes for "fine" so a single bad check dents a time without erasing it. */
const CONDITION_PRIOR = 0.5;

/** Sessions of the other day type (weekday vs weekend) still count, but less. */
const OTHER_DAY_TYPE_WEIGHT = 0.35;
const MIN_SAME_DAY_TYPE_WEIGHT = 4;

/** Pseudo-sessions of "any time is fine" blended into sparse habit curves. */
const HABIT_PRIOR_WEIGHT = 3;

const PEAK_FLOOR = 0.3;
const PEAK_MIN_SEPARATION = 90;
const PEAK_CAPTURE = 120;

export interface Peak {
  minute: number;
  /** Share of sessions that belong to this usual time. */
  share: number;
}

export interface Timing {
  bandwidthMinutes: number;
  /** Relative density of start times across the day, 0–1, one point per 5 minutes. */
  curve: number[];
  /**
   * How good each time looks for weekdays and weekends: habit blended with
   * the prior, with checks folded in.
   */
  habit: { weekday: number[]; weekend: number[] };
  peaks: Peak[];
  /** Median distance, in minutes, between a session and its nearest usual time. */
  spreadMinutes: number | null;
  weekdays: { weekday: number; count: number; share: number }[];
  /** Weekday factor used by long-cadence routines, index 0 = Monday. */
  weekdayFactor: number[];
  /** Session counts, 7 weekdays × 12 two-hour blocks. */
  heatmap: number[][];
  /** Ratings from sessions and checks together. */
  feel: {
    good: number;
    okay: number;
    bad: number;
    rated: number;
    best: { fromMinute: number; toMinute: number; goodShare: number; count: number } | null;
    worst: { fromMinute: number; toMinute: number; badShare: number; count: number } | null;
  };
}

export function bandwidthFor(effectiveCount: number) {
  if (effectiveCount < 8) return 50;
  if (effectiveCount < 30) return 40;
  return 30;
}

function density<T extends { localMinute: number }>(
  items: readonly T[],
  weightOf: (item: T) => number,
  sigma: number,
  values = new Array<number>(GRID_SIZE).fill(0),
) {
  for (const item of items) {
    const weight = weightOf(item);
    if (weight <= 0) continue;

    for (let index = 0; index < GRID_SIZE; index += 1) {
      const distance = circularMinuteDistance(index * GRID_MINUTES, item.localMinute);
      if (distance > sigma * 4) continue;
      values[index] += weight * gaussian(distance, sigma);
    }
  }

  return values;
}

function normalized(values: readonly number[]) {
  const max = Math.max(...values);
  return max > 0 ? values.map((value) => value / max) : values.map(() => 0);
}

function habitCurve(
  sessions: readonly PreparedSession[],
  observations: readonly PreparedObservation[],
  weekend: boolean,
  sigma: number,
) {
  const sameTypeWeight = sum(
    sessions
      .filter((session) => isWeekend(session.localWeekday) === weekend)
      .map((session) => session.weight),
  );
  const splitByDayType = sameTypeWeight >= MIN_SAME_DAY_TYPE_WEIGHT;
  const dayType = (weekday: number) =>
    splitByDayType && isWeekend(weekday) !== weekend ? OTHER_DAY_TYPE_WEIGHT : 1;
  const sessionWeight = (session: PreparedSession) =>
    session.weight * (session.feel ? FEEL_WEIGHT[session.feel] : 1) * dayType(session.localWeekday);
  const checkWeight = (check: PreparedObservation) =>
    check.weight * CHECK_HABIT_WEIGHT[check.feel] * dayType(check.localWeekday);

  const effective = sum(sessions.map(sessionWeight)) + sum(observations.map(checkWeight));
  const curve = normalized(
    density(observations, checkWeight, sigma, density(sessions, sessionWeight, sigma)),
  );
  const habit = curve.map(
    (value) => (effective * value + HABIT_PRIOR_WEIGHT * 0.5) / (effective + HABIT_PRIOR_WEIGHT),
  );

  if (observations.length === 0) return habit;

  // Bad checks pull their time of day down, unless recent sessions and good
  // checks around the same time say it is usually fine.
  const bad = density(
    observations,
    (check) => check.freshness * CHECK_BADNESS[check.feel] * dayType(check.localWeekday),
    CONDITION_SIGMA,
  );
  const fine = density(
    observations,
    (check) => check.freshness * (1 - CHECK_BADNESS[check.feel]) * dayType(check.localWeekday),
    CONDITION_SIGMA,
    density(
      sessions,
      (session) =>
        session.feel === "bad" ? 0 : session.freshness * SESSION_FINE_WEIGHT * dayType(session.localWeekday),
      CONDITION_SIGMA,
    ),
  );

  return habit.map(
    (value, index) =>
      (value * (fine[index] + CONDITION_PRIOR)) / (fine[index] + bad[index] + CONDITION_PRIOR),
  );
}

function findPeaks(curve: readonly number[], sessions: readonly PreparedSession[]): Peak[] {
  const candidates: { minute: number; value: number }[] = [];

  for (let index = 0; index < GRID_SIZE; index += 1) {
    const value = curve[index];
    const before = curve[(index - 1 + GRID_SIZE) % GRID_SIZE];
    const after = curve[(index + 1) % GRID_SIZE];
    if (value >= PEAK_FLOOR && value >= before && value > after) {
      candidates.push({ minute: index * GRID_MINUTES, value });
    }
  }

  candidates.sort((left, right) => right.value - left.value);

  const peaks: { minute: number; value: number }[] = [];

  for (const candidate of candidates) {
    const tooClose = peaks.some(
      (peak) => circularMinuteDistance(peak.minute, candidate.minute) < PEAK_MIN_SEPARATION,
    );
    if (!tooClose) peaks.push(candidate);
  }

  const total = sum(sessions.map((session) => session.weight));
  if (total === 0) return [];

  const shares = peaks.map(() => 0);

  for (const session of sessions) {
    let nearest = -1;
    let nearestDistance = Infinity;

    peaks.forEach((peak, index) => {
      const distance = circularMinuteDistance(peak.minute, session.localMinute);
      if (distance < nearestDistance) {
        nearest = index;
        nearestDistance = distance;
      }
    });

    if (nearest >= 0 && nearestDistance <= PEAK_CAPTURE) shares[nearest] += session.weight;
  }

  return peaks
    .map((peak, index) => ({ minute: peak.minute, share: shares[index] / total }))
    .filter((peak) => peak.share > 0)
    .sort((left, right) => right.share - left.share)
    .slice(0, 3);
}

function weekdayFactor(sessions: readonly PreparedSession[]) {
  const counts = new Array<number>(7).fill(0);
  for (const session of sessions) counts[session.localWeekday - 1] += session.weight;

  const total = sum(counts);
  if (total === 0) return counts.map(() => 1);

  const smoothing = 0.25 * (total / 7) + 0.1;
  const max = Math.max(...counts) + smoothing;
  return counts.map((count) => (count + smoothing) / max);
}

export function computeTiming(
  sessions: readonly PreparedSession[],
  observations: readonly PreparedObservation[] = [],
): Timing {
  const effective = sum(sessions.map((session) => session.weight));
  const sigma = bandwidthFor(sessions.length);
  const curve = normalized(density(sessions, (session) => session.weight, sigma));
  const peaks = sessions.length > 0 ? findPeaks(curve, sessions) : [];

  const distances = sessions.map((session) =>
    Math.min(...peaks.map((peak) => circularMinuteDistance(peak.minute, session.localMinute))),
  );
  const spreadMinutes =
    peaks.length > 0 && sessions.length >= 3
      ? weightedQuantile(distances, sessions.map((session) => session.weight), 0.5)
      : null;

  const weekdayCounts = new Array<number>(7).fill(0);
  const heatmap = Array.from({ length: 7 }, () => new Array<number>(12).fill(0));
  const feel = { good: 0, okay: 0, bad: 0 };
  const blocks = Array.from({ length: 12 }, () => ({ good: 0, bad: 0, rated: 0 }));

  function rate(localMinute: number, rating: Feel) {
    const block = blocks[Math.floor(localMinute / 120)];
    feel[rating] += 1;
    block.rated += 1;
    if (rating === "good") block.good += 1;
    if (rating === "bad") block.bad += 1;
  }

  for (const session of sessions) {
    const block = Math.floor(session.localMinute / 120);
    weekdayCounts[session.localWeekday - 1] += 1;
    heatmap[session.localWeekday - 1][block] += 1;
    if (session.feel) rate(session.localMinute, session.feel);
  }

  for (const check of observations) rate(check.localMinute, check.feel);

  const rated = feel.good + feel.okay + feel.bad;
  let best: Timing["feel"]["best"] = null;
  let worst: Timing["feel"]["worst"] = null;

  if (rated >= 5) {
    for (const [index, block] of blocks.entries()) {
      if (block.rated < 3) continue;
      const range = { fromMinute: index * 120, toMinute: (index + 1) * 120, count: block.rated };
      const goodShare = block.good / block.rated;
      const badShare = block.bad / block.rated;

      if (!best || goodShare > best.goodShare || (goodShare === best.goodShare && block.rated > best.count)) {
        best = { ...range, goodShare };
      }
      if (badShare >= 0.5 && (!worst || badShare > worst.badShare || (badShare === worst.badShare && block.rated > worst.count))) {
        worst = { ...range, badShare };
      }
    }
  }

  // One block cannot be both; keep whichever it mostly is.
  if (best && worst && best.fromMinute === worst.fromMinute) {
    if (best.goodShare > worst.badShare) worst = null;
    else best = null;
  }

  return {
    bandwidthMinutes: sigma,
    curve,
    habit: {
      weekday: habitCurve(sessions, observations, false, sigma),
      weekend: habitCurve(sessions, observations, true, sigma),
    },
    peaks,
    spreadMinutes,
    weekdays: weekdayCounts.map((count, index) => ({
      weekday: index + 1,
      count,
      share: sessions.length ? count / sessions.length : 0,
    })),
    weekdayFactor: effective > 0 ? weekdayFactor(sessions) : new Array<number>(7).fill(1),
    heatmap,
    feel: { ...feel, rated, best, worst },
  };
}

export function curveAt(curve: readonly number[], localMinute: number) {
  const position = localMinute / GRID_MINUTES;
  const lower = Math.floor(position) % GRID_SIZE;
  const upper = (lower + 1) % GRID_SIZE;
  const ratio = position - Math.floor(position);
  return curve[lower] * (1 - ratio) + curve[upper] * ratio;
}

export function nearestPeak(peaks: readonly Peak[], localMinute: number) {
  let nearest: Peak | null = null;
  let nearestDistance = Infinity;

  for (const peak of peaks) {
    const distance = circularMinuteDistance(peak.minute, localMinute);
    if (distance < nearestDistance) {
      nearest = peak;
      nearestDistance = distance;
    }
  }

  return nearest ? { peak: nearest, distance: nearestDistance } : null;
}
