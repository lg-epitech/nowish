import { circularMinuteDistance, MS_PER_MINUTE } from "@/lib/time";
import type { Feel } from "@/lib/types";

import { correlationWeights } from "./correlation";
import { decayWeight, gaussian } from "./math";
import { isWeekend, type PreparedObservation, type PreparedSession } from "./prepare";

/** Usability proxies, not measured probabilities of successful access. */
const USABILITY: Record<Feel, number> = { good: 1, okay: 0.5, bad: 0 };
const HALF_LIFE_DAYS = 45;
const TIME_BANDWIDTH_MINUTES = 45;
const CORRELATION_MINUTES = 15;
const LIVE_HALF_LIFE_MINUTES = 20;
const BORROWED_PRIOR_WEIGHT = 2;

export type CongestionConfidence = "none" | "low" | "moderate" | "high";

export interface LiveReport {
  at: number;
  feel: Feel;
  value: number;
  strength: number;
  conflicted: boolean;
  reportCount: number;
}

export interface CongestionEstimate {
  /** Estimated chance usable, 0–1. Higher means less congestion. */
  probability: number;
  /** Coverage of comparable historical reports, not prediction accuracy. */
  confidence: CongestionConfidence;
  effectiveReports: number;
  supportingDays: number;
  live: LiveReport | null;
}

interface Report {
  at: number;
  minute: number;
  weekday: number;
  date: string;
  value: number;
  count: number;
  good: number;
  bad: number;
  /** Correlation-adjusted mass; simultaneous duplicate taps share one vote. */
  weight: number;
}

interface ReportDay {
  date: string;
  weekday: number;
  at: number;
  reports: Report[];
  weight: number;
  value: number;
}

type RecentReports = Omit<LiveReport, "strength">;

export interface CongestionModel {
  ratedCount: number;
  unratedCount: number;
  counts: Record<Feel, number>;
  dayCount: number;
  days: ReportDay[];
  recent: RecentReports | null;
}

/** Every explicit rating contributes; unrated sessions do not imply clear access. */
export function buildCongestionModel(input: {
  sessions: readonly PreparedSession[];
  observations: readonly PreparedObservation[];
  now: number;
}): CongestionModel {
  const moments = new Map<string, Report>();
  const counts: Record<Feel, number> = { good: 0, okay: 0, bad: 0 };
  let unratedCount = 0;
  let ratedCount = 0;

  function add(at: number, localMinute: number, weekday: number, date: string, feel: Feel) {
    // Stored localMinute is integral; retain seconds so a millisecond change
    // does not turn into a full minute at a clock boundary.
    const minute = localMinute + ((at % MS_PER_MINUTE) + MS_PER_MINUTE) % MS_PER_MINUTE / MS_PER_MINUTE;
    const key = `${at}/${date}/${minute}/${weekday}`;
    const report = moments.get(key) ?? { at, minute, weekday, date, value: 0, count: 0, good: 0, bad: 0, weight: 0 };
    report.count += 1;
    report.value += USABILITY[feel];
    if (feel === "good") report.good += 1;
    if (feel === "bad") report.bad += 1;
    moments.set(key, report);
    counts[feel] += 1;
    ratedCount += 1;
  }

  for (const session of input.sessions) {
    if (session.start > input.now) continue;
    if (session.feel === null) unratedCount += 1;
    else add(session.start, session.localMinute, session.localWeekday, session.localDate, session.feel);
  }
  for (const check of input.observations) {
    if (check.at <= input.now) add(check.at, check.localMinute, check.localWeekday, check.localDate, check.feel);
  }
  const reports = [...moments.values()].sort((a, b) => a.at - b.at || a.date.localeCompare(b.date) || a.minute - b.minute);
  for (const report of reports) report.value /= report.count;
  // Continuous, compact correlation weights: close reports share influence,
  // while even a large burst cannot suppress a later independent report.
  const weights = correlationWeights(reports, CORRELATION_MINUTES * MS_PER_MINUTE);
  for (let index = 0; index < reports.length; index += 1) reports[index].weight = weights[index];

  const grouped = new Map<string, ReportDay>();
  for (const report of reports) {
    const day = grouped.get(report.date) ?? {
      date: report.date, weekday: report.weekday, at: report.at, reports: [], weight: 0, value: 0,
    };
    day.at = Math.max(day.at, report.at);
    day.reports.push(report);
    day.weight += report.weight;
    day.value += report.weight * report.value;
    grouped.set(report.date, day);
  }
  const days = [...grouped.values()];
  for (const day of days) {
    day.value /= day.weight;
    day.weight = Math.min(1, day.weight);
  }

  const latestAt = reports.at(-1)?.at;
  let recent: RecentReports | null = null;
  if (latestAt !== undefined) {
    let weight = 0;
    let usable = 0;
    let good = 0;
    let bad = 0;
    let reportCount = 0;
    for (const report of reports) {
      const minutes = (latestAt - report.at) / MS_PER_MINUTE;
      const mass = report.weight * Math.pow(0.5, minutes / LIVE_HALF_LIFE_MINUTES);
      weight += mass;
      usable += mass * report.value;
      good += mass * report.good / report.count;
      bad += mass * report.bad / report.count;
      if (minutes <= 120) reportCount += report.count;
    }
    const value = usable / weight;
    recent = {
      at: latestAt, value, reportCount,
      feel: value >= 0.75 ? "good" : value <= 0.25 ? "bad" : "okay",
      conflicted: Math.min(good, bad) / weight >= 0.1,
    };
  }

  return { ratedCount, unratedCount, counts, dayCount: days.length, days, recent };
}

function posterior(parent: number, weight: number, usable: number) {
  return (1 + BORROWED_PRIOR_WEIGHT * parent + usable) / (2 + BORROWED_PRIOR_WEIGHT + weight);
}

/**
 * Borrow history through bounded priors: all hours/days → related weekdays
 * near this hour → this exact weekday/hour. Other day types never count as
 * comparable support, and other weekdays cannot drown out exact-day reports.
 * These weighted-label estimates are shrinkage heuristics, not calibrated
 * Beta posteriors or confidence intervals.
 */
export function congestionAt(
  model: CongestionModel,
  at: number,
  localMinute: number,
  localWeekday: number,
): CongestionEstimate {
  let globalWeight = 0;
  let globalUsable = 0;
  let exactWeight = 0;
  let exactUsable = 0;
  let relatedWeight = 0;
  let relatedUsable = 0;
  let supportingDays = 0;

  for (const day of model.days) {
    const recency = decayWeight(at - day.at, HALF_LIFE_DAYS);
    globalWeight += recency * day.weight;
    globalUsable += recency * day.weight * day.value;
    let temporalWeight = 0;
    let exact = 0;
    let exactValue = 0;
    let related = 0;
    let relatedValue = 0;
    for (const report of day.reports) {
      // Align neighboring clock times across midnight to the recorded day.
      const shift = Math.round((localMinute - report.minute) / 1440);
      const weekday = ((localWeekday - 1 + shift + 7) % 7) + 1;
      const temporal = report.weight * gaussian(circularMinuteDistance(report.minute, localMinute), TIME_BANDWIDTH_MINUTES);
      temporalWeight += temporal;
      if (day.weekday === weekday) {
        exact += temporal;
        exactValue += temporal * report.value;
      } else if (isWeekend(day.weekday) === isWeekend(weekday)) {
        related += temporal;
        relatedValue += temporal * report.value;
      }
    }
    const scale = recency / Math.max(1, temporalWeight);
    exactWeight += exact * scale;
    exactUsable += exactValue * scale;
    relatedWeight += related * scale;
    relatedUsable += relatedValue * scale;
    if ((exact + 0.5 * related) * scale >= 0.15) supportingDays += 1;
  }

  const baseline = (1 + globalUsable) / (2 + globalWeight);
  const related = posterior(baseline, relatedWeight, relatedUsable);
  const historical = posterior(related, exactWeight, exactUsable);
  const recent = model.recent;
  const strength = recent && recent.at <= at
    ? 0.85 * Math.pow(0.5, (at - recent.at) / MS_PER_MINUTE / LIVE_HALF_LIFE_MINUTES)
    : 0;
  const live = recent && strength >= 0.01 ? { ...recent, strength } : null;
  // Keep the numerical score continuous even after hiding negligible live metadata.
  const probability = historical + ((recent?.value ?? historical) - historical) * strength;
  const effectiveReports = exactWeight + 0.5 * relatedWeight;

  return {
    probability,
    confidence: model.ratedCount === 0 ? "none"
      : effectiveReports >= 12 && supportingDays >= 10 ? "high"
        : effectiveReports >= 4 && supportingDays >= 4 ? "moderate" : "low",
    effectiveReports,
    supportingDays,
    live,
  };
}
