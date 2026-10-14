import { describe, expect, it } from "vitest";

import { MS_PER_DAY, MS_PER_MINUTE, zonedParts } from "@/lib/time";
import type { Feel, Observation, Session } from "@/lib/types";

import { buildCongestionModel, congestionAt } from "./congestion";
import { indexAt } from "./forecast";
import { buildInsights, verdictFor } from "./index";
import { prepareObservations, prepareSessions } from "./prepare";

const NOW = Date.parse("2026-10-13T08:00:00Z");
const PRIOR = { cadenceHours: 24, typicalMinutes: 10 };

function check(at: number, feel: Feel, timezone = "UTC", id = String(at)): Observation {
  return {
    id, routineId: "area", observedAt: new Date(at).toISOString(), timezone,
    ...zonedParts(at, timezone), feel,
    createdAt: new Date(at).toISOString(), updatedAt: new Date(at).toISOString(),
  };
}

function session(at: number, feel: Feel | null, timezone = "UTC"): Session {
  const { observedAt, ...common } = check(at, feel ?? "okay", timezone);
  return { ...common, startedAt: observedAt, durationSeconds: 600, feel, source: "manual" };
}

function model(observations: Observation[], sessions: Session[] = [], now = NOW) {
  return buildCongestionModel({
    sessions: prepareSessions(sessions, now),
    observations: prepareObservations(observations, now), now,
  });
}

function estimate(observations: Observation[], sessions: Session[] = [], at = NOW) {
  const parts = zonedParts(at, "UTC");
  return congestionAt(model(observations, sessions), at, parts.localMinute, parts.localWeekday);
}

function history(feel: Feel, count = 60, minute = 480) {
  const midnight = NOW - 480 * MS_PER_MINUTE;
  return Array.from({ length: count }, (_, i) => check(midnight - (i + 1) * MS_PER_DAY + minute * MS_PER_MINUTE, feel));
}

function insights(sessions: Session[], observations: Observation[] = [], now = NOW, prior = PRIOR) {
  return buildInsights({ sessions, observations, now, prior, timeZone: "UTC" });
}

describe("congestion evidence", () => {
  it("starts at a neutral 50% without treating missing reports as clear", () => {
    const result = insights([]);
    expect(result.congestion.ratedCount).toBe(0);
    expect(result.forecast.points.every((point) => point.score === 0.5)).toBe(true);
    expect(result.forecast.points[0].congestion.confidence).toBe("none");
    expect(verdictFor(result)).toMatchObject({ kind: "nowish", bestAt: NOW, window: null });
  });

  it("uses both rated entry types equally and counts unrated sessions separately", () => {
    const at = NOW - MS_PER_DAY;
    expect(estimate([check(at, "bad")])).toEqual(estimate([], [session(at, "bad")]));
    const result = insights([session(at, "good"), session(at - MS_PER_DAY, null)], [check(at - 2 * MS_PER_DAY, "bad")]);
    expect(result.congestion).toMatchObject({ ratedCount: 2, unratedCount: 1, counts: { good: 1, okay: 0, bad: 1 } });
  });

  it("keeps cadence, duration, recent completion, and unrated habit density out of the score", () => {
    const reports = history("good", 20);
    const without = insights([], reports);
    const withSessions = insights(Array.from({ length: 40 }, (_, i) => session(NOW - i * MS_PER_DAY, null)), reports, NOW, { cadenceHours: 168, typicalMinutes: 90 });
    expect(withSessions.forecast.points.map((point) => point.score)).toEqual(without.forecast.points.map((point) => point.score));
    expect(insights([session(NOW, null)]).forecast.points[0].score).toBe(0.5);
  });

  it("learns opposite outcomes, stays bounded, and builds evidence across days", () => {
    const clear = estimate(history("good"));
    const busy = estimate(history("bad"));
    expect(clear.probability).toBeGreaterThan(0.85);
    expect(busy.probability).toBeLessThan(0.15);
    expect(clear.probability).toBeLessThan(1);
    expect(busy.probability).toBeGreaterThan(0);
    expect(clear.confidence).toBe("high");
    expect(clear.probability + busy.probability).toBeCloseTo(1, 12);
  });

  it("treats some congestion as uncertain partial usability", () => {
    expect(estimate(history("okay")).probability).toBe(0.5);
    expect(estimate(history("okay")).confidence).toBe("high");
  });

  it("keeps one historical report conservative", () => {
    const result = estimate([check(NOW - MS_PER_DAY, "good")]);
    expect(result.probability).toBeGreaterThan(0.5);
    expect(result.probability).toBeLessThan(0.7);
    expect(result.confidence).toBe("low");
  });

  it("does not inflate confidence or historical influence from repeated taps", () => {
    const one = check(NOW - MS_PER_DAY, "bad");
    const repeated = Array.from({ length: 2000 }, (_, i) => ({ ...one, id: String(i) }));
    expect(estimate(repeated)).toEqual(estimate([one]));
    expect(model(repeated).ratedCount).toBe(2000);
  });

  it("caps a densely reported day without erasing weekday similarity", () => {
    const dense = [1, 2, 3, 4, 5, 6, 7].flatMap((day) => {
      const midnight = NOW - 480 * MS_PER_MINUTE - day * MS_PER_DAY;
      const weekend = zonedParts(midnight, "UTC").localWeekday >= 6;
      return Array.from({ length: 48 }, (_, slot) => check(midnight + slot * 30 * MS_PER_MINUTE, weekend ? "good" : "bad"));
    });
    const trained = model(dense);
    const weekday = congestionAt(trained, NOW, 720, 2);
    const weekend = congestionAt(trained, NOW, 720, 6);
    expect(weekend.probability - weekday.probability).toBeGreaterThan(0.12);
    expect(weekday.effectiveReports).toBeLessThanOrEqual(7);
    expect(weekend.effectiveReports).toBeLessThanOrEqual(7);
    const oneDay = estimate(dense.filter((report) => report.localDate === dense[0].localDate));
    expect(oneDay.effectiveReports).toBeLessThanOrEqual(1);
    expect(oneDay.confidence).toBe("low");
  });

  it("gives older and irrelevant reports bounded influence", () => {
    const freshBusy = history("bad", 14);
    const olderClear = history("good", 60).map((report) => check(Date.parse(report.observedAt) - 180 * MS_PER_DAY, "good"));
    expect(estimate([...freshBusy, ...olderClear]).probability).toBeLessThan(0.4);
    const offHour = congestionAt(model(history("good")), NOW, 1200, 2);
    expect(offHour.confidence).toBe("low");
    expect(offHour.probability).toBeLessThan(0.75);
  });

  it("lets ancient-only history return toward neutral with low evidence", () => {
    const ancient = history("good", 60).map((report) => check(Date.parse(report.observedAt) - 730 * MS_PER_DAY, "good"));
    const result = estimate(ancient);
    expect(result.probability).toBeCloseTo(0.5, 3);
    expect(result.confidence).toBe("low");
    expect(result.supportingDays).toBe(0);
  });

  it("separates busy and clear hours rather than copying start-time density", () => {
    const trained = model([...history("good", 40, 480), ...history("bad", 40, 1200)]);
    expect(congestionAt(trained, NOW, 480, 2).probability).toBeGreaterThan(0.8);
    expect(congestionAt(trained, NOW, 1200, 2).probability).toBeLessThan(0.2);
  });

  it("includes every report, including ones beyond the old 1500 limit", () => {
    const reports = history("bad", 1500);
    const extra = check(NOW - MS_PER_MINUTE, "good");
    const result = model([...reports, extra]);
    expect(result.ratedCount).toBe(1501);
    expect(estimate([...reports, extra]).probability).toBeGreaterThan(0.8);
  });
});

describe("fresh reports and time boundaries", () => {
  it("lets a fresh busy report override clear history, then fade", () => {
    const reports = [...history("good"), check(NOW, "bad")];
    const now = estimate(reports);
    const later = estimate(reports, [], NOW + 120 * MS_PER_MINUTE);
    expect(now.probability).toBeLessThan(0.15);
    expect(now.live).toMatchObject({ at: NOW, feel: "bad", strength: 0.85 });
    expect(later.probability).toBeGreaterThan(now.probability + 0.4);
    expect(Math.abs(later.probability - estimate(history("good"), [], NOW + 120 * MS_PER_MINUTE).probability)).toBeLessThan(0.05);
    expect(later.live!.strength).toBeLessThan(0.02);
  });

  it("lets a new clear report override busy history without resetting history", () => {
    const reports = [...history("bad"), check(NOW, "good")];
    expect(estimate(reports).probability).toBeGreaterThan(0.85);
    const later = estimate(reports, [], NOW + 120 * MS_PER_MINUTE);
    expect(Math.abs(later.probability - estimate(history("bad"), [], NOW + 120 * MS_PER_MINUTE).probability)).toBeLessThan(0.05);
    expect(model(reports).ratedCount).toBe(61);
  });

  it("preserves the latest rated context through a later unrated session", () => {
    const reports = [check(NOW - MS_PER_MINUTE, "bad")];
    expect(estimate(reports, [session(NOW, null)])).toEqual(estimate(reports));
    const mixed = estimate(reports, [session(NOW, "good")]);
    expect(mixed.live?.conflicted).toBe(true);
    expect(mixed.probability).toBeGreaterThan(0.4);
    expect(mixed.probability).toBeLessThan(0.6);
  });

  it("combines simultaneous conflicts deterministically", () => {
    const reports = [check(NOW, "good", "UTC", "a"), check(NOW, "bad", "UTC", "b")];
    expect(estimate(reports).probability).toBe(0.5);
    expect(estimate(reports)).toEqual(estimate([...reports].reverse()));
    expect(estimate([reports[0]], [session(NOW, "bad")]).probability).toBe(0.5);
  });

  it("excludes invalid and genuinely future-dated records from training and live state", () => {
    const future = check(NOW + MS_PER_MINUTE, "good");
    const invalid = { ...future, observedAt: "invalid" };
    const result = insights([session(NOW + MS_PER_MINUTE, "bad")], [future, invalid]);
    expect(result.congestion.ratedCount).toBe(0);
    expect(result.forecast.points.every((point) => point.score === 0.5 && point.live === null)).toBe(true);
  });

  it("keeps circular midnight neighbors close across the weekday boundary", () => {
    const midnight = Date.parse("2026-10-10T00:00:00Z");
    const trained = model(Array.from({ length: 6 }, (_, week) => check(midnight - (week + 1) * 7 * MS_PER_DAY - MS_PER_MINUTE, "good")), [], midnight);
    const before = congestionAt(trained, midnight, 1439, 5);
    const after = congestionAt(trained, midnight, 1, 6);
    expect(before.probability).toBeGreaterThan(0.65);
    expect(after.probability).toBeCloseTo(before.probability, 3);
  });

  it("uses recorded local clock time across timezone and DST changes", () => {
    const at = Date.parse("2026-03-08T11:30:00Z"); // 07:30 after Toronto's spring transition.
    const report = check(at, "good", "America/Toronto");
    const trained = model([report], [], at + MS_PER_DAY);
    expect(trained.days[0].reports[0].minute).toBe(450);
    expect(congestionAt(trained, at + 7 * MS_PER_DAY, 450, 7).probability)
      .toBeGreaterThan(congestionAt(trained, at + 7 * MS_PER_DAY, 690, 7).probability);
    const fall = [check(Date.parse("2026-11-01T05:30:00Z"), "good", "America/Toronto"), check(Date.parse("2026-11-01T06:30:00Z"), "good", "America/Toronto")];
    const fallback = model(fall, [], Date.parse("2026-11-02T00:00:00Z"));
    expect(fallback.ratedCount).toBe(2);
    expect(fallback.dayCount).toBe(1);
    expect(congestionAt(fallback, Date.parse("2026-11-02T00:00:00Z"), 90, 7).effectiveReports).toBeLessThanOrEqual(1);
  });
});

describe("congestion forecast integration", () => {
  it("shows a checks-only forecast without changing activity statistics", () => {
    const result = insights([], history("good"));
    expect(result.forecast.points[0].score).toBeGreaterThan(0.85);
    expect(result.sessionCount).toBe(0);
    expect(result.timeSpent.totalMinutes).toBe(0);
    expect(result.rhythm.gapCount).toBe(0);
    expect(verdictFor(result).kind).toBe("now");
  });

  it("uses a 24-hour horizon with one consistent score and correct index bounds", () => {
    const result = insights([], history("good"));
    expect(result.forecast.horizonSteps).toBe(288);
    expect(result.forecast.points.every((point) => point.score === point.congestion.probability)).toBe(true);
    expect(indexAt(result.forecast, NOW - 1)).toBe(0);
    expect(indexAt(result.forecast, NOW + 10 * MS_PER_DAY)).toBe(288);
    expect(verdictFor(result, -10).at).toBe(NOW);
    expect(verdictFor(result, 99999).at).toBe(result.forecast.points[288].at);
  });

  it("does not invent a better time or usable window when all reports are busy", () => {
    const result = insights([], history("bad"));
    const verdict = verdictFor(result);
    expect(verdict.kind).toBe("later");
    expect(verdict.bestAt).toBe(NOW);
    expect(verdict.window).toBeNull();
    expect(verdict.reasons.some((reason) => reason.code === "reported-congestion")).toBe(true);
  });

  it("changes after an edit or deletion without retaining stale model state", () => {
    const report = check(NOW, "bad");
    const busy = insights([], [report]);
    const edited = insights([], [{ ...report, feel: "good" }]);
    expect(busy.forecast.points[0].score).toBeLessThan(0.1);
    expect(edited.forecast.points[0].score).toBeGreaterThan(0.9);
    expect(insights([]).forecast.points[0].score).toBe(0.5);
  });
});


describe("statistical review regressions", () => {
  it("does not choose a winner when conflicting reports differ by one millisecond", () => {
    const simultaneous = estimate([check(NOW, "bad", "UTC", "bad"), check(NOW, "good", "UTC", "good")]);
    const clearLater = estimate([check(NOW - 1, "bad"), check(NOW, "good")]);
    const busyLater = estimate([check(NOW - 1, "good"), check(NOW, "bad")]);
    expect(simultaneous.probability).toBe(0.5);
    expect(Math.abs(clearLater.probability - simultaneous.probability)).toBeLessThan(0.00001);
    expect(Math.abs(busyLater.probability - simultaneous.probability)).toBeLessThan(0.00001);
    expect(clearLater.live?.conflicted).toBe(true);
    expect(busyLater.live?.conflicted).toBe(true);
  });

  it("preserves the limit for unequal numbers of simultaneous conflicting reports", () => {
    const busy = [check(NOW - 1, "bad", "UTC", "a"), check(NOW - 1, "bad", "UTC", "b")];
    const tied = estimate([...busy, check(NOW - 1, "good")]);
    const separated = estimate([...busy, check(NOW, "good")]);
    expect(Math.abs(tied.probability - separated.probability)).toBeLessThan(0.00001);
  });

  it("does not reweight a whole burst when one report crosses a half-hour boundary", () => {
    const weekAgo = NOW - 7 * MS_PER_DAY;
    const busy = Array.from({ length: 99 }, (_, index) => check(weekAgo - 31 * MS_PER_MINUTE, "bad", "UTC", String(index)));
    const before = [...busy, check(weekAgo - 30 * MS_PER_MINUTE - 1000, "good")];
    const after = [...busy, check(weekAgo - 30 * MS_PER_MINUTE, "good")];
    const query = NOW - 30 * MS_PER_MINUTE;
    const left = congestionAt(model(before), query, 450, 2);
    const right = congestionAt(model(after), query, 450, 2);
    expect(Math.abs(left.probability - right.probability)).toBeLessThan(0.001);
    expect(left.probability).toBeLessThan(0.45);
    expect(right.probability).toBeLessThan(0.45);
  });

  it("does not let an old burst suppress a later independent clear report", () => {
    const clear = check(NOW, "good");
    const oneBusy = check(NOW - 60 * MS_PER_MINUTE, "bad");
    const repeated = Array.from({ length: 2000 }, (_, index) => ({ ...oneBusy, id: String(index) }));
    const single = estimate([oneBusy, clear]);
    const burst = estimate([...repeated, clear]);
    expect(burst.probability).toBeCloseTo(single.probability, 12);
    expect(burst.live?.value).toBeGreaterThan(0.85);
    expect(burst.live?.value).toBeCloseTo(single.live!.value, 12);
  });

  it("keeps weekday borrowing bounded and out of Saturday evidence", () => {
    const saturday = Date.parse("2026-10-17T08:00:00Z");
    const weekdays = Array.from({ length: 90 }, (_, index) => saturday - (index + 1) * MS_PER_DAY)
      .filter((at) => zonedParts(at, "UTC").localWeekday <= 5).map((at) => check(at, "good"));
    const busySaturdays = [7, 14, 21].map((days) => check(saturday - days * MS_PER_DAY, "bad"));
    const withoutSaturday = congestionAt(model(weekdays, [], saturday), saturday, 480, 6);
    const withSaturday = congestionAt(model([...weekdays, ...busySaturdays], [], saturday), saturday, 480, 6);
    expect(withoutSaturday.confidence).toBe("low");
    expect(withoutSaturday.effectiveReports).toBe(0);
    expect(withoutSaturday.supportingDays).toBe(0);
    expect(withoutSaturday.probability).toBeLessThan(0.65);
    expect(withSaturday.probability).toBeLessThan(0.5);
    expect(withSaturday.supportingDays).toBe(3);
  });

  it("does not let other weekend days overwhelm conflicting exact-weekday history", () => {
    const saturday = Date.parse("2026-10-17T08:00:00Z");
    const sundays = Array.from({ length: 26 }, (_, index) => check(saturday - (6 + index * 7) * MS_PER_DAY, "good"));
    const busySaturdays = [7, 14, 21].map((days) => check(saturday - days * MS_PER_DAY, "bad"));
    const result = congestionAt(model([...sundays, ...busySaturdays], [], saturday), saturday, 480, 6);
    expect(result.probability).toBeLessThan(0.5);
  });

  it("preserves a sharp busy period between neighboring clear hours", () => {
    const reports = [...history("good", 60, 360), ...history("bad", 60, 480), ...history("good", 60, 600)];
    const trained = model(reports);
    const early = congestionAt(trained, NOW, 360, 2);
    const rush = congestionAt(trained, NOW, 480, 2);
    const late = congestionAt(trained, NOW, 600, 2);
    expect(early.probability).toBeGreaterThan(0.8);
    expect(rush.probability).toBeLessThan(0.25);
    expect(late.probability).toBeGreaterThan(0.8);
    expect(rush.confidence).toBe("high");
  });

  it("keeps broad consistent and uncertain patterns stable", () => {
    const allClear = [360, 480, 600].flatMap((minute) => history("good", 60, minute));
    const allUncertain = [360, 480, 600].flatMap((minute) => history("okay", 60, minute));
    expect(estimate(allClear).probability).toBeGreaterThan(0.85);
    expect(estimate(allUncertain).probability).toBeCloseTo(0.5, 12);
  });
});
