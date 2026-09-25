import type { Reason, Verdict, VerdictKind } from "@/lib/insights";
import { daysBetween, zonedParts } from "@/lib/time";

export interface FormatOptions {
  timeZone: string;
  /** BCP 47 locale; the browser default when omitted. */
  locale?: string;
}

const clockFormatters = new Map<string, Intl.DateTimeFormat>();

function clockFormatter({ timeZone, locale }: FormatOptions) {
  const key = `${locale ?? ""}|${timeZone}`;
  let formatter = clockFormatters.get(key);

  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit", timeZone });
    clockFormatters.set(key, formatter);
  }

  return formatter;
}

/** "7:30 AM" or "07:30", following the locale. */
export function formatClock(ms: number, options: FormatOptions) {
  return clockFormatter(options).format(ms);
}

/** "7:00 – 8:00 AM" or "07:00–08:00", following the locale. */
export function formatClockRange(from: number, to: number, options: FormatOptions) {
  const sameDay = zonedParts(from, options.timeZone).localDate === zonedParts(to, options.timeZone).localDate;
  // Across midnight, formatRange would add both dates; two clock times read better.
  return sameDay
    ? clockFormatter(options).formatRange(from, to)
    : `${formatClock(from, options)} – ${formatClock(to, options)}`;
}

/** A minute of the day as a clock time, without a date. */
export function formatMinuteOfDay(minute: number, locale?: string) {
  const ms = Date.UTC(2026, 0, 5, Math.floor(minute / 60), minute % 60);
  return formatClock(ms, { timeZone: "UTC", locale });
}

/** Two minutes of the day as one range, e.g. "6:00 – 8:00 AM". */
export function formatMinuteOfDayRange(from: number, to: number, locale?: string) {
  const at = (minute: number) => Date.UTC(2026, 0, 5, Math.floor(minute / 60), minute % 60);
  return formatClockRange(at(from), at(to <= from ? to + 1440 : to), { timeZone: "UTC", locale });
}

export function formatHourLabel(ms: number, options: FormatOptions) {
  return new Intl.DateTimeFormat(options.locale, { hour: "numeric", timeZone: options.timeZone }).format(ms);
}

export function formatWeekday(weekday: number, style: "long" | "short" = "long", locale?: string) {
  // 2026-01-05 is a Monday.
  return new Intl.DateTimeFormat(locale, { weekday: style, timeZone: "UTC" }).format(
    Date.UTC(2026, 0, 4 + weekday),
  );
}

/** "today", "tomorrow", a weekday within the week, or a short date. */
export function relativeDay(ms: number, now: number, options: FormatOptions) {
  const days = daysBetween(zonedParts(now, options.timeZone).localDate, zonedParts(ms, options.timeZone).localDate);

  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  if (days > 1 && days < 7) {
    return new Intl.DateTimeFormat(options.locale, { weekday: "long", timeZone: options.timeZone }).format(ms);
  }

  return new Intl.DateTimeFormat(options.locale, { month: "short", day: "numeric", timeZone: options.timeZone }).format(ms);
}

/** "7:30", "tomorrow 7:30", "Sunday 10:00". */
export function formatMoment(ms: number, now: number, options: FormatOptions) {
  const day = relativeDay(ms, now, options);
  const clock = formatClock(ms, options);
  return day === "today" ? clock : `${day} ${clock}`;
}

export function formatMinutes(minutes: number) {
  const rounded = Math.max(0, Math.round(minutes));
  if (rounded < 60) return `${rounded} min`;

  const hours = Math.floor(rounded / 60);
  const rest = rounded % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

export function formatMinuteRange(low: number, high: number) {
  const from = Math.round(low);
  const to = Math.round(high);
  if (from === to) return formatMinutes(from);
  if (to < 180) return `${from}–${to} min`;
  const hours = (minutes: number) => String(Math.round((minutes / 60) * 2) / 2);
  return `${hours(from)}–${hours(to)} h`;
}

/** Gaps between sessions: hours up to two days, then days. */
export function formatGap(hours: number) {
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`;
  if (hours < 48) return `${Math.round(hours)} h`;

  const days = hours / 24;
  const rounded = days < 10 ? Math.round(days * 2) / 2 : Math.round(days);
  return `${rounded} days`;
}

export function formatDuration(seconds: number) {
  const whole = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const secs = whole % 60;
  const pad = (value: number) => value.toString().padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`;
}

export function formatDelta(deltaMinutes: number) {
  const rounded = Math.round(deltaMinutes);
  if (rounded === 0) return "right on your usual";
  return `${formatMinutes(Math.abs(rounded))} ${rounded > 0 ? "longer" : "shorter"} than usual`;
}

export const HEADLINES: Record<VerdictKind, string> = {
  now: "Yes, now.",
  nowish: "Nowish.",
  later: "Not now.",
};

export const KIND_LABELS: Record<VerdictKind, string> = {
  now: "Good time",
  nowish: "Soon",
  later: "Not now",
};

/** One line under the headline: what to do, and when. */
export function verdictSummary(verdict: Verdict, now: number, options: FormatOptions) {
  const codes = verdict.reasons.map((reason) => reason.code);

  if (codes.includes("first-time")) return "Any time works. Log one and Nowish starts learning your rhythm.";

  if (verdict.kind === "now") {
    if (codes.includes("overdue")) return "It has been longer than usual, so don’t wait for a better moment.";
    if (verdict.window && verdict.window.to - verdict.at >= 15 * 60_000) {
      return `Good until about ${formatClock(verdict.window.to, options)}.`;
    }
    if (codes.includes("off-hours")) return "Not your usual time, but you’re due and nothing better is coming up soon.";
    return "This is one of your usual times.";
  }

  const minutes = Math.round((verdict.bestAt - verdict.at) / 60_000);

  if (verdict.kind === "nowish") {
    return `Better in ${formatMinutes(minutes)}, around ${formatClock(verdict.bestAt, options)}.`;
  }

  if (verdict.window && verdict.window.to > verdict.window.from) {
    const day = relativeDay(verdict.window.from, now, options);
    const range = formatClockRange(verdict.window.from, verdict.window.to, options);
    return `Next good window: ${day === "today" ? "" : `${day} `}${range}.`;
  }

  return `Next good time: ${formatMoment(verdict.bestAt, now, options)}.`;
}

/** Why the verdict came out this way, one plain sentence per reason. */
export function reasonText(reason: Reason, options: FormatOptions): string | null {
  switch (reason.code) {
    case "first-time":
      return null;
    case "too-soon":
      return `Last one was ${formatGap(reason.elapsedHours)} ago. You usually wait about ${formatGap(reason.typicalGapHours)}.`;
    case "almost-due":
      return reason.elapsedHours >= reason.typicalGapHours * 0.85
        ? `Last one was ${formatGap(reason.elapsedHours)} ago, close to your usual ${formatGap(reason.typicalGapHours)}.`
        : `Last one was ${formatGap(reason.elapsedHours)} ago. You usually wait about ${formatGap(reason.typicalGapHours)}.`;
    case "due":
      return reason.elapsedHours > reason.typicalGapHours * 1.15
        ? `Last one was ${formatGap(reason.elapsedHours)} ago, a bit past your usual ${formatGap(reason.typicalGapHours)}.`
        : `Last one was ${formatGap(reason.elapsedHours)} ago, right on your usual gap.`;
    case "overdue":
      return `Last one was ${formatGap(reason.elapsedHours)} ago. Nine in ten of your gaps are shorter than ${formatGap(reason.p90GapHours)}.`;
    case "usual-time":
      return `You usually start around ${formatMinuteOfDay(reason.peakMinute, options.locale)}.`;
    case "off-hours":
      return `Not your usual time. You usually start around ${formatMinuteOfDay(reason.peakMinute, options.locale)}.`;
    case "usual-day":
      return `${formatWeekday(reason.weekday, "long", options.locale)}s are one of your usual days.`;
    case "unusual-day":
      return `You rarely do this on ${formatWeekday(reason.weekday, "long", options.locale)}s.`;
    case "takes":
      return reason.doneBy === null
        ? `It takes you about ${formatMinutes(reason.minutes)}.`
        : `It takes you about ${formatMinutes(reason.minutes)}, so you’d be done by ${formatClock(reason.doneBy, options)}.`;
  }
}
