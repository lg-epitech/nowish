import { describe, expect, it } from "vitest";

import type { Verdict } from "@/lib/insights";

import {
  formatDelta,
  formatDuration,
  formatGap,
  formatMinuteOfDayRange,
  formatMinuteRange,
  formatMinutes,
  formatMoment,
  reasonText,
  relativeDay,
  verdictSummary,
} from "./format";

const options = { timeZone: "UTC", locale: "en-US" };
const now = Date.parse("2026-09-24T20:00:00Z");

describe("durations", () => {
  it("writes minutes the way people say them", () => {
    expect(formatMinutes(12.4)).toBe("12 min");
    expect(formatMinutes(60)).toBe("1 h");
    expect(formatMinutes(95)).toBe("1 h 35 min");
    expect(formatMinuteRange(9.6, 14.2)).toBe("10–14 min");
    expect(formatMinuteRange(85, 93)).toBe("85–93 min");
    expect(formatMinuteRange(200, 260)).toBe("3.5–4.5 h");
  });

  it("writes gaps in hours, then days", () => {
    expect(formatGap(0.3)).toBe("18 min");
    expect(formatGap(23.6)).toBe("24 h");
    expect(formatGap(80)).toBe("3.5 days");
    expect(formatGap(24 * 21)).toBe("21 days");
  });

  it("describes the last session against the usual one", () => {
    expect(formatDelta(2.4)).toBe("2 min longer than usual");
    expect(formatDelta(-3)).toBe("3 min shorter than usual");
    expect(formatDelta(0.2)).toBe("right on your usual");
  });

  it("formats a running stopwatch", () => {
    expect(formatDuration(65)).toBe("1:05");
    expect(formatDuration(3725)).toBe("1:02:05");
  });
});

describe("moments", () => {
  it("names nearby days", () => {
    expect(relativeDay(Date.parse("2026-09-24T07:00:00Z"), now, options)).toBe("today");
    expect(relativeDay(Date.parse("2026-09-25T07:00:00Z"), now, options)).toBe("tomorrow");
    expect(relativeDay(Date.parse("2026-09-27T07:00:00Z"), now, options)).toBe("Sunday");
    expect(formatMoment(Date.parse("2026-09-25T07:30:00Z"), now, options)).toBe("tomorrow 7:30 AM");
  });

  it("formats clock ranges compactly", () => {
    const plain = (text: string) => text.replace(/[\u2009\u202f]/g, " ");

    expect(plain(formatMinuteOfDayRange(360, 480, "en-US"))).toBe("6:00 – 8:00 AM");
    expect(plain(formatMinuteOfDayRange(1320, 0, "en-US"))).toBe("10:00 PM – 12:00 AM");
  });
});

describe("reasons", () => {
  it("describes report evidence and weak support", () => {
    expect(reasonText({ code: "reported-congestion", ratedCount: 40, supportingDays: 8 }, options)).toBe(
      "All 40 ratings inform the estimate, with comparable reports on 8 days.",
    );
    expect(reasonText({ code: "reported-congestion", ratedCount: 40, supportingDays: 0 }, options)).toContain("little comparable evidence");
    expect(reasonText({ code: "no-reports" }, options)).toBeNull();
  });

  it("quotes congestion without promising occupancy", () => {
    expect(reasonText({ code: "recent-report", feel: "bad", at: Date.parse("2026-09-24T07:45:00Z") }, options)).toBe(
      "Recent reports around 7:45 AM suggest the area is busy. Their influence fades with time.",
    );
    expect(reasonText({ code: "recent-report", feel: "okay", at: now }, options)).toContain("uncertain or partly congested");
    expect(reasonText({ code: "recent-report", feel: "okay", at: now, conflicted: true, reportCount: 2 }, options)).toContain("Recent reports are mixed");
  });

  it("keeps duration separate from availability", () => {
    expect(reasonText({ code: "takes", minutes: 12, doneBy: null }, options)).toBe("A session usually takes about 12 min.");
    expect(reasonText({ code: "takes", minutes: 12, doneBy: now }, options)).toBe("A session usually takes about 12 min.");
  });
});

describe("congestion summaries", () => {
  function estimate(confidence: "low" | "moderate", bestAt = now): Verdict {
    return {
      kind: "nowish", at: now, bestAt, window: null, expectedMinutes: 10,
      reasons: [{ code: "reported-congestion", ratedCount: 20, supportingDays: confidence === "low" ? 1 : 8 }],
      point: {
        at: now, localMinute: 1200, localWeekday: 4, score: 0.5, live: null,
        congestion: {
          probability: 0.5, confidence, effectiveReports: confidence === "low" ? 1 : 6,
          supportingDays: confidence === "low" ? 1 : 8, live: null,
        },
      },
    };
  }

  it("keeps the weak-current-evidence caveat when suggesting a supported later time", () => {
    const summary = verdictSummary(estimate("low", now + 60 * 60_000), now, options);
    expect(summary).toBe("Limited comparable reports for this time. A better chance is estimated around 9:00 PM.");
  });

  it("describes insufficient evidence without claiming that congestion cannot improve", () => {
    const limited = verdictSummary(estimate("low"), now, options);
    expect(limited).toContain("not enough evidence to recommend a better time");
    expect(limited).not.toContain("No clear improvement");
    const busy = estimate("moderate");
    busy.kind = "later";
    expect(verdictSummary(busy, now, options)).toContain("available reports do not support a specific better time");
  });
});
