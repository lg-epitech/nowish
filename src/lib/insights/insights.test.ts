import { describe, expect, it } from "vitest";

import { sampleSessions } from "@/lib/sample-sessions";
import { circularMinuteDistance, MS_PER_DAY, MS_PER_MINUTE, zonedParts } from "@/lib/time";
import type { Feel, Observation, Session } from "@/lib/types";

import { expectedMinutesAt, readinessAt } from "./forecast";
import { buildInsights, verdictFor } from "./index";
import { prepareSessions } from "./prepare";
import { computeGaps } from "./rhythm";

const DAILY = { cadenceHours: 24, typicalMinutes: 10 };
const WEEKLY = { cadenceHours: 168, typicalMinutes: 90 };

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

function minuteOf(ms: number) {
  return zonedParts(ms, "UTC").localMinute;
}

describe("verdict", () => {
  it("says now at your usual time once a usual gap has passed", () => {
    const insights = insightsAt(morningShowers("2026-09-24T05:00:00Z"), "2026-09-24T07:30:00Z");
    const verdict = verdictFor(insights);

    expect(verdict.kind).toBe("now");
    expect(verdict.reasons.map((reason) => reason.code)).toContain("usual-time");
    expect(verdict.window).not.toBeNull();
  });

  it("says nowish shortly before the usual time", () => {
    const insights = insightsAt(morningShowers("2026-09-24T05:00:00Z"), "2026-09-24T06:50:00Z");
    const verdict = verdictFor(insights);

    expect(verdict.kind).toBe("nowish");
    expect(circularMinuteDistance(minuteOf(verdict.bestAt), 450)).toBeLessThanOrEqual(30);
  });

  it("says later right after you did it and points at tomorrow's usual time", () => {
    const insights = insightsAt(morningShowers("2026-09-23T12:00:00Z"), "2026-09-23T19:00:00Z");
    const verdict = verdictFor(insights);

    expect(verdict.kind).toBe("later");
    expect(verdict.reasons[0].code).toBe("too-soon");
    expect(zonedParts(verdict.bestAt, "UTC").localDate).toBe("2026-09-24");
    expect(circularMinuteDistance(minuteOf(verdict.bestAt), 450)).toBeLessThanOrEqual(30);
  });

  it("says now when you are overdue, even at an unusual hour", () => {
    const insights = insightsAt(morningShowers("2026-09-22T12:00:00Z"), "2026-09-23T23:00:00Z");
    const verdict = verdictFor(insights);

    expect(verdict.kind).toBe("now");
    expect(verdict.reasons[0].code).toBe("overdue");
    expect(verdict.reasons.map((reason) => reason.code)).toContain("off-hours");
  });

  it("reads gaps by time of day for twice-a-day routines", () => {
    const sessions = sampleSessions({
      routineId: "shower",
      now: at("2026-09-23T23:00:00Z"),
      days: 45,
      timeZone: "UTC",
      seed: 11,
      slots: [
        { minute: 450, spread: 10, chance: 1, minutes: 8, minutesSpread: 1 },
        { minute: 1320, spread: 10, chance: 1, minutes: 15, minutesSpread: 2 },
      ],
    });
    const insights = insightsAt(sessions, "2026-09-24T07:30:00Z");

    expect(verdictFor(insights).kind).toBe("now");
    expect(insights.timing.peaks).toHaveLength(2);
    expect(insights.timing.peaks[0].share).toBeGreaterThan(0.4);
  });

  it("finds the next usual day for weekly routines", () => {
    const sessions = sampleSessions({
      routineId: "laundry",
      now: at("2026-09-23T12:00:00Z"),
      days: 16 * 7,
      timeZone: "UTC",
      seed: 3,
      slots: [{ minute: 600, spread: 30, chance: 1, minutes: 90, minutesSpread: 10, weekdays: [7] }],
    });
    const insights = insightsAt(sessions, "2026-09-23T12:00:00Z", WEEKLY);
    const verdict = verdictFor(insights);

    expect(insights.forecast.stepMinutes).toBe(30);
    expect(verdict.kind).toBe("later");
    expect(zonedParts(verdict.bestAt, "UTC").localWeekday).toBe(7);
    expect(circularMinuteDistance(minuteOf(verdict.bestAt), 600)).toBeLessThanOrEqual(120);
  });

  it("says any time works before the first session", () => {
    const insights = insightsAt([], "2026-09-24T12:00:00Z");
    const verdict = verdictFor(insights);

    expect(insights.confidence).toBe("none");
    expect(verdict.kind).toBe("now");
    expect(verdict.reasons[0].code).toBe("first-time");
    expect(verdict.expectedMinutes).toBe(10);
  });

  it("can judge a later moment from the same forecast", () => {
    const insights = insightsAt(morningShowers("2026-09-23T12:00:00Z"), "2026-09-23T19:00:00Z");
    const stepsToMorning = ((12 * 60 + 30) / insights.forecast.stepMinutes) | 0;
    const verdict = verdictFor(insights, stepsToMorning);

    expect(minuteOf(verdict.at)).toBe(450);
    expect(verdict.kind).toBe("now");
  });
});

describe("readiness", () => {
  it("rises from zero after a session to one at the usual gap", () => {
    const sessions = prepareSessions(morningShowers("2026-09-24T05:00:00Z"), at("2026-09-24T05:00:00Z"));
    const model = { gaps: computeGaps(sessions), prior: DAILY };

    expect(readinessAt(model, 2, 450).readiness).toBeLessThan(0.05);
    expect(readinessAt(model, 20, 450).readiness).toBeLessThan(0.35);
    expect(readinessAt(model, 24, 450).readiness).toBeGreaterThan(0.95);
    expect(readinessAt(model, 30, 450).overdue).toBe(true);
  });
});

describe("time actually spent", () => {
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
    expect(forecast.points).toHaveLength(forecast.horizonSteps * 2);
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
    expect(withChecks.forecast.points.map((point) => point.readiness)).toEqual(
      without.forecast.points.map((point) => point.readiness),
    );
  });

  it("says not now right after a bad check, and points past it", () => {
    const insights = insightsAt(showers(), "2026-09-24T07:30:00Z", DAILY, [check("2026-09-24T07:28:00Z", "bad")]);
    const verdict = verdictFor(insights);

    expect(verdict.kind).not.toBe("now");
    expect(verdict.reasons[0]).toMatchObject({ code: "just-checked", feel: "bad" });
    expect(verdict.reasons.at(-1)).toMatchObject({ code: "takes", doneBy: null });
    expect(verdict.bestAt - verdict.at).toBeGreaterThanOrEqual(15 * MS_PER_MINUTE);
  });

  it("only delays an overdue verdict until a bad check fades", () => {
    const sessions = morningShowers("2026-09-22T12:00:00Z");
    const insights = insightsAt(sessions, "2026-09-23T23:00:00Z", DAILY, [check("2026-09-23T22:58:00Z", "bad")]);
    const verdict = verdictFor(insights);

    expect(verdict.kind).toBe("nowish");
    expect(verdict.reasons.map((reason) => reason.code)).toContain("overdue");
    expect(verdict.bestAt - verdict.at).toBeLessThanOrEqual(90 * MS_PER_MINUTE);
  });

  it("says now when you just saw a good time and are nearly due", () => {
    const before = verdictFor(insightsAt(showers(), "2026-09-24T06:50:00Z"));
    const verdict = verdictFor(
      insightsAt(showers(), "2026-09-24T06:50:00Z", DAILY, [check("2026-09-24T06:49:00Z", "good")]),
    );

    expect(before.kind).toBe("nowish");
    expect(verdict.kind).toBe("now");
    expect(verdict.reasons[0]).toMatchObject({ code: "just-checked", feel: "good" });
  });

  it("does not let a fresh check count once you have done it since", () => {
    const sessions = [...showers(), session("2026-09-24T07:00:00Z", 12)];
    const insights = insightsAt(sessions, "2026-09-24T07:20:00Z", DAILY, [check("2026-09-24T06:58:00Z", "good")]);

    expect(insights.forecast.points[0].live).toBeNull();
    expect(verdictFor(insights).kind).toBe("later");
  });

  it("moves the suggestion away from a time that keeps being busy", () => {
    // Showers at 07:30 for weeks, then a week of finding 07:30 busy and going at 08:30.
    const cutoff = at("2026-09-17T00:00:00Z");
    const later = sampleSessions({
      routineId: "shower",
      now: at("2026-09-24T05:00:00Z"),
      days: 7,
      timeZone: "UTC",
      seed: 9,
      slots: [{ minute: 510, spread: 10, chance: 1, minutes: 12, minutesSpread: 2 }],
    });
    const sessions = [
      ...showers().filter((item) => at(item.startedAt) < cutoff),
      ...later.filter((item) => at(item.startedAt) >= cutoff),
    ];
    const busy = [1, 2, 3, 4, 5, 6, 7].map((day) => check(daysBefore("2026-09-24T07:30:00Z", day), "bad"));

    const before = verdictFor(insightsAt(sessions, "2026-09-24T07:30:00Z"));
    const verdict = verdictFor(insightsAt(sessions, "2026-09-24T07:30:00Z", DAILY, busy));

    expect(before.kind).toBe("now");
    expect(verdict.kind).toBe("nowish");
    expect(verdict.bestAt - verdict.at).toBeGreaterThanOrEqual(20 * MS_PER_MINUTE);
    expect(verdict.reasons).toContainEqual({ code: "checks-near", feel: "bad", count: 7, total: 7 });
  });

  it("does not let a few stray bad checks override a steady habit", () => {
    const stray = [10, 20, 28].map((day) => check(daysBefore("2026-09-24T07:25:00Z", day), "bad"));
    const verdict = verdictFor(insightsAt(showers(), "2026-09-24T07:30:00Z", DAILY, stray));

    expect(verdict.kind).toBe("now");
    expect(verdict.reasons.map((reason) => reason.code)).not.toContain("checks-near");
  });

  it("makes a time you have only checked look workable", () => {
    const sessions = [1, 2, 3, 4].map((day) => session(daysBefore("2026-09-24T07:30:00Z", day), 10));
    const evening = [1, 2, 3, 4].map((day) => check(daysBefore("2026-09-24T21:00:00Z", day), "good"));
    const without = insightsAt(sessions, "2026-09-24T12:00:00Z");
    const withChecks = insightsAt(sessions, "2026-09-24T12:00:00Z", DAILY, evening);
    const habitAt = (insights: typeof without) =>
      insights.forecast.points.find((point) => point.localMinute === 1260)!.habit;

    expect(habitAt(withChecks)).toBeGreaterThan(habitAt(without) + 0.1);
  });

  it("waits out a bad check before the first session", () => {
    const verdict = verdictFor(insightsAt([], "2026-09-24T07:30:00Z", DAILY, [check("2026-09-24T07:29:00Z", "bad")]));

    expect(verdict.kind).toBe("nowish");
    expect(verdict.reasons.map((reason) => reason.code)).not.toContain("first-time");
    expect(verdict.bestAt).toBeGreaterThan(at("2026-09-24T07:40:00Z"));
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
