import { addDays, daysBetween, MS_PER_DAY, MS_PER_HOUR, zonedParts } from "@/lib/time";

import { weightedQuantile } from "./math";
import type { PreparedSession } from "./prepare";

/** Sessions closer together than this are treated as duplicates, not gaps. */
const MIN_GAP_HOURS = 5 / 60;

export interface Gap {
  hours: number;
  /** Local start minute of the session that ended the gap. */
  endMinute: number;
  endWeekday: number;
  weight: number;
}

export interface Rhythm {
  lastStart: number | null;
  elapsedHours: number | null;
  gapCount: number;
  medianGapHours: number | null;
  gapRangeHours: [number, number] | null;
  p90GapHours: number | null;
  sessionsLast7Days: number;
  sessionsLast30Days: number;
  perWeek: number | null;
  currentStreakDays: number;
  longestStreakDays: number;
  /** Sessions per week for the last 12 weeks, oldest first. */
  weeks: { weekStart: string; count: number }[];
}

export function computeGaps(sessions: readonly PreparedSession[]): Gap[] {
  const gaps: Gap[] = [];

  for (let index = 1; index < sessions.length; index += 1) {
    const hours = (sessions[index].start - sessions[index - 1].start) / MS_PER_HOUR;
    if (hours < MIN_GAP_HOURS) continue;

    gaps.push({
      hours,
      endMinute: sessions[index].localMinute,
      endWeekday: sessions[index].localWeekday,
      weight: sessions[index].weight,
    });
  }

  return gaps;
}

function streaks(dates: readonly string[], today: string) {
  const unique = [...new Set(dates)].sort();
  let longest = 0;
  let run = 0;
  let previous: string | null = null;

  for (const date of unique) {
    run = previous !== null && daysBetween(previous, date) === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
    previous = date;
  }

  const last = unique.at(-1);
  const current = last !== undefined && daysBetween(last, today) <= 1 ? run : 0;

  return { current, longest };
}

function mondayOf(localDate: string) {
  const weekday = new Date(`${localDate}T00:00:00Z`).getUTCDay();
  const offset = weekday === 0 ? 6 : weekday - 1;
  return addDays(localDate, -offset);
}

export function computeRhythm(
  sessions: readonly PreparedSession[],
  gaps: readonly Gap[],
  now: number,
  timeZone: string,
): Rhythm {
  const last = sessions.at(-1) ?? null;
  const hours = gaps.map((gap) => gap.hours);
  const weights = gaps.map((gap) => gap.weight);
  const hasGaps = gaps.length >= 2;
  const q25 = hasGaps ? weightedQuantile(hours, weights, 0.25) : null;
  const q75 = hasGaps ? weightedQuantile(hours, weights, 0.75) : null;
  const today = zonedParts(now, timeZone).localDate;
  const { current, longest } = streaks(
    sessions.map((session) => session.localDate),
    today,
  );

  const thisWeek = mondayOf(today);
  const weeks = Array.from({ length: 12 }, (_, index) => ({
    weekStart: addDays(thisWeek, (index - 11) * 7),
    count: 0,
  }));
  const firstWeek = weeks[0].weekStart;

  for (const session of sessions) {
    if (session.localDate < firstWeek) continue;
    const index = Math.floor(daysBetween(firstWeek, session.localDate) / 7);
    if (index >= 0 && index < weeks.length) weeks[index].count += 1;
  }

  let perWeek: number | null = null;

  if (sessions.length > 0) {
    const windowDays = 56;
    const trackedDays = Math.min(windowDays, Math.max(7, (now - sessions[0].start) / MS_PER_DAY));
    const inWindow = sessions.filter((session) => session.start >= now - windowDays * MS_PER_DAY);
    perWeek = (inWindow.length / trackedDays) * 7;
  }

  return {
    lastStart: last?.start ?? null,
    elapsedHours: last ? (now - last.start) / MS_PER_HOUR : null,
    gapCount: gaps.length,
    medianGapHours: hasGaps ? weightedQuantile(hours, weights, 0.5) : null,
    gapRangeHours: q25 === null || q75 === null ? null : [q25, q75],
    p90GapHours: hasGaps ? weightedQuantile(hours, weights, 0.9) : null,
    sessionsLast7Days: sessions.filter((session) => session.start >= now - 7 * MS_PER_DAY).length,
    sessionsLast30Days: sessions.filter((session) => session.start >= now - 30 * MS_PER_DAY).length,
    perWeek,
    currentStreakDays: current,
    longestStreakDays: longest,
    weeks,
  };
}
