import { describe, expect, it } from "vitest";

import { sampleSessions } from "@/lib/sample-sessions";
import { circularMinuteDistance, MS_PER_DAY, MS_PER_MINUTE, zonedParts } from "@/lib/time";
import type { Feel, Observation, Session } from "@/lib/types";

import { expectedMinutesAt } from "./forecast";
import { buildInsights } from "./index";
import { prepareSessions } from "./prepare";
import { computeTimeSpent } from "./time-spent";

const DAILY = { cadenceHours: 24, typicalMinutes: 10 };

function at(iso: string) {
  return Date.parse(iso);
}

function session(startIso: string, minutes: number, feel: Feel | null = null): Session {
  const start = at(startIso);
  const parts = zonedParts(start, "UTC");

  return {
    id: startIso,
    routineId: "routine",
    startedAt: new Date(start).toISOString(),
    durationSeconds: Math.round(minutes * 60),
    timezone: "UTC",
    utcOffsetMinutes: 0,
    localDate: parts.localDate,
    localMinute: parts.localMinute,
    localWeekday: parts.localWeekday,
    feel,
    source: "manual",
    createdAt: startIso,
    updatedAt: startIso,
  };
}

function check(startIso: string, feel: Feel): Observation {
  const parts = zonedParts(at(startIso), "UTC");

  return {
    id: `check-${startIso}`,
    routineId: "routine",
    observedAt: new Date(at(startIso)).toISOString(),
    timezone: "UTC",
    utcOffsetMinutes: 0,
    localDate: parts.localDate,
    localMinute: parts.localMinute,
    localWeekday: parts.localWeekday,
    feel,
    createdAt: startIso,
    updatedAt: startIso,
  };
}

function daysBefore(iso: string, days: number) {
  return new Date(at(iso) - days * MS_PER_DAY).toISOString();
}

/** One shower a day around 07:30 UTC, ~12 minutes, for 60 days before `until`. */
function morningShowers(until: string) {
  return sampleSessions({
    routineId: "shower",
    now: at(until),
    days: 60,
    timeZone: "UTC",
    seed: 7,
    slots: [{ minute: 450, spread: 12, chance: 1, minutes: 12, minutesSpread: 2 }],
  });
}

function insightsAt(sessions: Session[], nowIso: string, prior = DAILY, observations: Observation[] = []) {
  return buildInsights({ sessions, observations, prior, now: at(nowIso), timeZone: "UTC" });
}

describe("time actually spent", () => {
  it("handles complete histories larger than the JavaScript argument limit", () => {
    const now = at("2026-09-24T12:00:00Z");
    const base = prepareSessions([session("2026-09-24T07:30:00Z", 10)], now)[0];
    const many = Array.from({ length: 150_000 }, (_, index) => ({ ...base, id: String(index), minutes: index % 2 ? 20 : 3 }));
    const spent = computeTimeSpent(many, now);
    expect(spent.shortestMinutes).toBe(3);
    expect(spent.longestMinutes).toBe(20);
    expect(spent.histogram.reduce((total, bin) => total + bin.count, 0)).toBe(many.length);
  });

  it("summarises typical minutes, range, and the last session against usual", () => {
    const insights = insightsAt(morningShowers("2026-09-24T05:00:00Z"), "2026-09-24T07:30:00Z");
    const spent = insights.timeSpent;

    expect(spent.typicalMinutes).toBeGreaterThan(11);
    expect(spent.typicalMinutes).toBeLessThan(13);
    expect(spent.rangeMinutes![0]).toBeLessThan(spent.typicalMinutes!);
    expect(spent.rangeMinutes![1]).toBeGreaterThan(spent.typicalMinutes!);
    expect(spent.last!.deltaMinutes).toBeCloseTo(spent.last!.minutes - spent.last!.usualMinutes!, 6);
    expect(spent.histogram.reduce((total, bin) => total + bin.count, 0)).toBe(insights.sessionCount);
    expect(spent.byDaypart.map((part) => part.id)).toEqual(["morning"]);
    expect(spent.recent).toHaveLength(30);
    expect(spent.perWeekMinutes).toBeGreaterThan(70);
  });

  it("detects when sessions are getting longer", () => {
    const sessions: Session[] = [];
    for (let day = 59; day >= 1; day -= 1) {
      const start = new Date(at("2026-09-24T07:30:00Z") - day * MS_PER_DAY).toISOString();
      sessions.push(session(start, day > 30 ? 10 : 15));
    }

    const trend = insightsAt(sessions, "2026-09-24T12:00:00Z").timeSpent.trend;

    expect(trend).not.toBeNull();
    expect(trend!.previousMinutes).toBe(10);
    expect(trend!.recentMinutes).toBe(15);
    expect(trend!.deltaRatio).toBeCloseTo(0.5, 6);
  });

  it("expects longer sessions at the times they usually run longer", () => {
    const sessions: Session[] = [];
    for (let day = 20; day >= 1; day -= 1) {
      const date = new Date(at("2026-09-24T00:00:00Z") - day * MS_PER_DAY).toISOString().slice(0, 10);
      sessions.push(session(`${date}T07:30:00Z`, 8), session(`${date}T22:00:00Z`, 20));
    }

    const prepared = prepareSessions(sessions, at("2026-09-24T12:00:00Z"));

    expect(expectedMinutesAt(prepared, DAILY, 450)).toBeCloseTo(8, 0);
    expect(expectedMinutesAt(prepared, DAILY, 1320)).toBeCloseTo(20, 0);
  });
});

describe("rhythm and timing", () => {
  it("counts streaks, gaps and weekly totals", () => {
    const days = [10, 9, 8, 6, 5, 4, 3, 2, 1];
    const sessions = days.map((day) =>
      session(new Date(at("2026-09-24T07:30:00Z") - day * MS_PER_DAY).toISOString(), 10),
    );
    const rhythm = insightsAt(sessions, "2026-09-24T06:00:00Z").rhythm;

    expect(rhythm.currentStreakDays).toBe(6);
    expect(rhythm.longestStreakDays).toBe(6);
    expect(rhythm.medianGapHours).toBe(24);
    expect(rhythm.elapsedHours).toBeCloseTo(22.5, 6);
    expect(rhythm.sessionsLast7Days).toBe(6);
    expect(rhythm.weeks.reduce((total, week) => total + week.count, 0)).toBe(sessions.length);
  });

  it("drops the streak once a full day is missed", () => {
    const sessions = [session("2026-09-20T07:30:00Z", 10), session("2026-09-21T07:30:00Z", 10)];

    expect(insightsAt(sessions, "2026-09-24T12:00:00Z").rhythm.currentStreakDays).toBe(0);
  });

  it("finds the best-rated time of day", () => {
    const sessions: Session[] = [];
    for (let day = 6; day >= 1; day -= 1) {
      const date = new Date(at("2026-09-24T00:00:00Z") - day * MS_PER_DAY).toISOString().slice(0, 10);
      sessions.push(session(`${date}T07:30:00Z`, 10, "good"), session(`${date}T22:00:00Z`, 10, "bad"));
    }

    const timing = insightsAt(sessions, "2026-09-24T12:00:00Z").timing;

    expect(timing.feel).toMatchObject({ good: 6, bad: 6, rated: 12 });
    expect(timing.feel.best).toMatchObject({ fromMinute: 360, toMinute: 480, goodShare: 1 });
    expect(timing.heatmap.flat().reduce((total, count) => total + count, 0)).toBe(12);
  });

  it("measures how tightly sessions cluster around the usual time", () => {
    const timing = insightsAt(morningShowers("2026-09-24T05:00:00Z"), "2026-09-24T07:30:00Z").timing;

    expect(timing.peaks).toHaveLength(1);
    expect(circularMinuteDistance(timing.peaks[0].minute, 450)).toBeLessThanOrEqual(10);
    expect(timing.spreadMinutes).toBeGreaterThan(2);
    expect(timing.spreadMinutes).toBeLessThan(15);
  });

  it("starts the forecast now and puts later points on round clock times", () => {
    const insights = insightsAt(morningShowers("2026-09-24T05:00:00Z"), "2026-09-24T07:30:00Z");
    const { forecast } = insights;

    expect(forecast.points[0].at).toBe(at("2026-09-24T07:30:00Z"));
    expect(forecast.points).toHaveLength(forecast.horizonSteps * 2 + 1);
    expect(forecast.points[1].at).toBe(at("2026-09-24T07:35:00Z"));
    expect(forecast.points[2].at - forecast.points[1].at).toBe(forecast.stepMinutes * MS_PER_MINUTE);
  });
});

describe("checks", () => {
  const showers = () => morningShowers("2026-09-24T05:00:00Z");

  it("never count as having done it", () => {
    const checks = [
      check("2026-09-23T21:00:00Z", "good"),
      check("2026-09-24T06:00:00Z", "bad"),
      check("2026-09-24T07:10:00Z", "okay"),
    ];
    const without = insightsAt(showers(), "2026-09-24T07:30:00Z");
    const withChecks = insightsAt(showers(), "2026-09-24T07:30:00Z", DAILY, checks);

    expect(withChecks.sessionCount).toBe(without.sessionCount);
    expect(withChecks.checkCount).toBe(3);
    expect(withChecks.rhythm).toEqual(without.rhythm);
    expect(withChecks.timeSpent).toEqual(without.timeSpent);
    expect(withChecks.congestion.ratedCount).toBe(without.congestion.ratedCount + 3);
  });

  it("counts check ratings toward the best and worst hours, but not toward usual times", () => {
    const sessions = [1, 2, 3, 4, 5, 6].map((day) => session(daysBefore("2026-09-24T12:30:00Z", day), 10));
    const checks: Observation[] = [];
    for (let day = 1; day <= 4; day += 1) {
      checks.push(check(daysBefore("2026-09-24T07:15:00Z", day), "bad"));
      checks.push(check(daysBefore("2026-09-24T21:00:00Z", day), "good"));
    }

    const timing = insightsAt(sessions, "2026-09-24T12:00:00Z", DAILY, checks).timing;

    expect(timing.feel).toMatchObject({ good: 4, bad: 4, rated: 8 });
    expect(timing.feel.best).toMatchObject({ fromMinute: 1200, toMinute: 1320, goodShare: 1, count: 4 });
    expect(timing.feel.worst).toMatchObject({ fromMinute: 360, toMinute: 480, badShare: 1, count: 4 });
    expect(timing.peaks).toEqual(insightsAt(sessions, "2026-09-24T12:00:00Z").timing.peaks);
    expect(timing.heatmap.flat().reduce((total, count) => total + count, 0)).toBe(sessions.length);
  });
});
