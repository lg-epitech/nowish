import type { Reason, Verdict, VerdictKind } from "@/lib/insights";
import { hasComparableEvidence } from "@/lib/insights/forecast";
import { daysBetween, zonedParts } from "@/lib/time";
import type { Feel } from "@/lib/types";

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
  now: "Likely usable",
  nowish: "Uncertain",
  later: "Likely busy",
};

export const FEEL_LABELS: Record<Feel, string> = {
  good: "Clear",
  okay: "Some congestion",
  bad: "Busy",
};

export const KIND_LABELS: Record<VerdictKind, string> = {
  now: "Likely usable",
  nowish: "Uncertain",
  later: "Likely busy",
};

/** Explain the estimate without turning an uncertain forecast into a promise. */
export function verdictSummary(verdict: Verdict, now: number, options: FormatOptions) {
  if (verdict.reasons.some((reason) => reason.code === "no-reports")) {
    return "50% is a neutral starting point. Add a congestion report to start learning.";
  }
  const limited = !hasComparableEvidence(verdict.point.congestion);
  if (verdict.bestAt > verdict.at) {
    return `${limited ? "Limited comparable reports for this time. " : ""}A better chance is estimated around ${formatMoment(verdict.bestAt, now, options)}.`;
  }
  const live = verdict.point.live;
  const usefulLive = live && live.strength >= 0.2 && !live.conflicted && live.feel !== "okay";
  if (limited && !usefulLive) {
    return "Limited comparable reports. Treat this as a rough estimate; there is not enough evidence to recommend a better time.";
  }
  if (verdict.kind === "now") return limited
    ? "Recent reports suggest the area is usable now. Comparable historical evidence remains limited."
    : "Reports suggest the area is likely to be usable at this time.";
  if (verdict.kind === "later") return limited
    ? "Recent reports suggest the area is busy now. There are too few comparable reports to recommend a better time."
    : "Reports suggest the area is likely to be busy. The available reports do not support a specific better time in the next 24 hours.";
  return "The reports do not give a clear answer for this time.";
}

/** Why the estimate came out this way, one plain sentence per reason. */
export function reasonText(reason: Reason, options: FormatOptions): string | null {
  switch (reason.code) {
    case "no-reports":
      return null;
    case "reported-congestion":
      return reason.supportingDays === 0
        ? `All ${reason.ratedCount} ratings inform the baseline, but there is little comparable evidence around this hour.`
        : `All ${reason.ratedCount} ratings inform the estimate, with comparable reports on ${reason.supportingDays} ${reason.supportingDays === 1 ? "day" : "days"}.`;
    case "recent-report": {
      const when = formatClock(reason.at, options);
      if (reason.conflicted) return "Recent reports are mixed. Current congestion is uncertain; their influence fades with time.";
      const state = reason.feel === "good" ? "clear" : reason.feel === "bad" ? "busy" : "uncertain or partly congested";
      return `Recent reports around ${when} suggest the area is ${state}. Their influence fades with time.`;
    }
    case "takes":
      // Duration is useful context, but availability at the start cannot
      // guarantee a finish time or an uninterrupted session.
      return `A session usually takes about ${formatMinutes(reason.minutes)}.`;
  }
}
