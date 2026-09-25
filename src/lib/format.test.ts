import { describe, expect, it } from "vitest";

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
  it("explains readiness in plain sentences", () => {
    expect(reasonText({ code: "too-soon", elapsedHours: 3, typicalGapHours: 24 }, options)).toBe(
      "Last one was 3 h ago. You usually wait about 24 h.",
    );
    expect(reasonText({ code: "almost-due", elapsedHours: 22, typicalGapHours: 24 }, options)).toBe(
      "Last one was 22 h ago, close to your usual 24 h.",
    );
    expect(reasonText({ code: "overdue", elapsedHours: 31, p90GapHours: 27 }, options)).toBe(
      "Last one was 31 h ago. Nine in ten of your gaps are shorter than 27 h.",
    );
  });

  it("only promises a finish time when now is a good time", () => {
    expect(reasonText({ code: "takes", minutes: 12, doneBy: null }, options)).toBe("It takes you about 12 min.");
    expect(reasonText({ code: "takes", minutes: 12, doneBy: Date.parse("2026-09-24T20:12:00Z") }, options)).toBe(
      "It takes you about 12 min, so you’d be done by 8:12 PM.",
    );
  });
});
