export const MINUTES_PER_DAY = 1440;
export const MS_PER_MINUTE = 60_000;
export const MS_PER_HOUR = 3_600_000;
export const MS_PER_DAY = 86_400_000;

export interface ZonedParts {
  /** `YYYY-MM-DD` on the wall clock of `timeZone`. */
  localDate: string;
  /** Minutes since local midnight, 0–1439. */
  localMinute: number;
  /** ISO weekday, 1 (Monday) – 7 (Sunday). */
  localWeekday: number;
  /** Offset from UTC in minutes, positive east of Greenwich. */
  utcOffsetMinutes: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string) {
  let formatter = formatters.get(timeZone);

  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, formatter);
  }

  return formatter;
}

export function isIanaTimezone(value: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export function zonedParts(instant: Date | number, timeZone: string): ZonedParts {
  const ms = typeof instant === "number" ? instant : instant.getTime();
  const parts: Record<string, string> = {};

  for (const part of formatterFor(timeZone).formatToParts(ms)) {
    parts[part.type] = part.value;
  }

  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  const second = Number(parts.second);
  const wallClockAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const utcOffsetMinutes = Math.round((wallClockAsUtc - Math.floor(ms / 1000) * 1000) / MS_PER_MINUTE);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();

  return {
    localDate: `${parts.year}-${parts.month}-${parts.day}`,
    localMinute: hour * 60 + minute,
    localWeekday: weekday === 0 ? 7 : weekday,
    utcOffsetMinutes,
  };
}

/** Whole days between two `YYYY-MM-DD` dates (`later - earlier`). */
export function daysBetween(earlier: string, later: string) {
  return Math.round((Date.parse(`${later}T00:00:00Z`) - Date.parse(`${earlier}T00:00:00Z`)) / MS_PER_DAY);
}

export function addDays(localDate: string, days: number) {
  return new Date(Date.parse(`${localDate}T00:00:00Z`) + days * MS_PER_DAY)
    .toISOString()
    .slice(0, 10);
}

/** Shortest distance between two minutes of the day, 0–720. */
export function circularMinuteDistance(a: number, b: number) {
  const delta = Math.abs(a - b) % MINUTES_PER_DAY;
  return delta > MINUTES_PER_DAY / 2 ? MINUTES_PER_DAY - delta : delta;
}

export function browserTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}
