import { circularMinuteDistance, MINUTES_PER_DAY } from "@/lib/time";
import type { Feel } from "@/lib/types";

import { gaussian, sum, weightedQuantile } from "./math";
import type { PreparedObservation, PreparedSession } from "./prepare";

export const GRID_MINUTES = 5;
export const GRID_SIZE = MINUTES_PER_DAY / GRID_MINUTES;

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
  peaks: Peak[];
  /** Median distance, in minutes, between a session and its nearest usual time. */
  spreadMinutes: number | null;
  weekdays: { weekday: number; count: number; share: number }[];
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

export function computeTiming(
  sessions: readonly PreparedSession[],
  observations: readonly PreparedObservation[] = [],
): Timing {
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
    peaks,
    spreadMinutes,
    weekdays: weekdayCounts.map((count, index) => ({
      weekday: index + 1,
      count,
      share: sessions.length ? count / sessions.length : 0,
    })),
    heatmap,
    feel: { ...feel, rated, best, worst },
  };
}
