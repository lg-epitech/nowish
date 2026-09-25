import { MS_PER_DAY } from "@/lib/time";

import { mean, median, niceBinWidth, sum, weightedQuantile } from "./math";
import { DAYPARTS, daypartOf, type Daypart, type PreparedSession } from "./prepare";

export interface LastSessionSpent {
  id: string;
  start: number;
  minutes: number;
  /** Typical minutes before this session was logged, or null for a first session. */
  usualMinutes: number | null;
  deltaMinutes: number | null;
}

export interface TimeSpent {
  /** Recency-weighted median of actual minutes spent. */
  typicalMinutes: number | null;
  /** Recency-weighted interquartile range. */
  rangeMinutes: [number, number] | null;
  meanMinutes: number | null;
  shortestMinutes: number | null;
  longestMinutes: number | null;
  last: LastSessionSpent | null;
  /** Median of the last 30 days against the 30 days before. */
  trend: { recentMinutes: number; previousMinutes: number; deltaRatio: number } | null;
  totalMinutes: number;
  last30DaysMinutes: number;
  perWeekMinutes: number | null;
  byDaypart: { id: Daypart; label: string; count: number; medianMinutes: number }[];
  histogram: { from: number; to: number; count: number }[];
  /** Up to 30 most recent sessions, oldest first. */
  recent: { id: string; start: number; minutes: number }[];
}

const TREND_WINDOW_DAYS = 30;
const TREND_MIN_SESSIONS = 3;

function weightedMedian(sessions: readonly PreparedSession[]) {
  return weightedQuantile(
    sessions.map((session) => session.minutes),
    sessions.map((session) => session.weight),
    0.5,
  );
}

function histogram(minutes: readonly number[]) {
  if (minutes.length === 0) return [];

  const low = Math.min(...minutes);
  const high = Math.max(...minutes);
  const width = niceBinWidth(Math.max(1, high - low), 10);
  const start = Math.floor(low / width) * width;
  const binCount = Math.max(1, Math.floor((high - start) / width) + 1);
  const bins = Array.from({ length: binCount }, (_, index) => ({
    from: start + index * width,
    to: start + (index + 1) * width,
    count: 0,
  }));

  for (const value of minutes) {
    const index = Math.min(binCount - 1, Math.floor((value - start) / width));
    bins[index].count += 1;
  }

  return bins;
}

export function computeTimeSpent(sessions: readonly PreparedSession[], now: number): TimeSpent {
  const minutes = sessions.map((session) => session.minutes);
  const lastSession = sessions.at(-1) ?? null;
  const q25 = weightedQuantile(minutes, sessions.map((session) => session.weight), 0.25);
  const q75 = weightedQuantile(minutes, sessions.map((session) => session.weight), 0.75);

  let last: LastSessionSpent | null = null;

  if (lastSession) {
    const usualMinutes = weightedMedian(sessions.slice(0, -1));
    last = {
      id: lastSession.id,
      start: lastSession.start,
      minutes: lastSession.minutes,
      usualMinutes,
      deltaMinutes: usualMinutes === null ? null : lastSession.minutes - usualMinutes,
    };
  }

  const recentFrom = now - TREND_WINDOW_DAYS * MS_PER_DAY;
  const previousFrom = now - 2 * TREND_WINDOW_DAYS * MS_PER_DAY;
  const recentMinutes = sessions
    .filter((session) => session.start >= recentFrom)
    .map((session) => session.minutes);
  const previousMinutes = sessions
    .filter((session) => session.start >= previousFrom && session.start < recentFrom)
    .map((session) => session.minutes);

  let trend: TimeSpent["trend"] = null;

  if (recentMinutes.length >= TREND_MIN_SESSIONS && previousMinutes.length >= TREND_MIN_SESSIONS) {
    const recent = median(recentMinutes)!;
    const previous = median(previousMinutes)!;
    trend = {
      recentMinutes: recent,
      previousMinutes: previous,
      deltaRatio: previous === 0 ? 0 : (recent - previous) / previous,
    };
  }

  let perWeekMinutes: number | null = null;

  if (sessions.length > 0) {
    const windowDays = 56;
    const windowFrom = now - windowDays * MS_PER_DAY;
    const trackedDays = Math.min(windowDays, Math.max(7, (now - sessions[0].start) / MS_PER_DAY));
    const windowMinutes = sum(
      sessions.filter((session) => session.start >= windowFrom).map((session) => session.minutes),
    );
    perWeekMinutes = (windowMinutes / trackedDays) * 7;
  }

  const byDaypart = DAYPARTS.map((part) => {
    const values = sessions
      .filter((session) => daypartOf(session.localMinute) === part.id)
      .map((session) => session.minutes);

    return {
      id: part.id,
      label: part.label,
      count: values.length,
      medianMinutes: median(values) ?? 0,
    };
  }).filter((part) => part.count > 0);

  return {
    typicalMinutes: weightedMedian(sessions),
    rangeMinutes: q25 === null || q75 === null ? null : [q25, q75],
    meanMinutes: mean(minutes),
    shortestMinutes: minutes.length ? Math.min(...minutes) : null,
    longestMinutes: minutes.length ? Math.max(...minutes) : null,
    last,
    trend,
    totalMinutes: sum(minutes),
    last30DaysMinutes: sum(recentMinutes),
    perWeekMinutes,
    byDaypart,
    histogram: histogram(minutes),
    recent: sessions.slice(-30).map((session) => ({
      id: session.id,
      start: session.start,
      minutes: session.minutes,
    })),
  };
}
