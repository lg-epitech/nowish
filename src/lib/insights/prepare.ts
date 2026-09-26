import type { Feel, Observation, Session } from "@/lib/types";

import { decayWeight } from "./math";

/** Recent sessions count more: a session from 45 days ago weighs half as much. */
export const HALF_LIFE_DAYS = 45;

/** How busy a time of day is changes faster than habits do (new flatmate, new timetable). */
export const FRESHNESS_HALF_LIFE_DAYS = 14;

export interface PreparedSession {
  id: string;
  start: number;
  minutes: number;
  localMinute: number;
  localWeekday: number;
  localDate: string;
  feel: Feel | null;
  /** Recency weight in (0, 1]. */
  weight: number;
  /** Recency weight on the shorter freshness half-life, for how good a time is lately. */
  freshness: number;
}

/** A check: a rated moment without a session. */
export interface PreparedObservation {
  id: string;
  at: number;
  localMinute: number;
  localWeekday: number;
  localDate: string;
  feel: Feel;
  /** Recency weight in (0, 1], on the same half-life as sessions. */
  weight: number;
  /** Recency weight on the shorter freshness half-life. */
  freshness: number;
}

export interface RoutinePrior {
  cadenceHours: number;
  typicalMinutes: number;
}

export function prepareSessions(sessions: readonly Session[], now: number): PreparedSession[] {
  return sessions
    .map((session) => {
      const start = Date.parse(session.startedAt);

      return {
        id: session.id,
        start,
        minutes: session.durationSeconds / 60,
        localMinute: session.localMinute,
        localWeekday: session.localWeekday,
        localDate: session.localDate,
        feel: session.feel,
        weight: decayWeight(now - start, HALF_LIFE_DAYS),
        freshness: decayWeight(now - start, FRESHNESS_HALF_LIFE_DAYS),
      };
    })
    .filter((session) => Number.isFinite(session.start))
    .sort((left, right) => left.start - right.start || left.id.localeCompare(right.id));
}

export function prepareObservations(
  observations: readonly Observation[],
  now: number,
): PreparedObservation[] {
  return observations
    .map((observation) => {
      const at = Date.parse(observation.observedAt);

      return {
        id: observation.id,
        at,
        localMinute: observation.localMinute,
        localWeekday: observation.localWeekday,
        localDate: observation.localDate,
        feel: observation.feel,
        weight: decayWeight(now - at, HALF_LIFE_DAYS),
        freshness: decayWeight(now - at, FRESHNESS_HALF_LIFE_DAYS),
      };
    })
    .filter((observation) => Number.isFinite(observation.at))
    .sort((left, right) => left.at - right.at || left.id.localeCompare(right.id));
}

export function isWeekend(weekday: number) {
  return weekday >= 6;
}

export type Daypart = "morning" | "afternoon" | "evening" | "night";

export const DAYPARTS: readonly { id: Daypart; label: string; from: number; to: number }[] = [
  { id: "morning", label: "Morning", from: 300, to: 720 },
  { id: "afternoon", label: "Afternoon", from: 720, to: 1020 },
  { id: "evening", label: "Evening", from: 1020, to: 1320 },
  { id: "night", label: "Night", from: 1320, to: 300 },
];

export function daypartOf(localMinute: number): Daypart {
  for (const part of DAYPARTS) {
    const inside =
      part.from < part.to
        ? localMinute >= part.from && localMinute < part.to
        : localMinute >= part.from || localMinute < part.to;
    if (inside) return part.id;
  }

  return "night";
}
