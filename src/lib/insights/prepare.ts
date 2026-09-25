import type { Feel, Session } from "@/lib/types";

import { decayWeight } from "./math";

/** Recent sessions count more: a session from 45 days ago weighs half as much. */
export const HALF_LIFE_DAYS = 45;

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
      };
    })
    .filter((session) => Number.isFinite(session.start))
    .sort((left, right) => left.start - right.start || left.id.localeCompare(right.id));
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
